// ============================================================================
// shared/copil.js — Indicateurs du COPIL IA (namespace KPICopil).
//
// Décision du COPIL (septembre 2026) : les modules ne sont plus pilotés en
// heures gagnées (conversion trop dépendante d'hypothèses) mais sur :
//
//   - ADOPTION MENSUELLE : utilisateurs actifs du mois ÷ population concernée.
//     Mensuelle et non cumulée : on veut voir un mois où l'usage décroche ;
//   - SYSTÉMATISATION : parmi les utilisateurs actifs du mois, part de LEURS
//     dossiers du mois traités avec le module. Exemple : 100 CT ont utilisé le
//     descriptif en septembre ; ces 100 CT ont émis 300 RICT ; 195 ont un
//     descriptif IA → 65 %. Sépare « peu de gens l'utilisent » (adoption) de
//     « ceux qui l'utilisent ne le font qu'une fois sur trois » ;
//   - REQUÊTES PAR UTILISATEUR actif du mois.
//
// Fonctions PURES : app.js normalise les sources en événements
// { email, month, dossier, requests } et dossiers { email, month, dossier },
// ce module en tire les séries mensuelles. Testé par tests/copil.test.js.
// Aucun LLM : les fluctuations sont détectées par seuils fixes.
// ============================================================================

const KPICopil = (function () {
    'use strict';

    // Grands métiers, rangés par pôle. Nextiim et MBAcity (PPI) ne sont pas
    // encore tracés sur la plateforme.
    const METIERS = {
        CT:   { label: 'Contrôle technique', pole: 'Conformité' },
        SPS:  { label: 'SPS', pole: 'Conformité' },
        DIAG: { label: 'BTP Diagnostics', pole: 'Conformité' },
        PPI:  { label: 'PPI (Citae)', pole: 'PPI' },
    };
    const METIER_ORDER = ['CT', 'SPS', 'DIAG', 'PPI'];

    // Population concernée par métier, pour l'adoption en %. CT est lu dans
    // population_cible.csv (app.js). null = inconnue : l'adoption est alors
    // donnée en nombre d'utilisateurs, jamais en % d'un dénominateur inventé.
    const POPULATIONS = { SPS: null, DIAG: null, PPI: null };

    // Cibles décidées en COPIL. `value: null` = cible à fixer, affichée comme telle.
    const CIBLES = {
        gainMensuelHeures: 772,
        gainAnnuelHeures: 9256,
        // Cible d'adoption GLOBALE (décidée en COPIL pour l'analyse CCTP,
        // retenue pour l'ensemble) : plus de 50 % de la population active
        // sur le mois, à fin d'année.
        adoption: {
            value: 0.5, month: '2026-12', label: "Cible d'adoption", statut: 'decide',
            intermediaire: { month: '2027-03', value: null, label: 'Cible intermédiaire fin mars', statut: 'a-fixer' },
        },
    };

    // Seuils de détection des fluctuations.
    const FLUCTUATION = {
        relative: 0.2,   // ±20 % sur un volume
        points: 0.1,     // ±10 points sur un taux
        minBase: 5,      // en dessous, une variation n'est que du bruit
    };

    // ===================== MOIS =====================

    function nextMonth(key) {
        const [y, m] = key.split('-').map(Number);
        return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }

    function previousMonth(key) {
        const [y, m] = key.split('-').map(Number);
        return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    }

    // Plage contiguë [start, end] (bornes incluses) : un mois sans usage doit
    // apparaître à 0, sinon une courbe le saute et masque la baisse.
    function monthRange(start, end) {
        if (!start || !end || start > end) return [];
        const out = [];
        for (let k = start; k <= end; k = nextMonth(k)) out.push(k);
        return out;
    }

    // ===================== SÉRIES =====================

    function _email(e) {
        return (e || '').toString().toLowerCase().trim();
    }

    // events  : [{ email, month, dossier?, requests? }] — un usage du module.
    // dossiers: [{ email, month, dossier }] | null — TOUS les dossiers du
    //           périmètre (avec ou sans IA), quand la source les porte.
    // months  : plage contiguë sur laquelle produire la série.
    function buildModuleSeries(events, dossiers, months) {
        const usage = new Map(); // month → { users:Set, dossiers:Set, requests }
        (events || []).forEach(e => {
            const email = _email(e && e.email);
            if (!email || !e.month) return;
            if (!usage.has(e.month)) usage.set(e.month, { users: new Set(), dossiers: new Set(), requests: 0 });
            const u = usage.get(e.month);
            u.users.add(email);
            if (e.dossier) u.dossiers.add(e.dossier);
            u.requests += (typeof e.requests === 'number' ? e.requests : 1);
        });

        const hasDossiers = Array.isArray(dossiers);
        const parc = new Map(); // month → Map(dossier → Set(email))
        if (hasDossiers) {
            dossiers.forEach(d => {
                if (!d || !d.month || !d.dossier) return;
                if (!parc.has(d.month)) parc.set(d.month, new Map());
                const m = parc.get(d.month);
                if (!m.has(d.dossier)) m.set(d.dossier, new Set());
                const email = _email(d.email);
                if (email) m.get(d.dossier).add(email);
            });
        }

        const seen = new Set();
        return (months || []).map(month => {
            const u = usage.get(month) || { users: new Set(), dossiers: new Set(), requests: 0 };
            let newUsers = 0;
            u.users.forEach(email => {
                if (!seen.has(email)) { seen.add(email); newUsers++; }
            });

            const row = {
                month,
                activeUsers: u.users.size,
                newUsers,
                requests: u.requests,
                dossiersIA: u.dossiers.size,
                dossiersUsers: null,   // dossiers du mois des utilisateurs actifs du mois
                dossiersTotal: null,   // tous les dossiers du mois
            };

            if (hasDossiers) {
                const m = parc.get(month) || new Map();
                // Le numérateur doit être inclus dans le dénominateur : un dossier
                // traité par l'IA compte toujours, même si la source « tous
                // dossiers » ne l'a pas vu ce mois-là.
                const total = new Set(m.keys());
                u.dossiers.forEach(d => total.add(d));
                const desUtilisateurs = new Set(u.dossiers);
                m.forEach((emails, dossier) => {
                    for (const email of emails) {
                        if (u.users.has(email)) { desUtilisateurs.add(dossier); break; }
                    }
                });
                row.dossiersTotal = total.size;
                row.dossiersUsers = desUtilisateurs.size;
            }
            return row;
        });
    }

    // ===================== RATIOS =====================

    // Un ratio sans dénominateur vaut null (affiché « — »), jamais 0.
    function ratio(num, den) {
        if (num === null || num === undefined || !den) return null;
        return num / den;
    }

    function adoption(row, population) {
        return row ? ratio(row.activeUsers, population) : null;
    }

    function systematisation(row) {
        return row ? ratio(row.dossiersIA, row.dossiersUsers) : null;
    }

    function penetration(row) {
        return row ? ratio(row.dossiersIA, row.dossiersTotal) : null;
    }

    function requestsPerUser(row) {
        return row ? ratio(row.requests, row.activeUsers) : null;
    }

    // Variation relative d'un mois sur l'autre. null si pas de base.
    function change(prev, curr) {
        if (prev === null || prev === undefined || curr === null || curr === undefined) return null;
        if (prev === 0) return curr === 0 ? 0 : null;
        return (curr - prev) / prev;
    }

    // ===================== FLUCTUATIONS =====================

    // Compare `month` au mois précédent, série par série. Retourne les
    // variations au-delà des seuils — à expliquer en COPIL.
    // items : [{ id, label, metier, series }]
    function detectFluctuations(items, month, seuils) {
        const s = Object.assign({}, FLUCTUATION, seuils || {});
        const prevKey = previousMonth(month);
        const out = [];
        (items || []).forEach(it => {
            const series = it.series || [];
            const cur = series.find(r => r.month === month);
            const prev = series.find(r => r.month === prevKey);
            if (!cur || !prev) return;

            [['activeUsers', 'Utilisateurs actifs'], ['requests', 'Requêtes']].forEach(([key, label]) => {
                const a = prev[key], b = cur[key];
                if (Math.max(a, b) < s.minBase) return;
                const delta = a === 0 ? Infinity : (b - a) / a;
                if (Math.abs(delta) >= s.relative) {
                    out.push({ id: it.id, label: it.label, metier: it.metier,
                        metric: key, metricLabel: label, prev: a, curr: b, delta, kind: 'relative' });
                }
            });

            const sa = systematisation(prev), sb = systematisation(cur);
            if (sa !== null && sb !== null && Math.max(prev.dossiersUsers, cur.dossiersUsers) >= s.minBase
                && Math.abs(sb - sa) >= s.points) {
                out.push({ id: it.id, label: it.label, metier: it.metier,
                    metric: 'systematisation', metricLabel: 'Systématisation', prev: sa, curr: sb,
                    delta: sb - sa, kind: 'points' });
            }
        });
        // Les baisses d'abord : ce sont elles que le COPIL demande d'expliquer.
        return out.sort((x, y) => (x.delta - y.delta));
    }

    return {
        METIERS,
        METIER_ORDER,
        POPULATIONS,
        CIBLES,
        FLUCTUATION,
        nextMonth,
        previousMonth,
        monthRange,
        buildModuleSeries,
        ratio,
        adoption,
        systematisation,
        penetration,
        requestsPerUser,
        change,
        detectFluctuations,
    };
})();

// Navigateur : namespace global. Node (tests) : module CommonJS.
if (typeof window !== 'undefined') window.KPICopil = KPICopil;
if (typeof module !== 'undefined' && module.exports) module.exports = KPICopil;
