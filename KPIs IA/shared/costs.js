// ============================================================================
// shared/costs.js — Pilotage économique de la démarche IA (page pilotage-ia).
//
// Chargé APRÈS shared/utils.js :
//     <script src="shared/utils.js"></script>
//     <script src="shared/costs.js"></script>
//     <script src="pilotage-ia.js"></script>
// Expose le namespace global `KPICosts` (window.KPICosts).
//
// Également importable en Node pour les tests :
//     const KPICosts = require('./shared/costs.js');
//     node --test tests/costs.test.js
//
// PÉRIMÈTRE : calculs GLOBAUX, niveau groupe. Aucune ventilation par
// fonctionnalité (décision de cadrage) : la page ne descend jamais sous le
// total groupe, donc aucun compteur par brique n'est nécessaire ici.
//
// SÉCURITÉ : aucune clé OpenRouter dans ce fichier ni ailleurs dans le front.
// Ces pages sont déployées vers un repo PUBLIC (hedical/livepages). La clé
// Management vit uniquement dans les credentials n8n ; le front ne lit qu'un
// fichier de relevés déjà signé.
// ============================================================================

const KPICosts = (function () {
    'use strict';

    // ===================== CONSTANTES =====================

    const LS_REGISTRE = 'kpi_couts_ia';
    const LS_PARAMS = 'kpi_params_macro';
    const SS_SNAPSHOT = 'kpi_snapshot_gains';
    const LS_HISTORIQUE = 'kpi_openrouter_historique';

    const CATEGORIES = ['inference', 'infra', 'licence', 'ocr', 'autre'];
    const NATURES = ['fixe', 'variable'];
    const DEVISES = ['EUR', 'USD'];

    // Défauts alignés sur app.js (TOTAL_REVENUE, ANNUAL_HOURS) pour que le
    // taux horaire de la page macro soit exactement celui du dashboard.
    const DEFAULT_PARAMS = {
        masseSalarialeAnnuelle: 0,
        budgetAnnuelIA: 0,
        tauxUsdEur: 0.92,
        effectifOverride: null,
        caGroupe: 44000000,
        heuresAnnuelles: 1607,
    };

    const MOIS_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
    const JOUR_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

    // ===================== HELPERS MOIS =====================

    // Clé de mois UTC 'YYYY-MM'. Accepte Date, timestamp ou chaîne ISO.
    // UTC partout : les compteurs OpenRouter basculent sur le mois UTC.
    function monthKey(value) {
        const d = (value instanceof Date) ? value : new Date(value);
        if (isNaN(d.getTime())) return null;
        return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
    }

    function isValidMonth(m) {
        return typeof m === 'string' && MOIS_RE.test(m);
    }

    // Décale 'YYYY-MM' de n mois (n peut être négatif).
    function addMonths(m, n) {
        if (!isValidMonth(m)) return null;
        const y = parseInt(m.slice(0, 4), 10);
        const idx = parseInt(m.slice(5, 7), 10) - 1 + n;
        const ny = y + Math.floor(idx / 12);
        const nm = ((idx % 12) + 12) % 12;
        return ny + '-' + String(nm + 1).padStart(2, '0');
    }

    // Liste inclusive des mois de start à end. [] si bornes invalides/inversées.
    function monthsRange(start, end) {
        if (!isValidMonth(start) || !isValidMonth(end) || start > end) return [];
        const out = [];
        let cur = start;
        while (cur <= end) {
            out.push(cur);
            cur = addMonths(cur, 1);
        }
        return out;
    }

    // Bornes UTC d'un mois : [début inclus, début du mois suivant exclu).
    function monthBounds(m) {
        if (!isValidMonth(m)) return null;
        const next = addMonths(m, 1);
        return {
            start: Date.UTC(parseInt(m.slice(0, 4), 10), parseInt(m.slice(5, 7), 10) - 1, 1),
            end: Date.UTC(parseInt(next.slice(0, 4), 10), parseInt(next.slice(5, 7), 10) - 1, 1),
        };
    }

    // Nombre de jours couverts par une plage de mois (prorata temporel de la
    // masse salariale annuelle).
    function daysInMonthRange(start, end) {
        const months = monthsRange(start, end);
        if (!months.length) return 0;
        const a = monthBounds(months[0]).start;
        const b = monthBounds(months[months.length - 1]).end;
        return Math.round((b - a) / 86400000);
    }

    // ===================== DEVISES =====================

    // Conversion vers l'euro. Le taux ne s'applique qu'aux montants en USD ;
    // un taux absent ou absurde retombe sur le défaut plutôt que de produire 0.
    function toEur(montant, devise, tauxUsdEur) {
        const m = Number(montant);
        if (!isFinite(m)) return 0;
        if (devise !== 'USD') return m;
        const t = Number(tauxUsdEur);
        return m * ((isFinite(t) && t > 0) ? t : DEFAULT_PARAMS.tauxUsdEur);
    }

    // ===================== REGISTRE MANUEL =====================

    let idCounter = 0;

    function newId() {
        idCounter += 1;
        return 'c' + Date.now().toString(36) + '-' + idCounter;
    }

    // Valide et normalise une ligne saisie. Retourne { ok, ligne, erreurs }.
    // Les champs porteurs de sens (mois, montant, catégorie, fournisseur) ne
    // sont jamais corrigés en silence ; seuls nature et devise ont un défaut.
    function validateLigne(raw) {
        const o = raw || {};
        const erreurs = [];

        const mois = String(o.mois || '').trim();
        if (!isValidMonth(mois)) erreurs.push('mois attendu au format YYYY-MM');

        // Strictement positif : un champ vide devient 0 via Number(''), et une
        // ligne à 0 € n'apporte rien à une somme tout en masquant une saisie
        // incomplète.
        const montant = Number(o.montant);
        if (!isFinite(montant) || montant <= 0) erreurs.push('montant doit être supérieur à zéro');

        const categorie = CATEGORIES.includes(o.categorie) ? o.categorie : null;
        if (!categorie) erreurs.push('catégorie inconnue');

        const fournisseur = String(o.fournisseur || '').trim();
        if (!fournisseur) erreurs.push('fournisseur requis');

        if (erreurs.length) return { ok: false, ligne: null, erreurs };

        return {
            ok: true,
            erreurs: [],
            ligne: {
                id: o.id ? String(o.id) : newId(),
                mois,
                categorie,
                fournisseur,
                libelle: String(o.libelle || '').trim(),
                montant,
                devise: DEVISES.includes(o.devise) ? o.devise : 'EUR',
                nature: NATURES.includes(o.nature) ? o.nature : 'variable',
            },
        };
    }

    // Le storage est injectable pour que les tests Node n'aient pas besoin
    // d'un faux navigateur complet.
    function pickStore(storage, fallback) {
        if (storage) return storage;
        return fallback || null;
    }

    function localStore(storage) {
        return pickStore(storage, (typeof localStorage !== 'undefined') ? localStorage : null);
    }

    // Lecture tolérante : un JSON corrompu vide le registre en mémoire plutôt
    // que de casser la page. Les lignes invalides sont écartées.
    function loadRegistre(storage) {
        const st = localStore(storage);
        if (!st) return [];
        let parsed;
        try {
            parsed = JSON.parse(st.getItem(LS_REGISTRE) || '[]');
        } catch (e) {
            console.warn('Registre des coûts illisible, ignoré.', e);
            return [];
        }
        if (!Array.isArray(parsed)) return [];
        return parsed.map(validateLigne).filter(r => r.ok).map(r => r.ligne);
    }

    function saveRegistre(lignes, storage) {
        const st = localStore(storage);
        if (!st) return false;
        const clean = (lignes || []).map(validateLigne).filter(r => r.ok).map(r => r.ligne);
        try {
            st.setItem(LS_REGISTRE, JSON.stringify(clean));
            return true;
        } catch (e) {
            console.error('Écriture du registre impossible.', e);
            return false;
        }
    }

    // ===================== PARAMÈTRES =====================

    function normalizeParams(raw) {
        const o = raw || {};
        const positifOuDefaut = (v, d) => {
            const n = Number(v);
            return (isFinite(n) && n > 0) ? n : d;
        };
        const nonNegatif = (v) => {
            const n = Number(v);
            return (isFinite(n) && n >= 0) ? n : 0;
        };
        const eff = Number(o.effectifOverride);
        return {
            masseSalarialeAnnuelle: nonNegatif(o.masseSalarialeAnnuelle),
            budgetAnnuelIA: nonNegatif(o.budgetAnnuelIA),
            tauxUsdEur: positifOuDefaut(o.tauxUsdEur, DEFAULT_PARAMS.tauxUsdEur),
            effectifOverride: (isFinite(eff) && eff > 0) ? Math.round(eff) : null,
            caGroupe: positifOuDefaut(o.caGroupe, DEFAULT_PARAMS.caGroupe),
            heuresAnnuelles: positifOuDefaut(o.heuresAnnuelles, DEFAULT_PARAMS.heuresAnnuelles),
        };
    }

    function loadParams(storage) {
        const st = localStore(storage);
        if (!st) return normalizeParams(null);
        try {
            return normalizeParams(JSON.parse(st.getItem(LS_PARAMS) || '{}'));
        } catch (e) {
            console.warn('Paramètres macro illisibles, défauts appliqués.', e);
            return normalizeParams(null);
        }
    }

    function saveParams(params, storage) {
        const st = localStore(storage);
        if (!st) return false;
        try {
            st.setItem(LS_PARAMS, JSON.stringify(normalizeParams(params)));
            return true;
        } catch (e) {
            console.error('Écriture des paramètres impossible.', e);
            return false;
        }
    }

    // ===================== RELEVÉS OPENROUTER =====================

    // Normalise le fichier de relevés. Tolère les 4 enveloppes rencontrées
    // dans le projet (JSON brut, [{data:"..."}], {data:"..."}, tableau direct)
    // — même contrat que les parseurs d'app.js.
    function parseOpenRouterUsage(raw) {
        let data = raw;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) { return []; }
        }
        if (data && !Array.isArray(data) && typeof data.data !== 'undefined') data = data.data;
        if (Array.isArray(data) && data.length === 1 && data[0] && typeof data[0].data !== 'undefined') data = data[0].data;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) { return []; }
        }
        if (!Array.isArray(data)) return [];

        const out = [];
        for (const row of data) {
            if (!row) continue;
            const t = new Date(row.ts || row.timestamp || row.date || row.releveAt);
            const usage = Number(typeof row.usageCumule !== 'undefined' ? row.usageCumule : row.usage);
            if (isNaN(t.getTime()) || !isFinite(usage) || usage < 0) continue;
            out.push({
                ts: t.toISOString(),
                tsMs: t.getTime(),
                keyName: String(row.keyName || row.name || row.label || 'default'),
                usageCumule: usage,
            });
        }
        return out;
    }

    // Répartit un delta de cumulé sur les mois couverts par l'intervalle
    // ]tsA, tsB], au prorata du temps passé dans chaque mois.
    //
    // Sans ce prorata, le relevé du 1er du mois — qui mesure en réalité la
    // dépense du dernier jour du mois précédent — décalerait systématiquement
    // un jour de dépense d'un mois sur l'autre. Et un relevé manqué pendant
    // plusieurs jours à cheval sur une bascule fausserait les deux mois.
    function spreadDelta(tsA, tsB, delta, acc) {
        if (!(tsB > tsA) || !(delta > 0)) return;
        const total = tsB - tsA;
        let cur = tsA;
        while (cur < tsB) {
            const m = monthKey(new Date(cur));
            const stop = Math.min(monthBounds(m).end, tsB);
            acc[m] = (acc[m] || 0) + delta * ((stop - cur) / total);
            cur = stop;
        }
    }

    // Dépense mensuelle OpenRouter en USD, calculée par DELTA DE CUMULÉ.
    //
    // On n'utilise JAMAIS usage_monthly : ce compteur est remis à zéro le 1er
    // du mois UTC, donc une exécution n8n manquée en fin de mois perdrait le
    // mois définitivement et sans aucun signal. Un delta de cumulé survit aux
    // relevés manquants : une lacune coûte de la granularité, jamais un total.
    function monthlySpendFromSnapshots(snapshots) {
        const releves = (snapshots || []).slice().sort((a, b) => a.tsMs - b.tsMs);

        const parCle = new Map();
        for (const r of releves) {
            if (!parCle.has(r.keyName)) parCle.set(r.keyName, []);
            parCle.get(r.keyName).push(r);
        }

        const usdParMois = {};
        const anomalies = [];
        parCle.forEach((serie, keyName) => {
            for (let i = 1; i < serie.length; i++) {
                const a = serie[i - 1];
                const b = serie[i];
                let delta = b.usageCumule - a.usageCumule;
                if (delta < 0) {
                    // Compteur redémarré (clé recréée, rotation) : la dépense de
                    // l'intervalle vaut au moins le nouveau cumulé. On ne laisse
                    // jamais passer un delta négatif, qui ferait baisser un mois
                    // déjà clôturé.
                    delta = b.usageCumule;
                    anomalies.push({ keyName: keyName, ts: b.ts, motif: 'compteur redémarré' });
                }
                spreadDelta(a.tsMs, b.tsMs, delta, usdParMois);
            }
        });

        // Une clé qui démarre à un cumulé NON NUL avait déjà dépensé avant son
        // premier relevé, et ce passé-là l'API ne sait pas le détailler. On
        // signale le mois où CETTE clé entre en scène — et non le premier mois
        // toutes clés confondues : dès que plusieurs séries coexistent
        // (historique importé + job n8n), la plus ancienne peut très bien être
        // complète, et accuser son mois serait un faux signalement.
        // On liste TOUS les mois aveugles, pas seulement le premier : deux clés
        // peuvent entrer en scène à des dates différentes, et si seule la plus
        // ancienne était signalée, une lacune plus tardive passerait en silence.
        let debutAveugle = null;
        const moisAveugles = new Set();
        parCle.forEach((serie) => {
            if (!serie.length || !(serie[0].usageCumule > 0)) return;
            moisAveugles.add(monthKey(new Date(serie[0].tsMs)));
            if (debutAveugle === null || serie[0].tsMs < debutAveugle) debutAveugle = serie[0].tsMs;
        });

        const mois = Object.keys(usdParMois).sort();
        return {
            usdParMois,
            premierMois: mois.length ? mois[0] : null,
            dernierMois: mois.length ? mois[mois.length - 1] : null,
            moisPartiel: (debutAveugle === null) ? null : monthKey(new Date(debutAveugle)),
            moisPartiels: Array.from(moisAveugles).sort(),
            anomalies,
            nbReleves: releves.length,
            nbCles: parCle.size,
        };
    }

    // ============ HISTORIQUE CSV (export « total usage » OpenRouter) ============

    // L'export CSV d'OpenRouter donne la dépense JOURNALIÈRE par modèle
    // (date__day, model, total_usage). Le moteur, lui, ne sait lire que des
    // relevés de CUMULÉ dont il prend les deltas. On convertit donc.
    //
    // Convention d'horodatage, choisie pour que l'attribution mensuelle soit
    // EXACTE et non prorata : le relevé de la journée D porte l'instant D+1 à
    // 00:00 UTC, et une ancre à 0 est posée au début du premier jour. Chaque
    // delta couvre alors exactement ]D, D+1] — un intervalle qui ne franchit
    // jamais une frontière de mois, donc aucune fuite d'un mois sur l'autre.
    //
    // Un relevé est émis pour CHAQUE jour de la plage, y compris les jours sans
    // dépense (OpenRouter omet les lignes à zéro) : ainsi tout delta couvre un
    // jour et un seul, et le prorata de spreadDelta ne peut jamais s'appliquer
    // à un trou à cheval sur deux mois.
    function splitCsvLine(line) {
        const out = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (inQuotes) {
                if (c === '"') {
                    if (line[i + 1] === '"') { cur += '"'; i += 1; }
                    else inQuotes = false;
                } else cur += c;
            } else if (c === '"') inQuotes = true;
            else if (c === ',') { out.push(cur); cur = ''; }
            else cur += c;
        }
        out.push(cur);
        return out;
    }

    // options : { dateMin, dateMax, keyName }
    // dateMin/dateMax ('YYYY-MM-DD', bornes incluses) servent à découper
    // l'import quand le job n8n prend le relais : sans elles, réimporter un CSV
    // chevauchant une période déjà relevée compterait la dépense deux fois.
    function parseOpenRouterCsv(raw, options) {
        const o = options || {};
        const erreurs = [];
        const lignes = String(raw == null ? '' : raw).split(/\r?\n/).filter(l => l.trim() !== '');
        if (!lignes.length) {
            return { ok: false, snapshots: [], meta: null, erreurs: ['fichier vide'] };
        }

        // En-tête présent, sauf si la première cellule est déjà une date.
        const premiere = splitCsvLine(lignes[0]).map(c => c.trim());
        let iDate = 0, iModele = 1, iUsage = 2, debut = 0;
        if (!JOUR_RE.test(premiere[0] || '')) {
            const h = premiere.map(c => c.toLowerCase());
            const trouve = (noms, def) => {
                for (const n of noms) {
                    const i = h.indexOf(n);
                    if (i !== -1) return i;
                }
                return def;
            };
            iDate = trouve(['date__day', 'date', 'day', 'jour'], 0);
            iModele = trouve(['model', 'modele', 'modèle'], 1);
            iUsage = trouve(['total_usage', 'usage', 'cost', 'total', 'montant'], 2);
            debut = 1;
        }

        const borne = (v) => (JOUR_RE.test(String(v || '')) ? String(v) : null);
        const dateMin = borne(o.dateMin);
        const dateMax = borne(o.dateMax);

        const parJour = {};
        const parModele = {};
        let nbLignes = 0, nbIgnorees = 0, nbHorsBornes = 0, totalUsd = 0;

        for (let i = debut; i < lignes.length; i++) {
            const cells = splitCsvLine(lignes[i]);
            const jour = String(cells[iDate] || '').trim();
            const brut = String(cells[iUsage] == null ? '' : cells[iUsage]).trim();
            const usage = Number(brut);
            // Number('') vaut 0 : sans le test explicite du vide, une ligne
            // tronquée passerait pour une journée à zéro au lieu d'être
            // comptée comme ignorée — un fichier abîmé paraîtrait sain.
            if (!JOUR_RE.test(jour) || brut === '' || !isFinite(usage)) { nbIgnorees += 1; continue; }
            // Un montant négatif (avoir, correction) ferait reculer le cumulé et
            // déclencherait à tort la détection de « compteur redémarré ».
            if (usage < 0) { nbIgnorees += 1; continue; }
            if ((dateMin && jour < dateMin) || (dateMax && jour > dateMax)) { nbHorsBornes += 1; continue; }
            const modele = String(cells[iModele] || '').trim() || 'Inconnu';
            nbLignes += 1;
            totalUsd += usage;
            parJour[jour] = (parJour[jour] || 0) + usage;
            parModele[modele] = (parModele[modele] || 0) + usage;
        }

        const jours = Object.keys(parJour).sort();
        if (!jours.length) {
            erreurs.push(nbHorsBornes ? 'aucune ligne dans les bornes demandées' : 'aucune ligne exploitable');
            return { ok: false, snapshots: [], meta: null, erreurs };
        }

        const keyName = String(o.keyName || 'export-csv');
        const premierJour = jours[0];
        const dernierJour = jours[jours.length - 1];
        const t0 = Date.parse(premierJour + 'T00:00:00Z');
        const tN = Date.parse(dernierJour + 'T00:00:00Z');

        const snapshots = [{ ts: new Date(t0).toISOString(), tsMs: t0, keyName, usageCumule: 0 }];
        let cumul = 0;
        let joursSansDepense = 0;
        for (let t = t0; t <= tN; t += 86400000) {
            const jour = new Date(t).toISOString().slice(0, 10);
            if (!parJour[jour]) joursSansDepense += 1;
            cumul += (parJour[jour] || 0);
            const ts = t + 86400000;
            snapshots.push({ ts: new Date(ts).toISOString(), tsMs: ts, keyName, usageCumule: cumul });
        }

        return {
            ok: true,
            snapshots,
            meta: {
                premierJour,
                dernierJour,
                nbJours: Math.round((tN - t0) / 86400000) + 1,
                joursAvecDepense: jours.length,
                joursSansDepense,
                nbLignes,
                nbIgnorees,
                nbHorsBornes,
                totalUsd,
                keyName,
                modeles: Object.keys(parModele)
                    .map(m => ({ modele: m, usd: parModele[m] }))
                    .sort((a, b) => b.usd - a.usd),
            },
            erreurs,
        };
    }

    // Le bucket peut servir l'un ou l'autre des deux formats du projet : les
    // relevés JSON empilés par le job, ou l'export CSV « total usage ». On
    // RENIFLE le contenu au lieu de se fier au nom du fichier ou de la variable
    // qui l'a apporté : une URL rangée sous le mauvais nom donnerait sinon une
    // page vide, sans le moindre message.
    function parseOpenRouterFichier(raw, options) {
        const o = options || {};
        const texte = String(raw == null ? '' : raw).replace(/^\uFEFF/, '');
        if (!texte.trim()) {
            return { type: null, snapshots: [], meta: null, erreurs: ['fichier vide'] };
        }

        const enJson = () => {
            const snapshots = parseOpenRouterUsage(texte);
            return snapshots.length ? { type: 'json', snapshots, meta: null, erreurs: [] } : null;
        };
        const enCsv = () => {
            const res = parseOpenRouterCsv(texte, o);
            return res.ok ? { type: 'csv', snapshots: res.snapshots, meta: res.meta, erreurs: res.erreurs } : null;
        };

        // Le premier caractère donne l'ordre d'essai, mais on tente TOUJOURS
        // l'autre format en repli.
        const jsonDabord = /^[[{"]/.test(texte.trim());
        const r = jsonDabord ? (enJson() || enCsv()) : (enCsv() || enJson());
        if (r) return r;
        return {
            type: null, snapshots: [], meta: null,
            erreurs: ['format non reconnu (ni relevés JSON ni export CSV)'],
        };
    }

    // Deux couvertures décrivent la même dépense si elles portent sur la même
    // plage pour le même total. Sert à ne pas compter deux fois un export
    // présent à la fois dans le bucket et dans le stockage local.
    function memeCouverture(a, b) {
        if (!a || !b) return false;
        return a.premierJour === b.premierJour
            && a.dernierJour === b.dernierJour
            && Math.abs((Number(a.totalUsd) || 0) - (Number(b.totalUsd) || 0)) < 0.01;
    }

    // Couvertures qui se recouvrent dans une liste.
    //
    // Toute l'architecture repose sur des fichiers DISJOINTS — un par compte,
    // ou par année — qui s'additionnent. Un recouvrement casse cette hypothèse
    // et double la dépense sur la période commune. On le détecte pour le DIRE,
    // jamais pour corriger en silence : seul l'auteur des fichiers sait si deux
    // périodes communes sont deux comptes réels ou un doublon.
    function chevauchements(couvertures) {
        const l = (couvertures || [])
            .filter(c => c && JOUR_RE.test(String(c.premierJour || ''))
                && JOUR_RE.test(String(c.dernierJour || '')))
            .slice()
            .sort((a, b) => String(a.premierJour).localeCompare(String(b.premierJour)));
        const paires = [];
        for (let i = 1; i < l.length; i++) {
            for (let j = 0; j < i; j++) {
                if (l[i].premierJour <= l[j].dernierJour) paires.push([l[j], l[i]]);
            }
        }
        return paires;
    }

    // Persistance de l'historique importé. Séparée du registre : ce ne sont pas
    // des lignes saisies mais des relevés, et ils se fusionnent avec ceux du job
    // n8n plutôt que de les remplacer.
    //
    // PLUSIEURS imports coexistent, et c'est le cas normal : une migration de
    // compte OpenRouter laisse deux exports disjoints, chacun avec son propre
    // compteur cumulé. Chaque import reçoit donc sa propre clé, et le moteur
    // traite les séries indépendamment — additionner deux comptes actifs en même
    // temps reste juste, puisque les deux ont réellement dépensé.
    //
    // Le vrai danger n'est pas le chevauchement mais le RÉIMPORT du même
    // fichier : là, la dépense serait comptée deux fois. addHistorique le
    // détecte et refuse, plutôt que de laisser un total doubler en silence.
    function readHistoriqueBrut(st) {
        let parsed;
        try {
            parsed = JSON.parse(st.getItem(LS_HISTORIQUE) || 'null');
        } catch (e) {
            console.warn('Historique OpenRouter illisible, ignoré.', e);
            return { version: 2, imports: [] };
        }
        if (!parsed) return { version: 2, imports: [] };
        // Format v1 (un seul import à plat) : on le remonte en v2 au lieu de le
        // jeter, sinon une mise à jour du code effacerait un import déjà fait.
        if (Array.isArray(parsed.snapshots)) {
            return {
                version: 2,
                imports: [{
                    id: 'csv1',
                    libelle: 'export importé',
                    importeLe: parsed.importeLe || null,
                    meta: parsed.meta || null,
                    snapshots: parsed.snapshots,
                }],
            };
        }
        if (!Array.isArray(parsed.imports)) return { version: 2, imports: [] };
        return { version: 2, imports: parsed.imports.filter(i => i && Array.isArray(i.snapshots)) };
    }

    function ecrireHistorique(st, etat) {
        try {
            st.setItem(LS_HISTORIQUE, JSON.stringify({ version: 2, imports: etat.imports }));
            return true;
        } catch (e) {
            console.error("Écriture de l'historique OpenRouter impossible.", e);
            return false;
        }
    }

    // Ajoute un import. Retourne { ok, motif, id }.
    function addHistorique(resultat, storage, libelle) {
        const st = localStore(storage);
        if (!st) return { ok: false, motif: 'stockage indisponible' };
        if (!resultat || !resultat.ok || !resultat.meta) return { ok: false, motif: 'import invalide' };

        const etat = readHistoriqueBrut(st);
        const m = resultat.meta;

        // Même plage ET même total : c'est le même fichier, pas un second compte.
        const doublon = etat.imports.find(i => memeCouverture(i.meta, m));
        if (doublon) return { ok: false, motif: 'doublon', doublon };

        // Clé unique : le moteur regroupe par clé, deux imports ne doivent jamais
        // se retrouver dans la même série cumulée.
        let n = 0;
        etat.imports.forEach((i) => {
            const suffixe = parseInt(String(i.id || '').replace(/^csv/, ''), 10);
            if (isFinite(suffixe) && suffixe > n) n = suffixe;
        });
        const id = 'csv' + (n + 1);
        const keyName = 'import:' + id;

        etat.imports.push({
            id,
            libelle: String(libelle || 'export CSV').slice(0, 80),
            importeLe: new Date().toISOString(),
            meta: Object.assign({}, m, { keyName }),
            snapshots: resultat.snapshots.map(s => ({
                ts: s.ts, keyName, usageCumule: s.usageCumule,
            })),
        });
        etat.imports.sort((a, b) => String((a.meta && a.meta.premierJour) || '')
            .localeCompare(String((b.meta && b.meta.premierJour) || '')));

        if (!ecrireHistorique(st, etat)) return { ok: false, motif: 'écriture impossible' };
        return { ok: true, id };
    }

    // Retourne { imports, snapshots, premierJour, dernierJour, totalUsd } ou null.
    // `snapshots` est la fusion de tous les imports, déjà normalisée.
    function loadHistorique(storage) {
        const st = localStore(storage);
        if (!st) return null;
        const etat = readHistoriqueBrut(st);
        if (!etat.imports.length) return null;

        // On repasse par le normaliseur des relevés : même contrat de validation
        // que le fichier signé, donc aucune confiance accordée au localStorage.
        const imports = [];
        let tous = [];
        etat.imports.forEach((i) => {
            const snapshots = parseOpenRouterUsage(i.snapshots);
            if (!snapshots.length) return;
            imports.push({
                id: i.id,
                libelle: i.libelle,
                importeLe: i.importeLe || null,
                meta: i.meta || null,
                nbReleves: snapshots.length,
            });
            tous = tous.concat(snapshots);
        });
        if (!imports.length) return null;

        const jours = imports.map(i => i.meta).filter(Boolean);
        return {
            imports,
            snapshots: tous,
            premierJour: jours.length
                ? jours.map(m => m.premierJour).sort()[0] : null,
            dernierJour: jours.length
                ? jours.map(m => m.dernierJour).sort()[jours.length - 1] : null,
            totalUsd: jours.reduce((s, m) => s + (Number(m.totalUsd) || 0), 0),
        };
    }

    function removeHistorique(id, storage) {
        const st = localStore(storage);
        if (!st) return false;
        const etat = readHistoriqueBrut(st);
        const avant = etat.imports.length;
        etat.imports = etat.imports.filter(i => i.id !== id);
        if (etat.imports.length === avant) return false;
        if (!etat.imports.length) return clearHistorique(storage);
        return ecrireHistorique(st, etat);
    }

    function clearHistorique(storage) {
        const st = localStore(storage);
        if (!st) return false;
        try {
            st.removeItem(LS_HISTORIQUE);
            return true;
        } catch (e) {
            console.error("Suppression de l'historique OpenRouter impossible.", e);
            return false;
        }
    }

    // ===================== AGRÉGATION ET RÉCONCILIATION =====================

    // Agrège les deux sources par mois.
    //
    // RÈGLE ANTI-DOUBLE-COMPTAGE : sur un mois couvert par l'API OpenRouter,
    // une ligne de registre de catégorie 'inference' est exclue du total ET
    // signalée (jamais silencieusement). Le registre fait foi pour tout le
    // hors-inférence, et pour l'inférence des mois que l'API ne couvre pas
    // (antérieurs à la mise en route du job, irrécupérables par API).
    function aggregateMonthly(options) {
        const o = options || {};
        const params = normalizeParams(o.params);
        const registre = o.registre || [];
        const or = o.openRouter || {};
        const usdParMois = or.usdParMois || {};
        const moisCouverts = new Set(Object.keys(usdParMois));

        const parMois = {};
        const ensure = (m) => {
            if (!parMois[m]) {
                parMois[m] = {
                    mois: m,
                    openRouterEur: 0,
                    registreEur: 0,
                    totalEur: 0,
                    fixeEur: 0,
                    variableEur: 0,
                    parCategorie: {},
                    parFournisseur: {},
                    lignesIgnorees: [],
                };
            }
            return parMois[m];
        };

        Object.keys(usdParMois).forEach((m) => {
            const e = ensure(m);
            const eur = toEur(usdParMois[m], 'USD', params.tauxUsdEur);
            e.openRouterEur += eur;
            e.variableEur += eur; // l'inférence à l'usage est par nature variable
            e.parCategorie.inference = (e.parCategorie.inference || 0) + eur;
            e.parFournisseur.OpenRouter = (e.parFournisseur.OpenRouter || 0) + eur;
        });

        registre.forEach((l) => {
            if (!isValidMonth(l.mois)) return;
            const e = ensure(l.mois);
            if (l.categorie === 'inference' && moisCouverts.has(l.mois)) {
                e.lignesIgnorees.push({
                    id: l.id,
                    mois: l.mois,
                    fournisseur: l.fournisseur,
                    montant: l.montant,
                    devise: l.devise,
                    motif: "remplacé par l'API OpenRouter",
                });
                return;
            }
            const eur = toEur(l.montant, l.devise, params.tauxUsdEur);
            e.registreEur += eur;
            if (l.nature === 'fixe') e.fixeEur += eur;
            else e.variableEur += eur;
            e.parCategorie[l.categorie] = (e.parCategorie[l.categorie] || 0) + eur;
            const f = l.fournisseur || 'Non renseigné';
            e.parFournisseur[f] = (e.parFournisseur[f] || 0) + eur;
        });

        Object.keys(parMois).forEach((m) => {
            parMois[m].totalEur = parMois[m].openRouterEur + parMois[m].registreEur;
        });

        return {
            parMois,
            moisCouvertsOpenRouter: Array.from(moisCouverts).sort(),
            moisPartielOpenRouter: or.moisPartiel || null,
        };
    }

    // Somme un agrégat mensuel sur une plage inclusive de mois.
    function sumRange(parMois, start, end) {
        const res = {
            totalEur: 0,
            openRouterEur: 0,
            registreEur: 0,
            fixeEur: 0,
            variableEur: 0,
            parCategorie: {},
            parFournisseur: {},
            moisAvecDonnees: 0,
            lignesIgnorees: [],
        };
        monthsRange(start, end).forEach((m) => {
            const e = (parMois || {})[m];
            if (!e) return;
            res.moisAvecDonnees += 1;
            res.totalEur += e.totalEur;
            res.openRouterEur += e.openRouterEur;
            res.registreEur += e.registreEur;
            res.fixeEur += e.fixeEur;
            res.variableEur += e.variableEur;
            Object.keys(e.parCategorie).forEach((k) => {
                res.parCategorie[k] = (res.parCategorie[k] || 0) + e.parCategorie[k];
            });
            Object.keys(e.parFournisseur).forEach((k) => {
                res.parFournisseur[k] = (res.parFournisseur[k] || 0) + e.parFournisseur[k];
            });
            e.lignesIgnorees.forEach((l) => res.lignesIgnorees.push(l));
        });
        return res;
    }

    // ===================== KPIS =====================

    // Division gardée : null = non calculable. Jamais Infinity ni NaN, qui
    // s'afficheraient tels quels dans une tuile.
    function ratio(num, den) {
        const n = Number(num);
        const d = Number(den);
        if (!isFinite(n) || !isFinite(d) || d === 0) return null;
        const r = n / d;
        return isFinite(r) ? r : null;
    }

    function computeKpis(options) {
        const o = options || {};
        const params = normalizeParams(o.params);
        const depense = isFinite(Number(o.depenseEur)) ? Number(o.depenseEur) : 0;
        const effectif = params.effectifOverride || (Number(o.effectif) || 0);
        const utilisateursActifs = Number(o.utilisateursActifs) || 0;
        const heuresGagnees = Number(o.heuresGagnees) || 0;
        const joursPeriode = Number(o.joursPeriode) || 0;

        // Même définition que app.js:58 — CA / (effectif x heures annuelles).
        const tauxHoraire = ratio(params.caGroupe, effectif * params.heuresAnnuelles);
        const gainEur = (tauxHoraire === null) ? null : heuresGagnees * tauxHoraire;

        // La masse salariale est annuelle : on la proratise sur la période
        // observée, sinon le pourcentage serait ininterprétable hors année pleine.
        const masseProratisee = params.masseSalarialeAnnuelle * (joursPeriode / 365);
        const pctMasse = (masseProratisee > 0) ? ratio(depense, masseProratisee) : null;
        const pourMille = ratio(depense, params.caGroupe);

        // Une dépense à zéro ne veut pas dire « gratuit », elle veut dire
        // « aucun coût relevé sur la période ». On refuse donc d'en dériver des
        // ratios : un « 0 € par heure gagnée » se lirait comme une conclusion
        // (l'IA ne coûte rien) alors que l'information réelle est une absence
        // de donnée. Tous les ratios passent à null, la dépense reste affichée
        // à 0 et le bandeau de complétude explique ce qui manque.
        const mesuree = depense > 0;

        return {
            depenseEur: depense,
            depenseMesuree: mesuree,
            effectif,
            utilisateursActifs,
            heuresGagnees,
            joursPeriode,
            tauxHoraire,
            gainEur,
            coutParCollaborateur: mesuree ? ratio(depense, effectif) : null,
            coutParUtilisateurActif: mesuree ? ratio(depense, utilisateursActifs) : null,
            pctMasseSalariale: (mesuree && pctMasse !== null) ? pctMasse * 100 : null,
            coutParHeureGagnee: mesuree ? ratio(depense, heuresGagnees) : null,
            ratioLevier: (gainEur === null) ? null : ratio(gainEur, depense),
            coutPourMilleDeCA: (mesuree && pourMille !== null) ? pourMille * 1000 : null,
        };
    }

    // ===================== PROJECTION =====================

    // moisCourant est injecté ('YYYY-MM') plutôt que lu de l'horloge : la
    // fonction reste pure et testable.
    function projection(options) {
        const o = options || {};
        const parMois = o.parMois || {};
        const params = normalizeParams(o.params);
        const moisCourant = isValidMonth(o.moisCourant) ? o.moisCourant : null;

        if (!moisCourant) {
            return {
                runRate3m: null, realiseYTD: 0, projectionAnnee: null,
                pctBudgetConsomme: null, moisEpuisement: null, moisRestants: 0,
                moisRunRate: 0,
            };
        }

        const annee = moisCourant.slice(0, 4);

        // Réalisé sur l'année civile, mois courant inclus.
        let realiseYTD = 0;
        monthsRange(annee + '-01', moisCourant).forEach((m) => {
            if (parMois[m]) realiseYTD += parMois[m].totalEur;
        });

        // Run rate sur les 3 derniers mois COMPLETS. Le mois courant est en
        // cours : l'inclure tirerait la moyenne vers le bas et sous-estimerait
        // la projection.
        const complets = [];
        for (let i = 1; i <= 3; i++) {
            const m = addMonths(moisCourant, -i);
            if (parMois[m]) complets.push(parMois[m].totalEur);
        }
        const runRate3m = complets.length
            ? complets.reduce((a, b) => a + b, 0) / complets.length
            : null;

        const moisRestants = 12 - parseInt(moisCourant.slice(5, 7), 10);
        const projectionAnnee = (runRate3m === null) ? null : realiseYTD + runRate3m * moisRestants;
        const pctBudgetConsomme = (params.budgetAnnuelIA > 0)
            ? (realiseYTD / params.budgetAnnuelIA) * 100
            : null;

        // Mois de franchissement du budget, extrapolé au run rate. Peut tomber
        // après décembre : l'information reste utile ("épuisé en mars N+1").
        let moisEpuisement = null;
        if (params.budgetAnnuelIA > 0 && runRate3m !== null && runRate3m > 0) {
            if (realiseYTD >= params.budgetAnnuelIA) {
                moisEpuisement = moisCourant;
            } else {
                let cumul = realiseYTD;
                let m = moisCourant;
                for (let i = 1; i <= 60; i++) {
                    cumul += runRate3m;
                    m = addMonths(m, 1);
                    if (cumul >= params.budgetAnnuelIA) { moisEpuisement = m; break; }
                }
            }
        }

        return {
            runRate3m, realiseYTD, projectionAnnee, pctBudgetConsomme,
            moisEpuisement, moisRestants, moisRunRate: complets.length,
        };
    }

    // ===================== INSTANTANÉ DES GAINS =====================

    // Publié par app.js (publishGainsSnapshot) en sessionStorage — effacé à la
    // fermeture de l'onglet, contrairement à localStorage.
    function readGainsSnapshot(storage) {
        const st = pickStore(storage, (typeof sessionStorage !== 'undefined') ? sessionStorage : null);
        if (!st) return null;
        try {
            const raw = st.getItem(SS_SNAPSHOT);
            if (!raw) return null;
            const s = JSON.parse(raw);
            if (!s || !s.byMonth || typeof s.byMonth !== 'object') return null;
            return s;
        } catch (e) {
            return null;
        }
    }

    // Gains sur une plage de mois.
    //
    // Les utilisateurs uniques ne sont PAS sommables entre mois (un même
    // collaborateur actif en janvier et en février compte une fois). On
    // retourne le maximum mensuel : une borne basse exacte, préférable à une
    // somme qui serait franchement fausse.
    //
    // Pas de compteur d'usages : additionner des contrats, des contacts, des
    // pages, des messages et des points de contrôle ne produirait aucun nombre
    // interprétable. Le volume se lit sur le dashboard, brique par brique.
    function gainsForRange(snapshot, start, end) {
        const res = { heures: 0, utilisateursMaxMois: 0, moisCouverts: 0 };
        if (!snapshot || !snapshot.byMonth) return res;
        monthsRange(start, end).forEach((m) => {
            const e = snapshot.byMonth[m];
            if (!e) return;
            res.moisCouverts += 1;
            res.heures += Number(e.hours) || 0;
            res.utilisateursMaxMois = Math.max(res.utilisateursMaxMois, Number(e.users) || 0);
        });
        return res;
    }

    // ===================== EXPORT / IMPORT JSON =====================

    // Sauvegarde de secours : la saisie vit en localStorage, qu'un vidage de
    // cache efface. Sert aussi de chemin de migration vers un fichier du bucket.
    function exportJson(registre, params, dateIso) {
        return JSON.stringify({
            version: 1,
            exporteLe: dateIso || null,
            registre: (registre || []).map(validateLigne).filter(r => r.ok).map(r => r.ligne),
            parametres: normalizeParams(params),
        }, null, 2);
    }

    function importJson(text) {
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            return { ok: false, registre: [], parametres: normalizeParams(null), erreurs: ['JSON illisible'] };
        }
        if (!parsed || typeof parsed !== 'object') {
            return { ok: false, registre: [], parametres: normalizeParams(null), erreurs: ['format inattendu'] };
        }
        const erreurs = [];
        const registre = [];
        const brut = Array.isArray(parsed.registre) ? parsed.registre : [];
        brut.forEach((l, i) => {
            const v = validateLigne(l);
            if (v.ok) registre.push(v.ligne);
            else erreurs.push('ligne ' + (i + 1) + ' : ' + v.erreurs.join(', '));
        });
        return {
            ok: true,
            registre,
            parametres: normalizeParams(parsed.parametres),
            erreurs,
        };
    }

    // ===================== EXPORT =====================

    return {
        // constantes
        LS_REGISTRE,
        LS_PARAMS,
        SS_SNAPSHOT,
        LS_HISTORIQUE,
        CATEGORIES,
        NATURES,
        DEVISES,
        DEFAULT_PARAMS,
        // mois
        monthKey,
        isValidMonth,
        addMonths,
        monthsRange,
        monthBounds,
        daysInMonthRange,
        // devises
        toEur,
        // registre
        validateLigne,
        loadRegistre,
        saveRegistre,
        // paramètres
        normalizeParams,
        loadParams,
        saveParams,
        // relevés openrouter
        parseOpenRouterUsage,
        parseOpenRouterCsv,
        parseOpenRouterFichier,
        memeCouverture,
        chevauchements,
        addHistorique,
        loadHistorique,
        removeHistorique,
        clearHistorique,
        spreadDelta,
        monthlySpendFromSnapshots,
        // agrégation
        aggregateMonthly,
        sumRange,
        // kpis
        ratio,
        computeKpis,
        projection,
        // gains
        readGainsSnapshot,
        gainsForRange,
        // sauvegarde
        exportJson,
        importJson,
    };
})();

// Navigateur : namespace global. Node (tests) : module CommonJS.
if (typeof window !== 'undefined') window.KPICosts = KPICosts;
if (typeof module !== 'undefined' && module.exports) module.exports = KPICosts;
