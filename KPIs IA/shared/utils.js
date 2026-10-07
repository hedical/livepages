// ============================================================================
// shared/utils.js — Fonctions et constantes partagées du dashboard KPIs IA.
//
// Chargé en <script> classique AVANT le script de page :
//     <script src="shared/utils.js"></script>
//     <script src="ma-page.js"></script>
// Expose le namespace global `KPI` (window.KPI dans le navigateur).
//
// Également importable en Node pour les tests :
//     const KPI = require('./shared/utils.js');
//     node --test tests/
//
// RÈGLE : toute fonction pure dupliquée entre plusieurs pages doit vivre ici.
// Les pages délèguent (function parseCSVLine(l) { return KPI.parseCSVLine(l); })
// pour ne pas casser leurs call sites existants.
// ============================================================================

const KPI = (function () {
    'use strict';

    // ===================== CONSTANTES MÉTIER =====================

    // Type des "vrais" descriptifs IA. Les lignes au type vide (RICT sans
    // génération IA, hasAi=false) ne sont PAS des descriptifs générés.
    const DESCRIPTIF_TYPE = 'DESCRIPTIF_SOMMAIRE_DES_TRAVAUX';

    // Mise en place effective du module Analyse AO (UTC minuit, cohérent avec
    // les filtres de période new Date('YYYY-MM-DD')). Les marchés détectés
    // avant cette date (test / backfill) ne sont jamais comptabilisés.
    const AO_MODULE_START_DATE = new Date('2026-06-06');

    // ===================== PARSING CSV =====================

    // Parse une ligne CSV : guillemets, virgules internes, échappement "".
    // Les valeurs sont trimées.
    function parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const next = i + 1 < line.length ? line[i + 1] : null;
            if (char === '"') {
                if (inQuotes && next === '"') { current += '"'; i++; }
                else { inQuotes = !inQuotes; }
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim());
        return values;
    }

    // Parse un CSV complet : gère les retours à la ligne DANS les champs
    // entre guillemets, CRLF/LF/CR, échappement "". Ignore les lignes vides.
    // `delimiter` par défaut ',' — l'export backoffice BTP Force utilise ';'.
    function parseFullCSV(csvString, delimiter) {
        const sep = delimiter || ',';
        const rows = [];
        let currentRow = [];
        let currentField = '';
        let inQuotes = false;

        for (let i = 0; i < csvString.length; i++) {
            const char = csvString[i];
            const next = csvString[i + 1];

            if (char === '"') {
                if (inQuotes && next === '"') { currentField += '"'; i++; }
                else { inQuotes = !inQuotes; }
            } else if (char === sep && !inQuotes) {
                currentRow.push(currentField.trim());
                currentField = '';
            } else if (char === '\r' && next === '\n' && !inQuotes) {
                currentRow.push(currentField.trim());
                if (currentRow.some(f => f !== '')) rows.push(currentRow);
                currentRow = []; currentField = ''; i++;
            } else if ((char === '\n' || char === '\r') && !inQuotes) {
                currentRow.push(currentField.trim());
                if (currentRow.some(f => f !== '')) rows.push(currentRow);
                currentRow = []; currentField = '';
            } else {
                currentField += char;
            }
        }
        if (currentField || currentRow.length > 0) {
            currentRow.push(currentField.trim());
            if (currentRow.some(f => f !== '')) rows.push(currentRow);
        }
        return rows;
    }

    // ===================== DATES =====================

    // Parse une date : ISO / formats natifs JS, puis fallback format français
    // "5 décembre, 2025, 15:33" ou "25 octobre, 2025". Retourne null si invalide.
    function parseFrenchDate(dateString) {
        if (dateString instanceof Date) {
            return isNaN(dateString.getTime()) ? null : dateString;
        }
        if (!dateString || typeof dateString !== 'string' || dateString.trim() === '') {
            return null;
        }

        // Retirer les backslashes qui échappent parfois les virgules
        const cleanDate = dateString.replace(/\\/g, '');

        // Parsing standard d'abord
        let date = new Date(cleanDate);

        if (isNaN(date.getTime())) {
            const frenchMonths = {
                'janvier': 0, 'février': 1, 'fevrier': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5,
                'juillet': 6, 'août': 7, 'aout': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10,
                'décembre': 11, 'decembre': 11
            };

            // "DD Month, YYYY" ou "DD Month, YYYY, HH:MM"
            const match = cleanDate.match(/(\d+)\s+([a-zàâäéèêëïôùûü]+)[,\s]+(\d{4})/i);
            if (match) {
                const day = parseInt(match[1]);
                const monthName = match[2].toLowerCase().trim();
                const year = parseInt(match[3]);

                if (frenchMonths[monthName] !== undefined) {
                    date = new Date(year, frenchMonths[monthName], day);

                    const timeMatch = cleanDate.match(/(\d{1,2}):(\d{2})/);
                    if (timeMatch) {
                        date.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
                    }
                }
            }
        }

        return isNaN(date.getTime()) ? null : date;
    }

    // Parse une date "JJ/MM/AAAA" + une heure optionnelle "HH:MM", format de
    // l'export CSV du backoffice BTP Force (colonnes Date et Heure séparées).
    // Repli sur parseFrenchDate si le format ne correspond pas. Null si invalide.
    function parseFrDateTime(dateString, timeString) {
        if (!dateString || typeof dateString !== 'string') return null;
        const m = dateString.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) return parseFrenchDate(dateString);

        const day = parseInt(m[1], 10);
        const month = parseInt(m[2], 10);
        const year = parseInt(m[3], 10);

        let hours = 0;
        let minutes = 0;
        if (typeof timeString === 'string') {
            const t = timeString.trim().match(/^(\d{1,2}):(\d{2})/);
            if (t) { hours = parseInt(t[1], 10); minutes = parseInt(t[2], 10); }
        }

        const d = new Date(year, month - 1, day, hours, minutes, 0, 0);
        // Rejette les dates qui "débordent" (31/02, 25:00...) : JS les reporte
        // silencieusement sur le mois suivant.
        if (isNaN(d.getTime()) || d.getDate() !== day || d.getMonth() !== month - 1
            || d.getHours() !== hours || d.getMinutes() !== minutes) {
            return null;
        }
        return d;
    }

    // ===================== DÉTECTION DE COLONNES =====================
    // Chaque pattern est un tableau de sous-chaînes qui doivent TOUTES être
    // présentes (en minuscules). Préfixe '!' = doit être ABSENTE.
    // Les patterns sont essayés dans l'ordre : la priorité du pattern bat
    // l'ordre des colonnes.

    function _matchesPattern(lowercased, pattern) {
        for (const sub of pattern) {
            if (sub.startsWith('!')) {
                if (lowercased.includes(sub.substring(1))) return false;
            } else {
                if (!lowercased.includes(sub)) return false;
            }
        }
        return true;
    }

    // Retourne l'INDEX de la première colonne correspondante, -1 sinon (CSV).
    function findIdx(headers, ...patterns) {
        for (const pattern of patterns) {
            for (let i = 0; i < headers.length; i++) {
                if (_matchesPattern((headers[i] || '').toLowerCase(), pattern)) return i;
            }
        }
        return -1;
    }

    // Retourne le NOM de la première clé correspondante, null sinon (JSON).
    function findKey(keys, ...patterns) {
        for (const pattern of patterns) {
            for (const key of keys) {
                if (_matchesPattern((key || '').toLowerCase(), pattern)) return key;
            }
        }
        return null;
    }

    // ===================== TEXTE =====================

    const HTML_TAG_RE = /<[^>]+>/g;

    // Extrait le texte brut d'une chaîne HTML.
    function extractText(html) {
        if (!html || typeof html !== 'string') return '';
        const withBreaks = html.replace(/<\/p>/gi, '\n\n');
        let text = withBreaks.replace(HTML_TAG_RE, '');
        text = text
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/[*_`]/g, '');
        return text.replace(/\s+/g, ' ').trim();
    }

    // Compte les mots (lettres uniquement, accents inclus — pas les nombres).
    function countWords(text) {
        if (!text || typeof text !== 'string') return 0;
        const words = text.match(/[a-zA-ZÀ-ÿ]+/g);
        return words ? words.length : 0;
    }

    // Échappe le HTML pour l'injection via innerHTML (anti-XSS).
    // Implémentation sans DOM pour être testable en Node.
    function escapeHtml(str) {
        if (str === null || str === undefined || str === '') return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Formate un nombre avec séparateur de milliers français (arrondi).
    function formatNumber(num) {
        return new Intl.NumberFormat('fr-FR').format(Math.round(num));
    }

    // ===================== PRÉDICATS MÉTIER =====================

    // Vrai si au moins une ligne du dataset a un type renseigné.
    // (Sinon : query Metabase déjà filtrée en amont → on ne filtre pas.)
    function hasAnyType(data) {
        return Array.isArray(data) && data.some(item => item && item.type && item.type.trim() !== '');
    }

    // Une ligne est un "Descriptif sommaire des travaux" ssi son type contient
    // DESCRIPTIF_TYPE. Les lignes au type vide (hasAi=false) sont EXCLUES —
    // sinon elles gonflent le compteur au-delà du nombre total de RICT.
    // anyHasType = résultat de hasAnyType(dataset) : si false, passthrough.
    function isDescriptifItem(item, anyHasType) {
        if (!anyHasType) return true;
        return !!(item && item.type && item.type.includes(DESCRIPTIF_TYPE));
    }

    // Booléen "true" venu de CSV (string) ou de JSON (bool).
    function isTruthyBool(v) {
        return v === true || v === 'true' || v === 'TRUE';
    }

    // Floor Analyse AO : vrai si le marché est comptabilisable (détecté à
    // partir du go-live). Les marchés sans date valide sont conservés
    // (choix conservateur).
    function isAfterAOStart(dateDetection) {
        const d = parseFrenchDate(dateDetection);
        return !d || d >= AO_MODULE_START_DATE;
    }

    // ===================== CHATS =====================

    // Email du propriétaire d'une session de chat.
    // Les applications récentes (SPS « C+ », organisation 1edd6b43) ne
    // remplissent plus `email` à la racine : l'adresse ne vit plus que dans
    // metadata. Sans ce repli la session est orpheline — elle compte dans les
    // sessions mais disparaît de tout regroupement par utilisateur, ce qui
    // affiche « 0 utilisateur » sur une brique pourtant pleine de données.
    function chatEmail(item) {
        if (!item) return '';
        const meta = item.metadata || {};
        const email = item.email || meta.email || meta.userEmail || '';
        return typeof email === 'string' ? email.trim() : '';
    }

    // ===================== ANALYSE CCTP VS RÉFÉRENTIEL =====================
    //
    // Card Metabase 160 : 1 ligne = 1 livrable AIDeliverable CCTP_VS_REFERENTIEL.
    // Les avis (longResult.cctp.avis[], ~150 KB par livrable) sont agrégés en
    // SQL : le front ne reçoit que des compteurs. Partagé entre index (app.js)
    // et analyse-cctp.html.

    // "F:11;L:19;P1:14" → { F: 11, L: 19, P1: 14 }
    function parseMissionCounts(str) {
        const out = {};
        if (!str || typeof str !== 'string') return out;
        str.split(';').forEach(part => {
            const i = part.lastIndexOf(':');
            if (i <= 0) return;
            const code = part.slice(0, i).trim();
            const n = parseInt(part.slice(i + 1), 10);
            if (code && !isNaN(n)) out[code] = (out[code] || 0) + n;
        });
        return out;
    }

    function _int(v) {
        const n = parseInt(v, 10);
        return isNaN(n) ? 0 : n;
    }

    function _str(v) {
        return v === null || v === undefined ? '' : String(v).trim();
    }

    // Lignes de la card (objets clé = nom de colonne) → items normalisés.
    // Les tests YIELD sont déjà exclus en SQL ; on les re-filtre par sécurité.
    function parseCctpRows(rows) {
        if (!Array.isArray(rows)) return [];
        const items = [];
        rows.forEach(r => {
            if (!r || typeof r !== 'object') return;
            const deliverableId = _str(r.DeliverableId);
            if (!deliverableId) return;
            const contractNumber = _str(r.ContractNumber);
            if (contractNumber.toUpperCase().includes('YIELD')) return;
            const m = contractNumber.match(/C-([A-Z0-9]+)-/);
            const reportId = _str(r.ReportId);
            const avisInjectes = _int(r.AvisInjectes);
            const noticesCreees = _int(r.NoticesCreees);
            items.push({
                deliverableId,
                createdAt: _str(r.EventDate),
                status: _str(r.Status).toUpperCase(),
                contractNumber,
                agencyCode: m ? m[1] : null,
                email: _str(r.UserEmail),
                agency: _str(r.Agence),
                direction: _str(r.DR),
                missions: _str(r.Missions).split(/[,;|/]/).map(s => s.trim()).filter(Boolean),
                totalMissions: _int(r.TotalMissions),
                failedMissions: _int(r.FailedMissions),
                totalElements: _int(r.TotalElements),
                totalAvis: _int(r.TotalAvis),
                avisFavorable: _int(r.AvisFavorable),
                avisSuspendu: _int(r.AvisSuspendu),
                avisDefavorable: _int(r.AvisDefavorable),
                avisAutre: _int(r.AvisAutre),
                avisCritique: _int(r.AvisCritique),
                avisEleve: _int(r.AvisEleve),
                avisHorsMission: _int(r.AvisHorsMission),
                avisParMission: parseMissionCounts(_str(r.AvisParMission)),
                reportId,
                avisInjectes,
                noticesCreees,
                // Avis repris dans S+ : une notice injectée = un avis repris. Le
                // statut posé à l'injection (metadata) existe aussi sans event
                // (events tracés depuis le 25/09/2026) : on retient le plus grand
                // des deux pour ne compter un avis ni deux fois ni zéro fois.
                avisRepris: Math.max(avisInjectes, noticesCreees),
                // L'analyse a servi dans S+ : un rapport a été créé depuis
                // l'analyse, des avis ont reçu un statut, ou des notices ont
                // été injectées (events "Create Notice From AI CCTP").
                exploitee: !!reportId || avisInjectes > 0 || noticesCreees > 0,
            });
        });
        return items;
    }

    // CSV de la card (export Metabase : champs à virgules entre guillemets,
    // ex. Missions = "L,P1") → lignes objets.
    function _csvToObjects(csv) {
        const rows = parseFullCSV(csv, ',');
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
    function parseCctpPayload(text) {
        if (!text || typeof text !== 'string') return [];
        let payload = null;
        try { payload = JSON.parse(text); } catch (_) { /* CSV brut */ }
        const fromInner = inner => {
            let j = null;
            try { j = JSON.parse(inner); } catch (_) { /* CSV */ }
            return Array.isArray(j) ? parseCctpRows(j) : parseCctpRows(_csvToObjects(inner));
        };
        if (payload === null) return parseCctpRows(_csvToObjects(text));
        if (Array.isArray(payload) && payload.length && payload[0] && typeof payload[0].data === 'string') {
            return fromInner(payload[0].data);
        }
        if (payload && !Array.isArray(payload) && typeof payload.data === 'string') {
            return fromInner(payload.data);
        }
        if (Array.isArray(payload)) return parseCctpRows(payload);
        return [];
    }

    // Agrégats d'un lot d'items (déjà filtrés par période / DR / agence).
    // Les livrables en ERROR comptent comme lancements mais pas comme analyses.
    function aggregateCctp(items) {
        const seen = new Set();
        const contracts = new Set();
        const users = new Set();
        const agencies = new Set();
        const byMission = {};
        const s = {
            totalLaunches: 0, totalOperations: 0, totalErrors: 0,
            uniqueContracts: 0, uniqueUsers: 0, uniqueAgencies: 0,
            totalAvis: 0, favorable: 0, suspendu: 0, defavorable: 0, autre: 0,
            critique: 0, eleve: 0, horsMission: 0,
            analysesExploitees: 0, avisInjectes: 0, noticesCreees: 0, avisRepris: 0,
            byMission,
        };
        (items || []).forEach(it => {
            if (!it || !it.deliverableId || seen.has(it.deliverableId)) return;
            seen.add(it.deliverableId);
            s.totalLaunches++;
            if (it.status === 'ERROR') { s.totalErrors++; return; }
            s.totalOperations++;
            if (it.contractNumber) contracts.add(it.contractNumber);
            if (it.email) users.add(it.email);
            if (it.agency) agencies.add(it.agency);
            s.totalAvis += it.totalAvis;
            s.favorable += it.avisFavorable;
            s.suspendu += it.avisSuspendu;
            s.defavorable += it.avisDefavorable;
            s.autre += it.avisAutre;
            s.critique += it.avisCritique;
            s.eleve += it.avisEleve;
            s.horsMission += it.avisHorsMission;
            if (it.exploitee) s.analysesExploitees++;
            s.avisInjectes += it.avisInjectes;
            s.noticesCreees += it.noticesCreees;
            s.avisRepris += it.avisRepris || 0;
            Object.keys(it.avisParMission || {}).forEach(code => {
                if (!byMission[code]) byMission[code] = { analyses: 0, avis: 0 };
                byMission[code].avis += it.avisParMission[code];
            });
            (it.missions || []).forEach(code => {
                if (!byMission[code]) byMission[code] = { analyses: 0, avis: 0 };
                byMission[code].analyses++;
            });
        });
        s.uniqueContracts = contracts.size;
        s.uniqueUsers = users.size;
        s.uniqueAgencies = agencies.size;
        return s;
    }

    // ===================== NOTE D'ADOPTION PAR UTILISATEUR =====================
    //
    // Note /100 d'un utilisateur sur le périmètre de SA filiale (popup
    // « Utilisateurs actifs »). Fonctions pures, déterministes : aucune
    // dépendance à « aujourd'hui », tout est mesuré à une date de référence
    // fournie par l'appelant (fin du filtre de dates, plafonnée au dernier
    // usage observé). Mêmes données + même filtre → même note.
    //
    // Un module récent ne pénalise personne : il pèse dans le dénominateur de
    // la diversité au prorata de son ancienneté (poids d'exposition), et pèse
    // plein au bout de exposureWeeks semaines.

    const ADOPTION = {
        weights: { recurrence: 35, volume: 25, diversity: 20, freshness: 20 },
        volumeFull: 100,     // sessions pour le plein score (échelle log)
        minWeeks: 8,         // la régularité ne se juge pas sur moins de 8 semaines
        exposureWeeks: 8,    // un module pèse 1 au bout de 8 semaines
        // [jours depuis le dernier usage ≤ seuil, part de la note fraîcheur]
        freshness: [[7, 1], [30, 0.7], [60, 0.4], [90, 0.2]],
        // [note minimale, niveau] — du plus haut au plus bas
        levels: [[80, 'Adopté'], [60, 'Régulier'], [40, 'Occasionnel'], [0, 'Découverte']],
    };

    const _DAY = 24 * 3600 * 1000;

    // Jour calendaire local → nombre de jours depuis l'epoch (insensible à
    // l'heure et aux changements d'heure).
    function _dayIndex(d) {
        return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / _DAY);
    }

    // Index de semaine (lundi → dimanche). Le 01/01/1970 est un jeudi.
    function weekIndex(d) {
        return Math.floor((_dayIndex(d) + 3) / 7);
    }

    // Poids d'un module dans le dénominateur de la diversité : 0 à son
    // lancement, 1 après exposureWeeks semaines. Lancé après la référence → 0.
    function exposureWeight(launchDate, refDate) {
        if (!launchDate || !refDate) return 1;
        const weeks = (_dayIndex(refDate) - _dayIndex(launchDate)) / 7;
        return Math.max(0, Math.min(1, weeks / ADOPTION.exposureWeeks));
    }

    function adoptionLevel(score) {
        for (const [min, label] of ADOPTION.levels) if (score >= min) return label;
        return ADOPTION.levels[ADOPTION.levels.length - 1][1];
    }

    // u = { sessions, activeWeeks, firstDate, lastDate, modulesUsed, exposure }
    //   exposure = somme des poids d'exposition des modules de la filiale.
    // Retourne { score, level, parts: {recurrence, volume, diversity, freshness}, details }.
    function adoptionScore(u, refDate) {
        const W = ADOPTION.weights;
        const sessions = Math.max(0, u.sessions || 0);

        const span = (u.firstDate && refDate)
            ? Math.max(1, weekIndex(refDate) - weekIndex(u.firstDate) + 1) : 1;
        const weeksObserved = Math.max(ADOPTION.minWeeks, span);
        const recurrence = Math.min(1, (u.activeWeeks || 0) / weeksObserved);

        const volume = Math.min(1, Math.log(1 + sessions) / Math.log(1 + ADOPTION.volumeFull));

        const used = u.modulesUsed || 0;
        const exposure = u.exposure || 0;
        const diversity = used === 0 ? 0 : (exposure <= used ? 1 : used / exposure);

        const daysSince = (u.lastDate && refDate)
            ? Math.max(0, _dayIndex(refDate) - _dayIndex(u.lastDate)) : Infinity;
        const step = ADOPTION.freshness.find(([max]) => daysSince <= max);
        const freshness = step ? step[1] : 0;

        const parts = {
            recurrence: recurrence * W.recurrence,
            volume: volume * W.volume,
            diversity: diversity * W.diversity,
            freshness: freshness * W.freshness,
        };
        const score = Math.round(parts.recurrence + parts.volume + parts.diversity + parts.freshness);
        return {
            score,
            level: adoptionLevel(score),
            parts,
            details: { activeWeeks: u.activeWeeks || 0, weeksObserved, sessions, modulesUsed: used, exposure, daysSince },
        };
    }

    // Synthèse d'un lot de notes ({ score, level }) : effectif, médiane, nombre
    // par niveau (tous les niveaux présents, même à 0) et part des niveaux
    // « Régulier » et au-delà (note >= 60, cf. ADOPTION.levels).
    function adoptionSummary(adoptions) {
        const list = adoptions || [];
        const levels = {};
        ADOPTION.levels.forEach(([, label]) => { levels[label] = 0; });
        list.forEach(a => { levels[a.level] = (levels[a.level] || 0) + 1; });
        const regularMin = ADOPTION.levels[ADOPTION.levels.length - 3][0];
        const regular = list.filter(a => a.score >= regularMin).length;
        const med = median(list.map(a => a.score));
        return {
            count: list.length,
            median: med === null ? null : Math.round(med),
            levels,
            regularShare: list.length ? regular / list.length : null,
        };
    }

    // Médiane (moyenne des deux valeurs centrales si effectif pair). null si vide.
    function median(values) {
        const v = (values || []).filter(x => typeof x === 'number' && !isNaN(x)).sort((a, b) => a - b);
        if (!v.length) return null;
        const mid = Math.floor(v.length / 2);
        return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
    }

    // Valeur la plus fréquente ; égalité départagée par ordre alphabétique
    // (déterministe). Ignore les valeurs vides. null si aucune.
    function mode(values) {
        const counts = {};
        (values || []).forEach(x => { if (x) counts[x] = (counts[x] || 0) + 1; });
        let best = null;
        Object.keys(counts).sort().forEach(k => { if (best === null || counts[k] > counts[best]) best = k; });
        return best;
    }

    // ===================== AUTH + URLS SIGNÉES =====================

    const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordROI';

    // Authentifie avec le mot de passe stocké (roi_password) et retourne
    // TOUTES les URLs de données exposées par le webhook (signées, 12h) :
    // { DESCRIPTIF_URL, AUTOCONTACT_URL, ..., POPULATION_CIBLE_URL, ... }
    // Redirige vers index.html et retourne null si absent/refusé.
    // (Navigateur uniquement — ne pas appeler depuis les tests Node.)
    async function fetchDataUrls() {
        const password = (typeof localStorage !== 'undefined') ? localStorage.getItem('roi_password') : null;
        if (!password) {
            window.location.href = 'index.html';
            return null;
        }
        try {
            const r = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: password
            });
            if (!r.ok) {
                localStorage.removeItem('roi_password');
                window.location.href = 'index.html';
                return null;
            }
            const text = await r.text();
            return parseUrlsResponse(text);
        } catch (e) {
            console.error('Erreur auth webhook:', e);
            window.location.href = 'index.html';
            return null;
        }
    }

    // Parse le corps texte du webhook (lignes "const X_URL = '...'") en objet.
    function parseUrlsResponse(text) {
        const urls = {};
        const re = /const\s+([A-Z_0-9]+)\s*=\s*['"]([^'"]+)['"]/g;
        let m;
        while ((m = re.exec(text || ''))) urls[m[1]] = m[2];
        return urls;
    }

    // ===================== EXPORT =====================

    return {
        // constantes
        DESCRIPTIF_TYPE,
        AO_MODULE_START_DATE,
        // csv
        parseCSVLine,
        parseFullCSV,
        // dates
        parseFrenchDate,
        parseFrDateTime,
        // colonnes
        findIdx,
        findKey,
        // texte
        extractText,
        countWords,
        escapeHtml,
        formatNumber,
        // prédicats métier
        hasAnyType,
        isDescriptifItem,
        isTruthyBool,
        isAfterAOStart,
        // chats
        chatEmail,
        // analyse cctp vs référentiel
        parseMissionCounts,
        parseCctpRows,
        parseCctpPayload,
        aggregateCctp,
        // note d'adoption
        ADOPTION,
        weekIndex,
        exposureWeight,
        adoptionLevel,
        adoptionScore,
        adoptionSummary,
        median,
        mode,
        // auth + urls signées
        WEBHOOK_URL,
        fetchDataUrls,
        parseUrlsResponse,
    };
})();

// Navigateur : namespace global. Node (tests) : module CommonJS.
if (typeof window !== 'undefined') window.KPI = KPI;
if (typeof module !== 'undefined' && module.exports) module.exports = KPI;
