// ============================================================================
// shared/adoption.js — Note d'adoption par utilisateur et taux d'appropriation
// par agence. Partagé par index (popup Utilisateurs) et adoption-agences :
// même catalogue, même calcul, mêmes chiffres.
//
// Chargé en <script> classique APRÈS shared/utils.js (namespace KPI) :
//     <script src="shared/utils.js"></script>
//     <script src="shared/adoption.js"></script>
// Expose le namespace global `KPIAdoption`. Importable en Node pour les tests.
//
// Les fonctions ne lisent aucune variable de page : les données (tableaux
// d'items déjà parsés) et les prédicats propres aux sources sont passés en
// paramètres.
// ============================================================================

const KPIAdoption = (function () {
    'use strict';

    const K = (typeof KPI !== 'undefined') ? KPI : require('./utils.js');

    const FILIALES = {
        CT:    { label: 'BTP Consultants',     domain: '@btp-consultants.fr' },
        SPS:   { label: 'BTP Consultants SPS', domain: null }, // isolée par la source, pas par le domaine
        CITAE: { label: 'Citae',               domain: '@citae.fr' },
        DIAG:  { label: 'BTP Diagnostics',     domain: '@btp-diagnostics.fr' },
    };

    // Seuil du taux d'appropriation : profil « Régulier » ou au-delà.
    const APPROPRIATION_MIN = K.ADOPTION.levels[K.ADOPTION.levels.length - 3][0];

    /**
     * Catalogue des modules IA suivis par utilisateur. Ajouter un module =
     * ajouter UNE entrée ici : il apparaît dans la popup, entre dans le
     * périmètre de sa filiale et prend un poids d'exposition calculé depuis son
     * premier usage observé (ou depuis `lancement`, à renseigner si les données
     * contiennent des essais antérieurs au vrai lancement).
     *
     * data : tableaux d'items parsés (absents = vides). h : prédicats propres
     * aux sources { isDescriptifRow, isNFHabitatItem } (cf. shared/sources.js).
     * events() renvoie les lignes d'usage réel, toutes périodes confondues
     * ({ email, createdAt }) : une ligne = une session. Mêmes règles d'usage
     * réel que le COPIL (publishCopilSnapshot).
     */
    function catalogue(data, h) {
        const d = data || {};
        const get = key => d[key] || [];
        const notYield = item => !(item.contractNumber || '').toUpperCase().includes('YIELD');
        // AIDeliverable / AnalyticEvent : plusieurs lignes par livrable (Notice +
        // Report) — un livrable = une utilisation.
        const uniqueDeliverables = items => {
            const seen = new Set();
            return items.filter(item => {
                if (!item.deliverableId) return true;
                if (seen.has(item.deliverableId)) return false;
                seen.add(item.deliverableId);
                return true;
            });
        };
        const wordCount = item => (typeof item.descriptionWordCount === 'number')
            ? item.descriptionWordCount
            : K.countWords(K.extractText(item.description || ''));
        const { CT, SPS, CITAE, DIAG } = FILIALES;

        return [
            // BTP Consultants (contrôle technique)
            // Descriptif : au-delà de 100 mots l'IA apporte une valeur réelle (seuil COPIL).
            { id: 'descriptif', label: 'Descriptif', filiale: CT,
              events: () => get('descriptif').filter(i => notYield(i) && h.isDescriptifRow(i) && wordCount(i) >= 100) },
            { id: 'autocontact', label: 'Auto-contact', filiale: CT,
              events: () => get('autocontact').filter(i => notYield(i) && i.fromAI) },
            { id: 'comparateur', label: 'Comparateur', filiale: CT,
              events: () => get('comparateur') },
            // Géotech / Acoustique : l'email est celui du chargé d'affaires.
            { id: 'analyse-geo', label: 'Géotechnique', filiale: CT,
              events: () => uniqueDeliverables(get('geotech')) },
            { id: 'analyse-acou', label: 'Acoustique', filiale: CT,
              events: () => uniqueDeliverables(get('acoustique')) },
            // CCTP : utilisateur réel = la personne qui a injecté les avis, sinon
            // le chargé d'affaires (arbitrage du 30/10/2026, K.cctpUsageEvents).
            { id: 'analyse-cctp', label: 'CCTP', filiale: CT,
              events: () => K.cctpUsageEvents(get('cctp')) },
            { id: 'expert-ct', label: 'Expert', filiale: CT, events: () => get('expertCT') },
            { id: 'chat-ct', label: 'Chat', filiale: CT, events: () => get('chatCT') },

            // BTP Consultants SPS
            { id: 'autocontact-sps', label: 'Auto-contact', filiale: SPS,
              events: () => get('autocontactSps').filter(i => i.fromAI) },
            { id: 'expert-sps', label: 'Expert', filiale: SPS, events: () => get('expertSps') },
            { id: 'chat-sps', label: 'Chat', filiale: SPS, events: () => get('chatSps') },

            // Citae
            { id: 'nf-habitat', label: 'NF Habitat', filiale: CITAE,
              events: () => get('nfHabitat').filter(h.isNFHabitatItem) },
            { id: 'expert-citae', label: 'Expert', filiale: CITAE, events: () => get('expertCitae') },
            { id: 'chat-citae', label: 'Chat', filiale: CITAE, events: () => get('chatCitae') },

            // BTP Diagnostics
            { id: 'expert-diag', label: 'Expert', filiale: DIAG, events: () => get('expertDiag') },
            { id: 'chat-diag', label: 'Chat', filiale: DIAG, events: () => get('chatDiag') },
        ];
    }

    // Code agence d'un item : agence portée par l'item, sinon celle du numéro
    // d'affaire (C-<AGENCE>-…). « Non spécifié » (chats sans service) = vide.
    function itemAgency(item) {
        let agency = item.agencyCode || '';
        if (!agency && typeof item.contractNumber === 'string') {
            const m = item.contractNumber.match(/C-([A-Z0-9]+)-/);
            if (m) agency = m[1];
        }
        if (!agency) agency = item.agency || '';
        agency = String(agency).trim().toUpperCase();
        return agency === 'NON SPÉCIFIÉ' ? '' : agency;
    }

    // Filtre de dates de page ({startDate, endDate} en 'YYYY-MM-DD' ou null) →
    // bornes incluses, du début du premier jour à la fin du dernier.
    function periodFromFilter(filter) {
        const f = filter || {};
        const start = f.startDate ? new Date(f.startDate) : null;
        if (start) start.setHours(0, 0, 0, 0);
        const end = f.endDate ? new Date(f.endDate) : null;
        if (end) end.setHours(23, 59, 59, 999);
        return { start, end };
    }

    // Les `months` derniers mois jusqu'à refDate inclus (ex. 6 mois au 15/10 →
    // du 16/04 au 15/10).
    function lastMonths(refDate, months) {
        if (!refDate) return { start: null, end: null };
        const start = new Date(refDate.getFullYear(), refDate.getMonth() - months, refDate.getDate() + 1);
        const end = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate(), 23, 59, 59, 999);
        return { start, end };
    }

    /**
     * Utilisateurs actifs, une ligne par couple (email, filiale) : chacun est
     * noté sur le périmètre de modules de SA filiale (cf. KPI.adoptionScore).
     * period : { start, end } (Date ou null), cf. periodFromFilter / lastMonths.
     * Agence de rattachement : agence majoritaire de ses sessions, toutes
     * périodes confondues (code de l'affaire, ou service de production pour les
     * chats) — elle ne bouge pas avec la période.
     * Date de référence : fin de la période, plafonnée au dernier usage observé
     * (jamais « aujourd'hui » — mêmes données, même note).
     * Returns { refDate, modules, users: [{email, filiale, agency, features: Set,
     *           sessions, firstActivity, lastActivity, adoption}] }
     */
    function collect(catalogueModules, period) {
        const modules = catalogueModules.map(m => {
            const domain = m.filiale.domain;
            const events = [];
            m.events().forEach(item => {
                const email = (item.email || '').toLowerCase().trim();
                if (!email || (domain && !email.includes(domain))) return;
                const date = K.parseFrenchDate(item.createdAt);
                if (!date) return;
                events.push({ email, date, agency: itemAgency(item) });
            });
            // Lancement : premier usage observé, toutes périodes confondues.
            const launch = m.lancement || events.reduce((min, e) => (!min || e.date < min ? e.date : min), null);
            return { id: m.id, label: m.label, filiale: m.filiale.label, events, launch };
        });

        const start = period && period.start, end = period && period.end;
        const inRange = d => (!start || d >= start) && (!end || d <= end);

        let refDate = null;
        modules.forEach(m => m.events.forEach(e => { if (!refDate || e.date > refDate) refDate = e.date; }));
        if (end && refDate && end < refDate) refDate = end;

        // Somme des poids d'exposition des modules de chaque filiale.
        const exposure = {};
        modules.forEach(m => {
            exposure[m.filiale] = (exposure[m.filiale] || 0) + K.exposureWeight(m.launch, refDate);
        });

        const agencies = {}; // email|filiale → [codes agence de toutes ses sessions]
        modules.forEach(m => m.events.forEach(e => {
            const key = e.email + '|' + m.filiale;
            (agencies[key] = agencies[key] || []).push(e.agency);
        }));

        const usersMap = new Map(); // email|filiale → user
        modules.forEach(m => m.events.forEach(e => {
            if (!inRange(e.date)) return;
            const key = e.email + '|' + m.filiale;
            if (!usersMap.has(key)) {
                usersMap.set(key, { email: e.email, filiale: m.filiale, agency: K.mode(agencies[key]) || '',
                                    features: new Set(), moduleIds: new Set(),
                                    sessions: 0, weeks: new Set(), firstActivity: null, lastActivity: null });
            }
            const u = usersMap.get(key);
            u.features.add(m.label);
            u.moduleIds.add(m.id);
            u.sessions += 1;
            u.weeks.add(K.weekIndex(e.date));
            if (!u.firstActivity || e.date < u.firstActivity) u.firstActivity = e.date;
            if (!u.lastActivity || e.date > u.lastActivity) u.lastActivity = e.date;
        }));

        const users = Array.from(usersMap.values());
        users.forEach(u => {
            u.adoption = K.adoptionScore({
                sessions: u.sessions,
                activeWeeks: u.weeks.size,
                firstDate: u.firstActivity,
                lastDate: u.lastActivity,
                modulesUsed: u.moduleIds.size,
                exposure: exposure[u.filiale] || 0,
            }, refDate);
        });
        users.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));

        return { refDate, modules, users };
    }

    /**
     * Taux d'appropriation de l'IA par agence = collaborateurs de la filiale
     * rattachés à l'agence avec une note ≥ APPROPRIATION_MIN ÷ effectif de
     * l'agence (population). Un collaborateur sans usage compte dans l'effectif
     * avec une note de zéro.
     * population : [{dr, agencyCode, effectif}] (population cible du dashboard).
     * Returns { rows: [{agency, dr, effectif, actifs, sansUsage, levels: {profil: n},
     *                   appropries, taux, mediane, niveauMediane}],
     *           totals: {effectif, appropries, taux}, medianTaux,
     *           horsPopulation: {utilisateurs, appropries} }
     */
    function agencyAppropriation(users, population, opts) {
        const o = opts || {};
        const filiale = o.filiale || FILIALES.CT.label;
        const min = typeof o.threshold === 'number' ? o.threshold : APPROPRIATION_MIN;
        const scoped = (users || []).filter(u => u.filiale === filiale);
        const byAgency = {};
        scoped.forEach(u => { (byAgency[u.agency] = byAgency[u.agency] || []).push(u); });

        const known = new Set();
        const rows = (population || []).filter(p => p.agencyCode).map(p => {
            known.add(p.agencyCode);
            const us = byAgency[p.agencyCode] || [];
            const appropries = us.filter(u => u.adoption.score >= min).length;
            const med = K.median(us.map(u => u.adoption.score));
            const levels = {};
            K.ADOPTION.levels.forEach(([, label]) => { levels[label] = 0; });
            us.forEach(u => { levels[u.adoption.level] = (levels[u.adoption.level] || 0) + 1; });
            return {
                agency: p.agencyCode,
                dr: p.dr || '',
                effectif: p.effectif,
                actifs: us.length,
                // Collaborateurs de l'effectif sans aucun usage sur la période
                // (0 si le rattachement par activité dépasse l'effectif).
                sansUsage: Math.max(0, p.effectif - us.length),
                levels,
                appropries,
                taux: p.effectif > 0 ? appropries / p.effectif : null,
                mediane: med === null ? null : Math.round(med),
                niveauMediane: med === null ? null : K.adoptionLevel(Math.round(med)),
            };
        });

        const outside = scoped.filter(u => !known.has(u.agency));
        const effectif = rows.reduce((s, r) => s + (r.effectif || 0), 0);
        const appropries = rows.reduce((s, r) => s + r.appropries, 0);
        return {
            rows,
            totals: { effectif, appropries, taux: effectif ? appropries / effectif : null },
            medianTaux: K.median(rows.filter(r => r.taux !== null).map(r => r.taux)),
            horsPopulation: {
                utilisateurs: outside.length,
                appropries: outside.filter(u => u.adoption.score >= min).length,
            },
        };
    }

    return {
        FILIALES,
        APPROPRIATION_MIN,
        catalogue,
        itemAgency,
        periodFromFilter,
        lastMonths,
        collect,
        agencyAppropriation,
    };
})();

// Navigateur : namespace global. Node (tests) : module CommonJS.
if (typeof window !== 'undefined') window.KPIAdoption = KPIAdoption;
if (typeof module !== 'undefined' && module.exports) module.exports = KPIAdoption;
