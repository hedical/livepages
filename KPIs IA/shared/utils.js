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
    function parseFullCSV(csvString) {
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
            } else if (char === ',' && !inQuotes) {
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
        // auth + urls signées
        WEBHOOK_URL,
        fetchDataUrls,
        parseUrlsResponse,
    };
})();

// Navigateur : namespace global. Node (tests) : module CommonJS.
if (typeof window !== 'undefined') window.KPI = KPI;
if (typeof module !== 'undefined' && module.exports) module.exports = KPI;
