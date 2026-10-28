// ============================================================================
// shared/cctp-rict.js — Adoption de l'Analyse CCTP mesurée DANS LES RICT.
// Partagé par analyse-cctp.html (vue d'ensemble, déchet par mission) et la
// page Adoption (taux d'usage par personne et par agence).
//
// Source : card Metabase 161, exposée par le webhook sous ANALYSE_CCTP_RICT_URL
// (analyse_cctp_rict.json). 1 ligne = 1 RICT diffusé depuis le 12/10/2026,
// hors YIELD. Cf. metabase-queries.md, card 161.
//
// Chargé en <script> classique APRÈS shared/utils.js (namespace KPI) :
//     <script src="shared/utils.js"></script>
//     <script src="shared/cctp-rict.js"></script>
// Expose le namespace global `KPICctpRict`. Importable en Node pour les tests.
//
// Trois mesures, à ne pas confondre :
//  - taux de recours   = RICT avec analyse IA AVANT diffusion ÷ RICT diffusés
//  - part IA du rapport = avis d'origine IA ÷ avis du rapport (RICT avec IA)
//                         → « adoption rapportée au maximum accessible »
//  - taux d'utilisation = avis d'origine IA ÷ avis émis par l'IA (RICT avec IA)
//                         ; déchet = 1 − taux d'utilisation
// Les avis comparés sont Favorable / Suspendu / Défavorable uniquement : ceux
// que l'IA sait produire (Hors mission, Sans objet exclus des deux côtés).
// ============================================================================

const KPICctpRict = (function () {
    'use strict';

    const K = (typeof KPI !== 'undefined') ? KPI : require('./utils.js');

    // Missions produites par l'IA. Les notices S+ sont rangées dans ces
    // familles en SQL (SEI/SH/STI → S, LE → L) ; le reste tombe dans « Autre ».
    const MISSIONS = ['L', 'P1', 'S', 'F', 'PV'];

    function _int(v) {
        const n = parseInt(v, 10);
        return isNaN(n) ? 0 : n;
    }

    function _str(v) {
        return v === null || v === undefined ? '' : String(v).trim();
    }

    // Lignes de la card (objets clé = nom de colonne) → items normalisés.
    function parseRows(rows) {
        if (!Array.isArray(rows)) return [];
        const items = [];
        rows.forEach(r => {
            if (!r || typeof r !== 'object') return;
            const reportId = _str(r.ReportId);
            if (!reportId) return;
            const contractNumber = _str(r.ContractNumber);
            if (contractNumber.toUpperCase().includes('YIELD')) return;
            const m = contractNumber.match(/C-([A-Z0-9]+)-/);
            const analysesAvant = _int(r.AnalysesAvant);
            items.push({
                reportId,
                // createdAt : nom commun à toutes les sources, pour les filtres
                // de période existants. C'est la date de DIFFUSION du RICT.
                createdAt: _str(r.DiffusedAt),
                contractNumber,
                agencyCode: m ? m[1] : null,
                // Chargé d'affaires (SubAffair.userId) — même convention que card 160.
                email: _str(r.UserEmail).toLowerCase(),
                direction: _str(r.DR),
                agency: _str(r.Agence),
                // Rédacteur du RICT (Report.createdById) : différent dans ~8 % des cas.
                author: _str(r.AuthorEmail).toLowerCase(),
                authorDirection: _str(r.AuthorDR),
                authorAgency: _str(r.AuthorAgence),
                analysesAvant,
                avecIa: analysesAvant > 0,
                avisIaEmis: _int(r.AvisIaEmis),
                avisIaEmisParMission: K.parseMissionCounts(_str(r.AvisIaEmisParMission)),
                avisRapport: _int(r.AvisRapport),
                avisRapportIa: _int(r.AvisRapportIa),
                avisRapportIaParMission: K.parseMissionCounts(_str(r.AvisRapportIaParMission)),
                avisIaInjectes: _int(r.AvisIaInjectes),
                avisIaSupprimes: _int(r.AvisIaSupprimes),
            });
        });
        return items;
    }

    function _csvToObjects(csv) {
        const rows = K.parseFullCSV(csv, ',');
        if (rows.length < 2) return [];
        const header = rows[0];
        return rows.slice(1).map(cols => {
            const o = {};
            header.forEach((h, i) => { o[h] = cols[i] !== undefined ? cols[i] : ''; });
            return o;
        });
    }

    // Accepte les 4 enveloppes du projet : CSV brut, [{data: csv|json}],
    // {data: csv|json}, tableau JSON direct.
    function parsePayload(text) {
        if (!text || typeof text !== 'string') return [];
        let payload = null;
        try { payload = JSON.parse(text); } catch (_) { /* CSV brut */ }
        const fromInner = inner => {
            let j = null;
            try { j = JSON.parse(inner); } catch (_) { /* CSV */ }
            return Array.isArray(j) ? parseRows(j) : parseRows(_csvToObjects(inner));
        };
        if (payload === null) return parseRows(_csvToObjects(text));
        if (Array.isArray(payload) && payload.length && payload[0] && typeof payload[0].data === 'string') {
            return fromInner(payload[0].data);
        }
        if (payload && !Array.isArray(payload) && typeof payload.data === 'string') {
            return fromInner(payload.data);
        }
        if (Array.isArray(payload)) return parseRows(payload);
        return [];
    }

    // Ratio sûr : null (et non 0) quand le dénominateur est nul — « pas de
    // donnée » ne doit pas se lire « 0 % d'adoption ».
    function _ratio(a, b) {
        return b > 0 ? a / b : null;
    }

    /**
     * Agrégats d'un lot de RICT (déjà filtrés par période / DR / agence).
     *
     * Déchet d'un RICT = avis IA émis − avis IA retrouvés dans le rapport
     * (plancher 0), décomposé en :
     *  - supprimés après injection (rejet explicite, signal le plus net),
     *    plafonnés au déchet du RICT ;
     *  - jamais injectés (le reste).
     * Par mission : même calcul mission par mission ; les avis IA du rapport
     * classés « Autre » (mission S+ hors familles IA) ne sont pas ventilés.
     */
    function aggregate(items) {
        const s = {
            rict: 0, rictAvecIa: 0, rictAvecAvisIa: 0,
            avisRapport: 0, avisRapportAvecIa: 0, avisRapportIa: 0,
            avisIaEmis: 0, avisNonRetenus: 0, supprimes: 0, jamaisInjectes: 0,
            injectes: 0,
            tauxRecours: null, partIa: null, tauxUtilisation: null, tauxDechet: null,
            byMission: {},
        };
        MISSIONS.forEach(code => { s.byMission[code] = { emis: 0, repris: 0, dechet: 0, tauxDechet: null }; });
        const seen = new Set();
        (items || []).forEach(it => {
            if (!it || !it.reportId || seen.has(it.reportId)) return;
            seen.add(it.reportId);
            s.rict++;
            s.avisRapport += it.avisRapport;
            if (!it.avecIa) return;
            s.rictAvecIa++;
            if (it.avisRapportIa > 0) s.rictAvecAvisIa++;
            s.avisRapportAvecIa += it.avisRapport;
            s.avisRapportIa += it.avisRapportIa;
            s.avisIaEmis += it.avisIaEmis;
            s.injectes += it.avisIaInjectes;
            const nonRetenus = Math.max(0, it.avisIaEmis - it.avisRapportIa);
            const supprimes = Math.min(it.avisIaSupprimes, nonRetenus);
            s.avisNonRetenus += nonRetenus;
            s.supprimes += supprimes;
            s.jamaisInjectes += nonRetenus - supprimes;
            Object.keys(it.avisIaEmisParMission || {}).forEach(code => {
                if (!s.byMission[code]) s.byMission[code] = { emis: 0, repris: 0, dechet: 0, tauxDechet: null };
                const emis = it.avisIaEmisParMission[code];
                const repris = Math.min(emis, (it.avisRapportIaParMission || {})[code] || 0);
                s.byMission[code].emis += emis;
                s.byMission[code].repris += repris;
                s.byMission[code].dechet += emis - repris;
            });
        });
        Object.values(s.byMission).forEach(m => { m.tauxDechet = _ratio(m.dechet, m.emis); });
        s.tauxRecours = _ratio(s.rictAvecIa, s.rict);
        s.partIa = _ratio(s.avisRapportIa, s.avisRapportAvecIa);
        s.tauxUtilisation = _ratio(s.avisRapportIa, s.avisIaEmis);
        s.tauxDechet = _ratio(s.avisNonRetenus, s.avisIaEmis);
        return s;
    }

    /**
     * Regroupe les RICT par clé (personne, agence…) et agrège chaque groupe.
     * keyFn(item) → clé (vide = ignoré). Renvoie [{ key, ...aggregate }],
     * trié par nombre de RICT décroissant.
     *
     * Usage page Adoption : par rédacteur  → groupBy(items, i => i.author)
     *                       par agence     → groupBy(items, i => i.authorAgency)
     */
    function groupBy(items, keyFn) {
        const groups = new Map();
        (items || []).forEach(it => {
            const k = keyFn(it);
            if (!k) return;
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(it);
        });
        return Array.from(groups, ([key, list]) => Object.assign({ key }, aggregate(list)))
            .sort((a, b) => b.rict - a.rict || String(a.key).localeCompare(String(b.key)));
    }

    return {
        MISSIONS,
        parseRows,
        parsePayload,
        aggregate,
        groupBy,
    };
})();

// Navigateur : namespace global. Node (tests) : module CommonJS.
if (typeof window !== 'undefined') window.KPICctpRict = KPICctpRict;
if (typeof module !== 'undefined' && module.exports) module.exports = KPICctpRict;
