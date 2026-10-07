// Configuration
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordROI';

// URLs will be fetched from webhook after authentication
let DESCRIPTIF_URL = '';
let AUTOCONTACT_URL = '';
// Autocontact SPS : autocontact_sps.json, deposé à la main dans le bucket tant que
// l'accès API au backoffice BTP Force n'est pas ouvert (cf. README).
let AUTOCONTACT_SPS_URL = '';
let COMPARATEUR_URL = '';
let NF_HABITAT_URL = '';
let GEOTECH_URL = '';
let AO_URL = ''; // exposée par le webhook passwordROI sous le nom ANALYSE_AO_URL ; pas de fallback hardcodé
let ACOUSTIQUE_URL = ''; // exposée par le webhook sous le nom ANALYSE_ACOUSTIQUE_URL ; pas de fallback hardcodé
let CCTP_URL = ''; // exposée par le webhook sous le nom ANALYSE_CCTP_URL (card 160) ; pas de fallback hardcodé
// URLs chat/expert/population : remplacées par les URLs SIGNÉES du webhook
// après auth (fallback public conservé le temps de la transition bucket privé).
let EXPERT_BTP_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_btpconsultants_ct.json';
let CHAT_BTP_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_btpconsultants_ct.json';
let EXPERT_CITAE_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_citae.json';
let CHAT_CITAE_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_citae.json';
let EXPERT_BTPDIAG_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_btpdiagnostics.json';
let CHAT_BTPDIAG_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_btpdiagnostics.json';
// SPS : même domaine email que BTP Consultants mais BU distincte
let EXPERT_BTP_SPS_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_btp_sps.json';
let CHAT_BTP_SPS_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_btp_sps.json';
let POPULATION_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/population_cible.csv';

// Constants (cf. shared/utils.js)
const DESCRIPTIF_TYPE = KPI.DESCRIPTIF_TYPE;
const AUTOCONTACT_TYPE = 'AUTOCONTACT';

// Vrai si le dataset descriptif contient au moins une ligne avec un type renseigné.
// Recalculé après le chargement des données (voir loadData).
let descriptifTypePresent = false;

// Prédicat : une ligne est un "Descriptif sommaire des travaux".
// Logique centralisée et testée dans shared/utils.js (les lignes au type vide,
// RICT sans génération IA, sont exclues — garde-fou passthrough si query pré-filtrée).
function isDescriptifRow(item) {
    return KPI.isDescriptifItem(item, descriptifTypePresent);
}

// Parameters for gains calculation (must match descriptif.js and autocontact.js)
const MINUTES_PER_DESCRIPTIF = 30;
const SECONDS_PER_CONTACT = 90; // Default value from autocontact.js
const SECONDS_PER_PAGE = 20; // Default value for comparateur
const MINUTES_PER_MESSAGE = 2.8125; // For chat tools (BTP and Citae)
const MINUTES_PER_MESSAGE_EXPERT = 5; // For expert technique tools (BTP and Citae)
const HOURS_PER_POINT_NF = 0.02816; // NF Habitat: hours gained per point checked
const MINUTES_PER_AO_ANALYSE = 15; // Analyse AO: minutes gagnées par AO analysé (lead créé)
// Date de mise en place effective du module Analyse AO (cf. shared/utils.js).
const AO_MODULE_START_DATE = KPI.AO_MODULE_START_DATE;
const NF_HABITAT_REVENUE = 7000000; // NF Habitat specific revenue base
const EURO_PER_MESSAGE = 1.5; // For chat and expert tools (BTP and Citae)
const ANNUAL_HOURS = 1607;
const TOTAL_REVENUE = 44000000;
let TOTAL_EFFECTIF = 192; // Will be updated from population_cible.csv

// Calculated Hourly Rate (Revenue / (Effectif * Hours))
// Using default 192 effectif initially: 44,000,000 / (192 * 1607) ≈ 142.6 €/h
function getHourlyRate() {
    return TOTAL_REVENUE / (TOTAL_EFFECTIF * ANNUAL_HOURS);
}

// State
let descriptifData = [];
let autocontactData = [];
let comparateurData = [];
let expertBTPData = [];
let chatBTPData = [];
let expertCitaeData = [];
let chatCitaeData = [];
let expertBTPDiagData = [];
let chatBTPDiagData = [];
let expertBtpSpsData = []; // BTP Consultants SPS — BU distincte, emails @btp-consultants.fr
let chatBtpSpsData = [];
let autocontactSpsData = []; // Autocontact SPS — source = backoffice BTP Force (app des SPS)
let nfHabitatData = [];
let geotechData = [];
let acoustiqueData = [];
let cctpData = []; // Analyse CCTP vs Référentiel — 1 item = 1 livrable (cf. KPI.parseCctpRows)
let aoMarches = []; // [{marcheId, refMarche, typeAvis, dateDetection, leads:[...]}]
let agencyPopulation = {}; // {agencyCode: effectif}
let populationRows = []; // [{dr, agencyCode, effectif}] — full rows from population_cible.csv
let availableAgencies = [];
let availableDirections = [];
let agencyToDirection = {};
let tableSortState = {
    column: 'total',
    ascending: false
};
let dateFilter = {
    startDate: null,
    endDate: null
};

// DOM Elements
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const mainContentEl = document.getElementById('main-content');
const startDateEl = document.getElementById('start-date');
const endDateEl = document.getElementById('end-date');
const applyDateFilterBtn = document.getElementById('apply-date-filter');
const filialeFilterEl = document.getElementById('filiale-filter');
const directionFilterEl = document.getElementById('direction-filter');
const agencyFilterEl = document.getElementById('agency-filter');
const resetFiltersBtn = document.getElementById('reset-filters');
const agencyTableBodyEl = document.getElementById('agency-table-body');

// KPI Elements
const totalUtilisationsEl = document.getElementById('total-utilisations');
const gainHeuresEl = document.getElementById('gain-heures');
const gainSubtitleEl = document.getElementById('gain-subtitle');
const totalUsersEl = document.getElementById('total-users');

// Descriptif elements
const descriptifCountEl = document.getElementById('descriptif-count');
const descriptifOpsEl = document.getElementById('descriptif-ops');
const descriptifTotalRictEl = document.getElementById('descriptif-total-rict');
const descriptifUsersEl = document.getElementById('descriptif-users');

// Autocontact elements
const autocontactOpsEl = document.getElementById('autocontact-ops');
const autocontactAiContactsEl = document.getElementById('autocontact-ai-contacts');
const autocontactTotalContactsEl = document.getElementById('autocontact-total-contacts');
const autocontactUsersEl = document.getElementById('autocontact-users');

// Comparateur elements
const comparateurCountEl = document.getElementById('comparateur-count');
const comparateurOpsEl = document.getElementById('comparateur-ops');
const comparateurPagesEl = document.getElementById('comparateur-pages');
const comparateurUsersEl = document.getElementById('comparateur-users');

// Expert BTP Consultants elements
const expertTechBTPCountEl = document.getElementById('expert-tech-btp-count');
const expertTechBTPUsersEl = document.getElementById('expert-tech-btp-users');
const expertTechBTPMessagesEl = document.getElementById('expert-tech-btp-messages');
const expertTechBTPCostEl = document.getElementById('expert-tech-btp-cost');

// Chat BTP Consultants elements
const chatProjetBTPCountEl = document.getElementById('chat-projet-btp-count');
const chatProjetBTPUsersEl = document.getElementById('chat-projet-btp-users');
const chatProjetBTPMessagesEl = document.getElementById('chat-projet-btp-messages');
const chatProjetBTPCostEl = document.getElementById('chat-projet-btp-cost');

// Expert Citae elements
const expertTechCitaeCountEl = document.getElementById('expert-tech-citae-count');
const expertTechCitaeUsersEl = document.getElementById('expert-tech-citae-users');
const expertTechCitaeMessagesEl = document.getElementById('expert-tech-citae-messages');
const expertTechCitaeCostEl = document.getElementById('expert-tech-citae-cost');

// Chat Citae elements
const chatProjetCitaeCountEl = document.getElementById('chat-projet-citae-count');
const chatProjetCitaeUsersEl = document.getElementById('chat-projet-citae-users');
const chatProjetCitaeMessagesEl = document.getElementById('chat-projet-citae-messages');
const chatProjetCitaeCostEl = document.getElementById('chat-projet-citae-cost');

// Expert BTP Diagnostics elements
const expertTechBTPDiagCountEl = document.getElementById('expert-tech-btpdiag-count');
const expertTechBTPDiagUsersEl = document.getElementById('expert-tech-btpdiag-users');
const expertTechBTPDiagMessagesEl = document.getElementById('expert-tech-btpdiag-messages');
const expertTechBTPDiagCostEl = document.getElementById('expert-tech-btpdiag-cost');

// Chat BTP Diagnostics elements
const chatProjetBTPDiagCountEl = document.getElementById('chat-projet-btpdiag-count');
const chatProjetBTPDiagUsersEl = document.getElementById('chat-projet-btpdiag-users');
const chatProjetBTPDiagMessagesEl = document.getElementById('chat-projet-btpdiag-messages');
const chatProjetBTPDiagCostEl = document.getElementById('chat-projet-btpdiag-cost');

// Expert BTP Consultants SPS elements
const expertTechSpsCountEl = document.getElementById('expert-tech-sps-count');
const expertTechSpsUsersEl = document.getElementById('expert-tech-sps-users');
const expertTechSpsMessagesEl = document.getElementById('expert-tech-sps-messages');
const expertTechSpsCostEl = document.getElementById('expert-tech-sps-cost');

// Chat BTP Consultants SPS elements
const chatProjetSpsCountEl = document.getElementById('chat-projet-sps-count');
const chatProjetSpsUsersEl = document.getElementById('chat-projet-sps-users');
const chatProjetSpsMessagesEl = document.getElementById('chat-projet-sps-messages');
const chatProjetSpsCostEl = document.getElementById('chat-projet-sps-cost');

// Analyse géotechnique (BTP Consultants) elements
const analyseGeoCountEl = document.getElementById('analyse-geo-count');
const analyseGeoOpsEl = document.getElementById('analyse-geo-ops');
const analyseGeoNoticesEl = document.getElementById('analyse-geo-notices');
const analyseGeoReportsEl = document.getElementById('analyse-geo-reports');
const analyseGeoUsersEl = document.getElementById('analyse-geo-users');

// Analyse Acoustique (BTP Consultants) elements
const analyseAcouCountEl = document.getElementById('analyse-acou-count');
const analyseAcouContractsEl = document.getElementById('analyse-acou-contracts');
const analyseAcouUsersEl = document.getElementById('analyse-acou-users');
const analyseAcouNoticesEl = document.getElementById('analyse-acou-notices');
const analyseAcouReportsEl = document.getElementById('analyse-acou-reports');

// Analyse CCTP vs Référentiel (BTP Consultants) elements
const analyseCctpCountEl = document.getElementById('analyse-cctp-count');
const analyseCctpContractsEl = document.getElementById('analyse-cctp-contracts');
const analyseCctpAvisEl = document.getElementById('analyse-cctp-avis');
const analyseCctpUsersEl = document.getElementById('analyse-cctp-users');

// Analyse AO (BTP Consultants) elements
const analyseAoCaptesEl   = document.getElementById('analyse-ao-captes');
const analyseAoFiltresEl  = document.getElementById('analyse-ao-filtres');
const analyseAoAnalysesEl = document.getElementById('analyse-ao-analyses');
const analyseAoOppEl      = document.getElementById('analyse-ao-opp');

// ==================== UTILITY FUNCTIONS ====================

// Extract plain text from HTML string (cf. shared/utils.js)
function extractText(html) {
    return KPI.extractText(html);
}

// Count words in text (only words, not numbers) (cf. shared/utils.js)
function countWords(text) {
    return KPI.countWords(text);
}

/**
 * Helper function to parse a CSV line with quoted values (cf. shared/utils.js)
 */
function parseCSVLine(line) {
    return KPI.parseCSVLine(line);
}

/**
 * Full CSV parser that correctly handles quoted fields containing newlines (cf. shared/utils.js)
 */
function parseFullCSV(csvString) {
    return KPI.parseFullCSV(csvString);
}

/**
 * Extract agency code from contract number
 */
function extractAgency(contractNumber) {
    if (!contractNumber || typeof contractNumber !== 'string') {
        return null;
    }
    
    const match = contractNumber.match(/C-([A-Z0-9]+)-/);
    if (match && match[1]) {
        return match[1];
    }
    
    return null;
}

/**
 * Parses a French date string into a Date object.
 */
function parseFrenchDate(dateString) {
    return KPI.parseFrenchDate(dateString);
}

// ==================== DATA PARSING ====================

/**
 * Parse CSV data for descriptif
 */
function parseDescriptifCSV(csvString) {
    if (!csvString || typeof csvString !== 'string') {
        return [];
    }
    
    csvString = csvString.trim();
    while (csvString.startsWith('[') || csvString.startsWith('{')) {
        csvString = csvString.substring(1).trim();
    }
    while (csvString.endsWith(']') || csvString.endsWith('}')) {
        csvString = csvString.substring(0, csvString.length - 1).trim();
    }
    
    const rows = parseFullCSV(csvString);
    if (rows.length === 0) return [];

    const headers = rows[0];

    // Find column indices
    let typeIndex = -1;
    let contractIndex = -1;
    let diffusedAtIndex = -1;
    let emailIndex = -1;
    let agencyIndex = -1;
    let managementIndex = -1;
    let descriptionIndex = -1;
    let aiResultIndex = -1;

    // Pass 1: pre-scan for typeIndex with pattern priority
    // (AIDeliverable__type wins over Report__reportType regardless of column order)
    for (let i = 0; i < headers.length && typeIndex === -1; i++) {
        const header = headers[i].toLowerCase();
        if (header.includes('aideliver') && header.includes('type')) { typeIndex = i; }
    }
    if (typeIndex === -1) {
        for (let i = 0; i < headers.length && typeIndex === -1; i++) {
            const header = headers[i].toLowerCase();
            if (header.includes('reporttype') || (header.includes('report') && header.includes('type') && !header.includes('diffusedat'))) {
                typeIndex = i;
            }
        }
    }
    // Pass 2: other columns (no priority conflict, first match wins)
    // Precomputed lean columns scanned BEFORE the generic description/result patterns
    let descWcIndex = -1;
    let aiWcIndex = -1;
    let hasAiIndex = -1;
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toLowerCase();
        if (contractIndex === -1 && header.includes('contractnumber')) { contractIndex = i; }
        if (diffusedAtIndex === -1 && header.includes('report') && header.includes('diffusedat')) { diffusedAtIndex = i; }
        if (emailIndex === -1 && header.includes('user') && header.includes('email')) { emailIndex = i; }
        if (agencyIndex === -1 && header.includes('productionservice')) { agencyIndex = i; }
        if (managementIndex === -1 && header.includes('management')) { managementIndex = i; }
        if (descWcIndex === -1 && header.includes('description') && header.includes('wordcount')) { descWcIndex = i; }
        if (aiWcIndex === -1 && header.includes('airesult') && header.includes('wordcount')) { aiWcIndex = i; }
        if (hasAiIndex === -1 && header.includes('hasai')) { hasAiIndex = i; }
        if (descriptionIndex === -1 && header.includes('description') && !header.includes('complement') && !header.includes('wordcount')) { descriptionIndex = i; }
        if (aiResultIndex === -1 && ((header.includes('longresult') && !header.includes('indexcomparator')) || (header.includes('result') && !header.includes('wordcount')))) { aiResultIndex = i; }
    }

    if (contractIndex === -1) return [];

    console.log('Descriptif CSV column indices:', { typeIndex, contractIndex, diffusedAtIndex, emailIndex, agencyIndex, managementIndex, descriptionIndex, aiResultIndex, descWcIndex, aiWcIndex, hasAiIndex });

    // Parse data rows
    const data = [];
    for (let i = 1; i < rows.length; i++) {
        const values = rows[i];
        if (values.length < headers.length / 2) continue;

        const type = typeIndex >= 0 ? (values[typeIndex] || '') : '';
        const contractNumber = values[contractIndex] || '';
        const diffusedAt = diffusedAtIndex >= 0 ? values[diffusedAtIndex] : '';
        const email = emailIndex >= 0 ? values[emailIndex] : '';
        const agency = (agencyIndex >= 0 ? values[agencyIndex] : '') || '';
        const direction = (managementIndex >= 0 ? values[managementIndex] : '') || '';
        const description = descriptionIndex >= 0 ? values[descriptionIndex] : '';
        const aiResult = aiResultIndex >= 0 ? values[aiResultIndex] : '';
        const descWcRaw = descWcIndex >= 0 ? values[descWcIndex] : '';
        const aiWcRaw  = aiWcIndex >= 0 ? values[aiWcIndex] : '';
        const hasAiRaw = hasAiIndex >= 0 ? (values[hasAiIndex] || '').toLowerCase().trim() : '';

        data.push({
            type: (type || '').trim(),
            contractNumber: (contractNumber || '').trim(),
            createdAt: (diffusedAt || '').trim(),
            email: (email || '').trim(),
            agency: (agency || '').trim(),
            direction: (direction || '').trim(),
            description: description,
            aiResult: aiResult,
            descriptionWordCount: (descWcRaw !== '' && !isNaN(parseInt(descWcRaw))) ? parseInt(descWcRaw) : undefined,
            aiResultWordCount:    (aiWcRaw  !== '' && !isNaN(parseInt(aiWcRaw)))  ? parseInt(aiWcRaw)  : undefined,
            hasAi: hasAiRaw === 'true'
        });
    }

    return data;
}

/**
 * Parse CSV data for autocontact
 */
function parseAutocontactCSV(csvString) {
    if (!csvString || typeof csvString !== 'string') {
        return [];
    }
    
    csvString = csvString.trim();
    while (csvString.startsWith('[') || csvString.startsWith('{')) {
        csvString = csvString.substring(1).trim();
    }
    while (csvString.endsWith(']') || csvString.endsWith('}')) {
        csvString = csvString.substring(0, csvString.length - 1).trim();
    }
    
    const lines = csvString.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) return [];
    
    const headers = parseCSVLine(lines[0]);
    
    // Find column indices
    let contractIndex = -1;
    let fromAIIndex = -1;
    let emailIndex = -1;
    let createdAtIndex = -1;
    let agencyIndex = -1;
    let managementIndex = -1;
    
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toLowerCase();
        if (contractIndex === -1 && header.includes('contractnumber')) {
            contractIndex = i;
        }
        if (fromAIIndex === -1 && (header.includes('fromai') || header.includes('from_ai'))) {
            fromAIIndex = i;
        }
        // Look for BTP user email column (same logic as autocontact.js)
        if (emailIndex === -1 && header.includes('user') && header.includes('email')) {
            emailIndex = i;
        }
        if (createdAtIndex === -1 && (header.includes('createdat') || header.includes('created_at'))) {
            createdAtIndex = i;
        }
        if (agencyIndex === -1 && header.includes('productionservice')) {
            agencyIndex = i;
        }
        if (managementIndex === -1 && header.includes('management')) {
            managementIndex = i;
        }
    }
    
    if (contractIndex === -1) {
        return [];
    }
    
    // If email column not found in headers, search in data rows
    if (emailIndex === -1) {
        for (let rowIdx = 1; rowIdx < Math.min(10, lines.length); rowIdx++) {
            const values = parseCSVLine(lines[rowIdx]);
            for (let colIdx = 0; colIdx < values.length; colIdx++) {
                const val = values[colIdx];
                if (val && val.includes('@btp-consultants.fr')) {
                    emailIndex = colIdx;
                    console.log('Found BTP email column at index', colIdx, 'by examining data');
                    break;
                }
            }
            if (emailIndex !== -1) break;
        }
    }
    
    console.log('Autocontact CSV parsing - Column indices:', {
        contract: contractIndex,
        fromAI: fromAIIndex,
        email: emailIndex,
        createdAt: createdAtIndex,
        agency: agencyIndex,
        management: managementIndex
    });
    
    // Parse data rows
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < headers.length / 2) continue;
        
        const contractNumber = values[contractIndex] || '';
        const fromAI = fromAIIndex >= 0 ? (values[fromAIIndex] || '').toLowerCase() === 'true' : false;
        const email = emailIndex >= 0 ? values[emailIndex] : '';
        const createdAt = createdAtIndex >= 0 ? values[createdAtIndex] : '';
        const agency = (agencyIndex >= 0 ? values[agencyIndex] : '') || '';
        const direction = (managementIndex >= 0 ? values[managementIndex] : '') || '';
        
        data.push({
            contractNumber: (contractNumber || '').trim(),
            fromAI: fromAI,
            email: (email || '').trim(),
            createdAt: (createdAt || '').trim(),
            agency: (agency || '').trim(),
            direction: (direction || '').trim()
        });
    }
    
    return data;
}

/**
 * Parse LongResult JSON to extract max page number
 */
function extractMaxPage(longResultString) {
    if (!longResultString || typeof longResultString !== 'string') {
        return 0;
    }
    
    try {
        // Parse the JSON (now properly unescaped by parseCSVLine)
        const longResult = JSON.parse(longResultString);
        
        if (longResult && longResult.indexComparator && longResult.indexComparator.items) {
            const items = longResult.indexComparator.items;
            let maxPage = 0;
            
            // Iterate through all items and find the maximum page value
            items.forEach(item => {
                if (item.page !== undefined && item.page !== null) {
                    const pageNum = typeof item.page === 'number' ? item.page : parseInt(item.page);
                    if (!isNaN(pageNum)) {
                        maxPage = Math.max(maxPage, pageNum);
                    }
                }
            });
            
            return maxPage;
        }
    } catch (e) {
        console.error('Failed to parse LongResult JSON:', e.message);
    }
    
    return 0;
}

/**
 * Helper: find an object-key matching one of several patterns.
 * Each pattern is an array of substrings that must ALL be present (lowercase).
 * Substrings prefixed with '!' must be ABSENT.
 * Patterns are tried in order — pattern priority beats key order, so a more
 * specific pattern listed first wins even if a less specific one would also
 * match a key earlier in the object.
 */
function findKey(keys, ...patterns) {
    return KPI.findKey(keys, ...patterns);
}

/**
 * Parse new direct JSON array format for descriptif (from Metabase JSON download).
 * Output shape mirrors parseDescriptifCSV().
 */
function parseDescriptifJSON(jsonArray) {
    if (!Array.isArray(jsonArray) || jsonArray.length === 0) return [];

    const keys = Object.keys(jsonArray[0] || {});
    const kType        = findKey(keys, ['aideliver', 'type'], ['reporttype'], ['report', 'type', '!diffusedat']);
    const kContract    = findKey(keys, ['contractnumber']);
    const kDiffusedAt  = findKey(keys, ['report', 'diffusedat']);
    const kEmail       = findKey(keys, ['user', 'email']);
    const kAgency      = findKey(keys, ['productionservice']);
    const kManagement  = findKey(keys, ['management']);
    // Precomputed (lean format) — must be checked BEFORE the HTML "description" pattern
    const kDescWC      = findKey(keys, ['description', 'wordcount']);
    const kAiWC        = findKey(keys, ['airesult', 'wordcount']);
    const kHasAi       = findKey(keys, ['hasai']);
    const kDescription = findKey(keys, ['description', '!complement', '!wordcount']);
    const kAiResult    = findKey(keys, ['longresult', 'description'], ['longresult'], ['airesult', '!wordcount'], ['result', '!wordcount']);

    console.log('Descriptif JSON keys map:', { kType, kContract, kDiffusedAt, kEmail, kAgency, kManagement, kDescWC, kAiWC, kHasAi, kDescription, kAiResult });

    if (!kContract) return [];

    return jsonArray.map(item => {
        const hasAiVal = kHasAi ? item[kHasAi] : null;
        return {
            type:                  ((kType && item[kType]) || '').toString().trim(),
            contractNumber:        ((kContract && item[kContract]) || '').toString().trim(),
            createdAt:             ((kDiffusedAt && item[kDiffusedAt]) || '').toString().trim(),
            email:                 ((kEmail && item[kEmail]) || '').toString().trim(),
            agency:                ((kAgency && item[kAgency]) || '').toString().trim(),
            direction:             ((kManagement && item[kManagement]) || '').toString().trim(),
            description:           (kDescription && item[kDescription]) || '',
            aiResult:              (kAiResult && item[kAiResult]) || '',
            descriptionWordCount:  (kDescWC && typeof item[kDescWC] === 'number') ? item[kDescWC] : (kDescWC && item[kDescWC] != null ? parseInt(item[kDescWC]) : undefined),
            aiResultWordCount:     (kAiWC && typeof item[kAiWC] === 'number') ? item[kAiWC] : (kAiWC && item[kAiWC] != null ? parseInt(item[kAiWC]) : undefined),
            hasAi:                 hasAiVal === true || hasAiVal === 'true' || hasAiVal === 'TRUE'
        };
    });
}

/**
 * Parse new direct JSON array format for autocontact (from Metabase JSON download).
 * Output shape mirrors parseAutocontactCSV().
 */
function parseAutocontactJSON(jsonArray) {
    if (!Array.isArray(jsonArray) || jsonArray.length === 0) return [];

    const keys = Object.keys(jsonArray[0] || {});
    const kContract   = findKey(keys, ['contractnumber']);
    const kFromAI     = findKey(keys, ['fromai'], ['from_ai']);
    const kEmail      = findKey(keys, ['user', 'email']);
    const kCreatedAt  = findKey(keys, ['contact', 'createdat'], ['createdat'], ['created_at']);
    const kAgency     = findKey(keys, ['productionservice']);
    const kManagement = findKey(keys, ['management']);

    console.log('Autocontact JSON keys map:', { kContract, kFromAI, kEmail, kCreatedAt, kAgency, kManagement });

    if (!kContract) return [];

    return jsonArray.map(item => {
        const fromAIVal = kFromAI ? item[kFromAI] : null;
        const fromAI = fromAIVal === true || fromAIVal === 'true' || fromAIVal === 'TRUE';
        return {
            contractNumber: ((kContract && item[kContract]) || '').toString().trim(),
            fromAI: fromAI,
            email:          ((kEmail && item[kEmail]) || '').toString().trim(),
            createdAt:      ((kCreatedAt && item[kCreatedAt]) || '').toString().trim(),
            agency:         ((kAgency && item[kAgency]) || '').toString().trim(),
            direction:      ((kManagement && item[kManagement]) || '').toString().trim()
        };
    });
}

/**
 * Parse new direct JSON array format for comparateur
 */
function parseComparateurJSON(jsonArray) {
    if (!Array.isArray(jsonArray) || jsonArray.length === 0) {
        console.warn('Invalid or empty JSON array for comparateur');
        return [];
    }

    console.log('Parsing comparateur from direct JSON array, rows:', jsonArray.length);
    const data = [];

    jsonArray.forEach((item) => {
        const contractNumber = (item['ContractNumber'] || '').trim();
        const createdAt = (item['AIDeliverable → CreatedAt'] || '').trim();
        const email = (item['User - UserId → Email'] || '').trim();
        const agency = (item['Agency - AgencyId → ProductionService'] || '').trim();
        const direction = (item['Agency - AgencyId → Management'] || '').trim();

        let maxPage = 0;
        const itemsStr = item['LongResult → IndexComparator → Items'];
        if (itemsStr && typeof itemsStr === 'string') {
            try {
                const items = JSON.parse(itemsStr);
                if (Array.isArray(items)) {
                    items.forEach(it => {
                        if (it.page !== undefined && it.page !== null) {
                            const pageNum = typeof it.page === 'number' ? it.page : parseInt(it.page);
                            if (!isNaN(pageNum)) maxPage = Math.max(maxPage, pageNum);
                        }
                    });
                }
            } catch (e) {
                console.warn('Failed to parse IndexComparator Items:', e.message);
            }
        }
        if (maxPage === 0) {
            maxPage = extractMaxPage(item['AIDeliverable → LongResult'] || '');
        }

        data.push({
            contractNumber,
            createdAt,
            email,
            agency,
            direction,
            maxPage
        });
    });

    console.log('Parsed', data.length, 'comparateur rows from direct JSON');
    return data;
}

/**
 * Parse direct JSON array from Metabase card 139 (Analyse Géotechnique).
 * One row per AnalyticEvent (Notice or Report). Front-end dedupes operations via DeliverableId.
 */
function parseAnalyticEventsJSON(jsonArray, noticeRe, reportRe, label, keepRe) {
    if (!Array.isArray(jsonArray) || jsonArray.length === 0) {
        return [];
    }
    const data = [];
    jsonArray.forEach(item => {
        const eventName = (item['EventName'] || '').trim();
        const isNotice = noticeRe.test(eventName);
        const isReport = reportRe.test(eventName);
        // keepRe (optionnel) : garde aussi les lignes "génération" qui ne sont
        // ni Notice ni Report (ex. AIDeliverable type ETUDE_ACOUSTIQUE).
        if (!isNotice && !isReport && !(keepRe && keepRe.test(eventName))) return;
        const contractNumber = (item['ContractNumber'] || '').trim();
        let agencyCode = null;
        const m = contractNumber.match(/C-([A-Z0-9]+)-/);
        if (m) agencyCode = m[1];
        data.push({
            eventName,
            isNotice,
            isReport,
            createdAt: (item['EventDate'] || '').trim(),
            deliverableId: (item['DeliverableId'] || '').trim(),
            reportId: (item['ReportId'] || '').trim(),
            noticesCount: parseInt(item['NoticesCount']) || 0,
            // Card 158 : nb de rapports créés depuis le livrable (events Create Report).
            reportsCount: parseInt(item['ReportsCount']) || 0,
            contractNumber,
            agencyCode,
            email: (item['UserEmail'] || '').trim(),
            agency: (item['Agence'] || '').trim(),
            direction: (item['DR'] || '').trim(),
        });
    });
    console.log('Parsed', data.length, label, 'events from direct JSON');
    return data;
}

function parseGeotechJSON(jsonArray) {
    return parseAnalyticEventsJSON(jsonArray,
        /^Create Notice From AI Geotech$/i, /^Create Report From AI Geotech$/i, 'geotech');
}

// Acoustique : source AIDeliverable type ETUDE_ACOUSTIQUE (card 158) — chaque
// ligne est une génération IA (pas d'events frontend Notice/Report comme la
// géotech). Les préfixes Create sont conservés au cas où AnalyzTech
// instrumenterait un jour le tracking.
function parseAcoustiqueJSON(jsonArray) {
    return parseAnalyticEventsJSON(jsonArray,
        /^Create Notice From AI Acousti/i, /^Create Report From AI Acousti/i, 'acoustique',
        /ACOUSTI/i);
}

/**
 * Parse AnalyticEvents CSV envelope (n8n format: [{ data: "csv..." }]).
 * The CSV is simple — no commas in fields — so we split on comma directly.
 */
function parseAnalyticEventsCSV(csvString, jsonParser) {
    if (!csvString || typeof csvString !== 'string') return [];
    const lines = csvString.split('\n').filter(l => l.trim() !== '');
    if (lines.length < 2) return [];

    const header = lines[0].split(',').map(h => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < header.length) continue;
        const row = {};
        header.forEach((key, idx) => {
            row[key] = (parts[idx] ?? '').trim();
        });
        rows.push(row);
    }
    return jsonParser(rows);
}

function parseGeotechCSV(csvString) {
    return parseAnalyticEventsCSV(csvString, parseGeotechJSON);
}

function parseAcoustiqueCSV(csvString) {
    return parseAnalyticEventsCSV(csvString, parseAcoustiqueJSON);
}

/**
 * Parse XPL Funnel API payload {count, data:[{marcheId, refMarche, typeAvis, dateDetection, leads:[...]}]}.
 * Returns an array of marchés (each with its leads).
 */
function parseAOPayload(payload) {
    if (!payload || !Array.isArray(payload.data)) {
        console.warn('Invalid AO payload — expected {count, data:[]}');
        return [];
    }
    return payload.data
        // Floor de mise en place : ignorer les marchés détectés avant le go-live.
        // (Les marchés sans date de détection valide sont conservés.)
        .filter(m => KPI.isAfterAOStart(m.dateDetection))
        .map(m => ({
            marcheId: m.marcheId || '',
            refMarche: m.refMarche || '',
            typeAvis: m.typeAvis || '',
            dateDetection: m.dateDetection || '',
            leads: Array.isArray(m.leads) ? m.leads : [],
        }));
}

/**
 * Compute the 4 funnel KPIs from a list of marchés.
 * Applies the dashboard's date filter on dateDetection.
 *   - captes       = total marchés
 *   - filtres      = marchés with ≥1 lead (passed the AI filter)
 *   - analyses     = total leads (= AO ouverts par un commercial)
 *   - opportunites = leads with opportunity != null
 */
function processAOData(marches) {
    const filtered = marches.filter(m => {
        if (!dateFilter.startDate && !dateFilter.endDate) return true;
        const d = parseFrenchDate(m.dateDetection);
        if (!d) return false;
        if (dateFilter.startDate) {
            const s = new Date(dateFilter.startDate);
            s.setHours(0, 0, 0, 0);
            if (d < s) return false;
        }
        if (dateFilter.endDate) {
            const e = new Date(dateFilter.endDate);
            e.setHours(23, 59, 59, 999);
            if (d > e) return false;
        }
        return true;
    });

    const captes = filtered.length;
    const filtres = filtered.filter(m => (m.leads || []).length > 0).length;
    let analyses = 0;
    let opportunites = 0;
    filtered.forEach(m => {
        (m.leads || []).forEach(l => {
            analyses++;
            if (l.opportunity) opportunites++;
        });
    });
    return { captes, filtres, analyses, opportunites };
}

/**
 * Parse CSV data for comparateur
 */
function parseComparateurCSV(csvString) {
    if (!csvString || typeof csvString !== 'string') {
        return [];
    }
    
    csvString = csvString.trim();
    while (csvString.startsWith('[') || csvString.startsWith('{')) {
        csvString = csvString.substring(1).trim();
    }
    while (csvString.endsWith(']') || csvString.endsWith('}')) {
        csvString = csvString.substring(0, csvString.length - 1).trim();
    }
    
    const lines = csvString.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) return [];
    
    const headers = parseCSVLine(lines[0]);
    
    // Find column indices
    let contractIndex = -1;
    let createdAtIndex = -1;
    let emailIndex = -1;
    let longResultIndex = -1;
    let indexComparatorItemsIndex = -1;
    let agencyIndex = -1;
    let managementIndex = -1;

    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        const headerLower = header.toLowerCase();

        if (contractIndex === -1 && (headerLower.includes('contractnumber') || header.includes('SubAffairDetailId'))) {
            contractIndex = i;
        }
        // CreatedAt — supports "CreatedAt" and "AIDeliverable → CreatedAt"
        if (createdAtIndex === -1 && headerLower.includes('createdat')) {
            createdAtIndex = i;
        }
        if (emailIndex === -1 && header.includes('User') && header.includes('Email')) {
            emailIndex = i;
        }
        // LongResult → IndexComparator → Items (direct JSON array — higher priority for pages)
        if (indexComparatorItemsIndex === -1 && headerLower.includes('indexcomparator') && headerLower.includes('items')) {
            indexComparatorItemsIndex = i;
        }
        // LongResult — supports "LongResult" and "AIDeliverable → LongResult"
        if (longResultIndex === -1 && headerLower.includes('longresult') && !headerLower.includes('indexcomparator')) {
            longResultIndex = i;
        }
        if (agencyIndex === -1 && headerLower.includes('productionservice')) {
            agencyIndex = i;
        }
        if (managementIndex === -1 && headerLower.includes('management')) {
            managementIndex = i;
        }
    }

    if (contractIndex === -1 || (longResultIndex === -1 && indexComparatorItemsIndex === -1)) {
        return [];
    }

    // Parse data rows
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < headers.length / 2) continue;

        const contractNumber = values[contractIndex] || '';
        const createdAt = (createdAtIndex >= 0 ? values[createdAtIndex] : '') || '';
        const email = (emailIndex >= 0 ? values[emailIndex] : '') || '';
        const longResult = (longResultIndex >= 0 ? values[longResultIndex] : '') || '';
        const agency = (agencyIndex >= 0 ? values[agencyIndex] : '') || '';
        const direction = (managementIndex >= 0 ? values[managementIndex] : '') || '';

        // Extract max page: try IndexComparator Items (flat array) first, then LongResult JSON
        let maxPage = 0;
        if (indexComparatorItemsIndex >= 0 && values[indexComparatorItemsIndex]) {
            try {
                const items = JSON.parse(values[indexComparatorItemsIndex]);
                if (Array.isArray(items)) {
                    items.forEach(it => {
                        if (it.page !== undefined && it.page !== null) {
                            const p = typeof it.page === 'number' ? it.page : parseInt(it.page);
                            if (!isNaN(p)) maxPage = Math.max(maxPage, p);
                        }
                    });
                }
            } catch (e) {
                console.warn('Failed to parse IndexComparator Items in CSV row:', e.message);
            }
        }
        if (maxPage === 0) {
            maxPage = extractMaxPage(longResult);
        }

        data.push({
            contractNumber: (contractNumber || '').trim(),
            createdAt: (createdAt || '').trim(),
            email: (email || '').trim(),
            agency: (agency || '').trim(),
            direction: (direction || '').trim(),
            maxPage: maxPage
        });
    }
    
    return data;
}

/**
 * Fix encoding issues in CSV text
 */
function fixEncoding(text) {
    const replacements = {
        'Ã©': 'é',
        'Ã¨': 'è',
        'Ãª': 'ê',
        'Ã ': 'à',
        'Ã¢': 'â',
        'Ã´': 'ô',
        'Ã»': 'û',
        'Ã§': 'ç',
        'Ã«': 'ë',
        'Ã¯': 'ï',
        'Ã¼': 'ü',
        'Ã': 'É',
        'Ã': 'È',
        'Ã': 'À',
        'Ã': 'Ç',
        '�': 'é'
    };
    
    let fixed = text;
    for (const [bad, good] of Object.entries(replacements)) {
        fixed = fixed.replace(new RegExp(bad, 'g'), good);
    }
    return fixed;
}

/**
 * Parse Population Data CSV (using same logic as descriptif.js)
 * Format: DR;Agence;Effectif
 */
// Helper function to parse CSV line with quoted values (cf. shared/utils.js)
function parseCSVLineWithCommas(line) {
    return KPI.parseCSVLine(line);
}

// Extract CSV content from "data" field if present
function extractCSVFromDataField(csvText) {
    // Check if first line is "data"
    const lines = csvText.split('\n');
    if (lines.length > 0 && lines[0].trim() === 'data') {
        // Extract everything after "data" line
        const csvLines = lines.slice(1);
        
        // Remove leading quote from first line if present
        if (csvLines.length > 0 && csvLines[0].startsWith('"')) {
            csvLines[0] = csvLines[0].substring(1);
        }
        
        // Remove trailing quote from last line if present
        if (csvLines.length > 0 && csvLines[csvLines.length - 1].trim() === '"') {
            csvLines.pop(); // Remove the line that is just a quote
        } else if (csvLines.length > 0 && csvLines[csvLines.length - 1].endsWith('"')) {
            csvLines[csvLines.length - 1] = csvLines[csvLines.length - 1].slice(0, -1);
        }
        
        return csvLines.join('\n').trim();
    }
    return csvText;
}

function parsePopulationData(csvString) {
    if (!csvString || typeof csvString !== 'string') return;

    console.log('=== Parsing Population Data ===');

    // First try: new direct Metabase JSON array format ([{"DR":"...","Agence":"...","Effectif":N}, ...])
    const trimmed = csvString.trim();
    if (trimmed.startsWith('[') && !trimmed.startsWith('[{"data"')) {
        try {
            const arr = JSON.parse(trimmed);
            if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'object' && !arr[0].data) {
                console.log('Found new direct JSON array format for population, rows:', arr.length);
                agencyPopulation = {};
                populationRows = [];
                let total = 0;
                const keys = Object.keys(arr[0]);
                const kDR  = keys.find(k => k.toLowerCase() === 'dr' || k.toLowerCase().includes('management'));
                const kAg  = keys.find(k => k.toLowerCase() === 'agence' || k.toLowerCase().includes('productionservice'));
                const kEff = keys.find(k => k.toLowerCase() === 'effectif' || k.toLowerCase() === 'count');
                arr.forEach(row => {
                    const dr = (row[kDR] || '').toString().trim();
                    const agencyCode = (row[kAg] || '').toString().trim().toUpperCase();
                    const effectif = parseInt(row[kEff]);
                    if (agencyCode && !isNaN(effectif)) {
                        agencyPopulation[agencyCode] = effectif;
                        populationRows.push({ dr, agencyCode, effectif });
                        total += effectif;
                    }
                });
                console.log('Parsed', Object.keys(agencyPopulation).length, 'agencies, total effectif:', total);
                if (total > 0) TOTAL_EFFECTIF = total;
                return;
            }
        } catch (e) {
            console.log('Not a direct JSON array, falling back to CSV path:', e.message);
        }
    }

    let csvText = fixEncoding(csvString);

    // Extract CSV from "data" field if present
    csvText = extractCSVFromDataField(csvText);

    console.log('After extraction, first 200 chars:', csvText.substring(0, 200));

    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    
    if (lines.length < 2) {
        console.warn('Population CSV has less than 2 lines');
        return;
    }
    
    console.log('First line (header):', lines[0]);
    console.log('Second line (sample):', lines[1]);
    console.log('Total lines:', lines.length);
    
    // Reset population map
    agencyPopulation = {};
    populationRows = [];
    let total = 0;
    
    // Skip header (line 0: DR,Agence,Effectif) - now using commas
    for (let i = 1; i < lines.length; i++) {
        const parts = parseCSVLineWithCommas(lines[i]);
        if (parts.length >= 3) {
            const dr = parts[0].trim();
            const agencyCode = parts[1].trim().toUpperCase(); // Normalize to uppercase
            const effectif = parseInt(parts[2].trim());
            
            if (agencyCode && !isNaN(effectif)) {
                agencyPopulation[agencyCode] = effectif;
                populationRows.push({ dr, agencyCode, effectif });
                total += effectif;
            } else {
                console.warn(`Skipping line ${i}: agencyCode="${agencyCode}", effectif="${parts[2]}"`);
            }
        } else {
            console.warn(`Line ${i} has ${parts.length} parts instead of 3:`, lines[i]);
        }
    }
    
    console.log('✓ Parsed population data:', Object.keys(agencyPopulation).length, 'agencies');
    console.log('✓ Agency codes:', Object.keys(agencyPopulation));
    console.log('✓ Sample entries:', Object.entries(agencyPopulation).slice(0, 5));
    console.log('✓ Total effectif from file:', total);
    
    // Update global total effectif if data seems valid
    if (total > 0) {
        TOTAL_EFFECTIF = total;
    }
}

// ==================== FILTERS AND TABLE MANAGEMENT ====================

/**
 * Extract unique directions and map agencies
 */
function extractDirectionsAndAgencies() {
    const directions = new Set();
    const agencies = new Set();
    agencyToDirection = {};
    
    // Helper to process data
    const processItems = (items) => {
        items.forEach(item => {
            const dir = item.direction;
            const ag = item.agency;
            
            if (dir) directions.add(dir);
            if (ag) agencies.add(ag);
            
            if (dir && ag) {
                agencyToDirection[ag] = dir;
            }
        });
    };
    
    processItems(descriptifData);
    processItems(autocontactData);
    processItems(comparateurData);
    processItems(expertBTPData);
    processItems(chatBTPData);
    processItems(expertCitaeData);
    processItems(chatCitaeData);
    processItems(expertBTPDiagData);
    processItems(chatBTPDiagData);
    processItems(geotechData);
    processItems(acoustiqueData);
    processItems(cctpData);

    availableDirections = Array.from(directions).sort();
    availableAgencies = Array.from(agencies).sort();
}

/**
 * Populate filter dropdowns
 */
function populateFilters() {
    // Populate Directions
    directionFilterEl.innerHTML = '<option value="">Toutes les directions</option>';
    availableDirections.forEach(dir => {
        const option = document.createElement('option');
        option.value = dir;
        option.textContent = dir;
        directionFilterEl.appendChild(option);
    });
    
    // Populate Agencies
    populateAgencyFilter();
}

/**
 * Populate agency filter based on selected direction
 */
function populateAgencyFilter() {
    const selectedDirection = directionFilterEl.value;
    const currentAgency = agencyFilterEl.value;
    
    agencyFilterEl.innerHTML = '<option value="">Toutes les agences</option>';
    
    const filteredAgencies = availableAgencies.filter(agency => {
        if (!selectedDirection) return true;
        return agencyToDirection[agency] === selectedDirection;
    });
    
    filteredAgencies.forEach(agency => {
        const option = document.createElement('option');
        option.value = agency;
        option.textContent = agency;
        agencyFilterEl.appendChild(option);
    });
    
    // Restore selection if valid
    if (currentAgency && filteredAgencies.includes(currentAgency)) {
        agencyFilterEl.value = currentAgency;
    }
}

/**
 * Filter data based on current filters
 */
function getFilteredData(data) {
    const filiale = filialeFilterEl.value;
    const direction = directionFilterEl.value;
    const agency = agencyFilterEl.value;
    
    return data.filter(item => {
        // SPS (BTP Consultants SPS) partage le domaine @btp-consultants.fr mais constitue une BU distincte.
        // On le reconnaît via le marqueur item.bu posé au chargement (source = fichiers _btp_sps).
        const isSPS = item.bu === 'SPS';

        // Filiale filter (based on email / BU)
        if (filiale === 'BTP Consultants') {
            if (!item.email.includes('@btp-consultants.fr')) return false;
            if (isSPS) return false; // ne pas compter les utilisateurs SPS dans BTP Consultants
        }
        if (filiale === 'Citae' && !item.email.includes('@citae.fr')) return false;
        if (filiale === 'BTP Diagnostics' && !item.email.includes('@btp-diagnostics.fr')) return false;
        if (filiale === 'BTP Consultants SPS' && !isSPS) return false;

        // Direction filter
        if (direction && item.direction !== direction) return false;
        
        // Agency filter
        if (agency && item.agency !== agency) return false;
        
        // Date filter
        if (dateFilter.startDate || dateFilter.endDate) {
            const itemDate = parseFrenchDate(item.createdAt);
            if (!itemDate) return false; // Skip items with invalid dates
            
            if (dateFilter.startDate) {
                const start = new Date(dateFilter.startDate);
                start.setHours(0, 0, 0, 0);
                if (itemDate < start) return false;
            }
            
            if (dateFilter.endDate) {
                const end = new Date(dateFilter.endDate);
                end.setHours(23, 59, 59, 999);
                if (itemDate > end) return false;
            }
        }
        
        return true;
    });
}

/**
 * Update Agency Table
 */
function updateAgencyTable() {
    if (!agencyTableBodyEl) return;
    const agencyStats = {};
    const hourlyRate = getHourlyRate();
    
    // Initialize stats for all available agencies
    availableAgencies.forEach(ag => {
        // Filter by current direction filter if active
        const selectedDirection = directionFilterEl.value;
        if (selectedDirection && agencyToDirection[ag] !== selectedDirection) return;
        
        // Filter by selected agency if active (Show only selected agency row)
        const selectedAgency = agencyFilterEl.value;
        if (selectedAgency && ag !== selectedAgency) return;
        
        agencyStats[ag] = {
            agency: ag,
            usersDescriptif: new Set(),
            usersAutocontact: new Set(),
            usersComparateur: new Set(),
            usersExpertBTP: new Set(),
            usersChatBTP: new Set(),
            descriptifCount: 0,
            descriptifPotential: 0,
            autocontactCount: 0,
            autocontactPotential: 0,
            comparateurCount: 0,
            comparateurPages: 0
        };
    });
    
    // Helper to get agency code from item (try agencyCode first, then extract from contractNumber, then use agency)
    const getAgencyCode = (item) => {
        if (item.agencyCode) return item.agencyCode.trim().toUpperCase();
        if (item.contractNumber) {
            const extracted = extractAgency(item.contractNumber);
            if (extracted) return extracted.trim().toUpperCase();
        }
        // Fallback: use agency field (should be productionService code)
        return (item.agency || '').trim().toUpperCase();
    };
    
    // Helper to aggregate stats
    const aggregate = (data, type) => {
        const filtered = getFilteredData(data);
        filtered.forEach(item => {
            const ag = item.agency;
            if (!ag || !agencyStats[ag]) return;
            
            const isBtpOrCitae = item.email && (item.email.includes('@btp-consultants.fr') || item.email.includes('@citae.fr'));
            
            if (type === 'descriptif' && !item.contractNumber.toUpperCase().includes('YIELD')) {
                agencyStats[ag].descriptifPotential++;
                if (isDescriptifRow(item)) {
                    agencyStats[ag].descriptifCount++;
                    if (isBtpOrCitae) agencyStats[ag].usersDescriptif.add(item.email);
                }
            } else if (type === 'autocontact' && !item.contractNumber.toUpperCase().includes('YIELD')) {
                agencyStats[ag].autocontactPotential++;
                if (item.fromAI) {
                    agencyStats[ag].autocontactCount++;
                    if (isBtpOrCitae) agencyStats[ag].usersAutocontact.add(item.email);
                }
            } else if (type === 'comparateur') {
                agencyStats[ag].comparateurCount++;
                agencyStats[ag].comparateurPages += (item.maxPage || 0);
                if (isBtpOrCitae) agencyStats[ag].usersComparateur.add(item.email);
            }
        });
    };
    
    aggregate(descriptifData, 'descriptif');
    aggregate(autocontactData, 'autocontact');
    aggregate(comparateurData, 'comparateur');
    
    // Aggregate Expert BTP Consultants data
    const expertBTPFiltered = getFilteredData(expertBTPData);
    expertBTPFiltered.forEach(item => {
        const ag = item.agency;
        if (!ag || !agencyStats[ag]) return;
        
        if (item.email && item.email.includes('@btp-consultants.fr')) {
            agencyStats[ag].usersExpertBTP.add(item.email);
        }
    });
    
    // Aggregate Chat BTP Consultants data
    const chatBTPFiltered = getFilteredData(chatBTPData);
    chatBTPFiltered.forEach(item => {
        const ag = item.agency;
        if (!ag || !agencyStats[ag]) return;
        
        if (item.email && item.email.includes('@btp-consultants.fr')) {
            agencyStats[ag].usersChatBTP.add(item.email);
        }
    });
    
    // Calculate final metrics
    let rows = Object.values(agencyStats).map(stat => {
        // Get agency code from the first item with this agency name
        // We need to find a sample item to extract the code
        let agencyCode = null;
        
        // Try to find agency code from data
        const sampleDescriptif = descriptifData.find(item => item.agency === stat.agency);
        const sampleAutocontact = autocontactData.find(item => item.agency === stat.agency);
        const sampleComparateur = comparateurData.find(item => item.agency === stat.agency);
        
        const sampleItem = sampleDescriptif || sampleAutocontact || sampleComparateur;
        if (sampleItem) {
            agencyCode = getAgencyCode(sampleItem);
        } else {
            // Fallback: use agency name as code (should already be the code)
            agencyCode = (stat.agency || '').trim().toUpperCase();
        }
        
        // Try to get effectif using agency code
        let effectif = agencyCode ? (agencyPopulation[agencyCode] || 0) : 0;
        
        // Debug: show what we're trying to match
        if (effectif === 0 && agencyCode) {
            console.log(`Looking for agency code "${agencyCode}" (from agency "${stat.agency}") in population map...`);
            console.log('Available keys in population:', Object.keys(agencyPopulation));
            
            // Try case-insensitive match
            const matchingKey = Object.keys(agencyPopulation).find(k => 
                k.trim().toUpperCase() === agencyCode
            );
            
            if (matchingKey) {
                effectif = agencyPopulation[matchingKey];
                console.log(`✓ Matched agency code "${agencyCode}" to population key "${matchingKey}" (effectif: ${effectif})`);
            } else {
                console.warn(`✗ No match found for agency code "${agencyCode}" (from agency "${stat.agency}")`);
            }
        }
        
        // Adoption rates per tool
        const adoptionDescriptif = effectif > 0 ? (stat.usersDescriptif.size / effectif) * 100 : 0;
        const adoptionAutocontact = effectif > 0 ? (stat.usersAutocontact.size / effectif) * 100 : 0;
        const adoptionComparateur = effectif > 0 ? (stat.usersComparateur.size / effectif) * 100 : 0;
        const adoptionExpertBTP = effectif > 0 ? (stat.usersExpertBTP.size / effectif) * 100 : 0;
        const adoptionChatBTP = effectif > 0 ? (stat.usersChatBTP.size / effectif) * 100 : 0;
        
        // Debug logs
        console.log(`Agency: ${stat.agency}, Effectif: ${effectif}, Users Descriptif: ${stat.usersDescriptif.size}, Adoption Descriptif: ${adoptionDescriptif.toFixed(1)}%`);
        
        if (effectif === 0 && (stat.usersDescriptif.size > 0 || stat.usersAutocontact.size > 0 || stat.usersComparateur.size > 0)) {
            console.warn(`Agency "${stat.agency}" has users but 0 effectif. Check population_cible.csv mapping.`);
            console.warn('This agency code may not exist in population_cible.csv or has a different format.');
        }
        
        // Calculate Shortfall (Manque à gagner)
        const costPerDescriptif = (MINUTES_PER_DESCRIPTIF / 60) * hourlyRate;
        const costPerContact = (SECONDS_PER_CONTACT / 3600) * hourlyRate;
        
        const descriptifGap = Math.max(0, stat.descriptifPotential - stat.descriptifCount);
        const descriptifShortfall = descriptifGap * costPerDescriptif;
        
        const autocontactGap = Math.max(0, stat.autocontactPotential - stat.autocontactCount);
        const autocontactShortfall = autocontactGap * costPerContact;
        
        const totalShortfall = descriptifShortfall + autocontactShortfall;
        
        return {
            agency: stat.agency,
            shortfall: totalShortfall,
            adoptionDescriptif: adoptionDescriptif,
            adoptionAutocontact: adoptionAutocontact,
            adoptionComparateur: adoptionComparateur,
            adoptionExpertBTP: adoptionExpertBTP,
            adoptionChatBTP: adoptionChatBTP,
            descriptifCount: stat.descriptifCount,
            autocontactCount: stat.autocontactCount,
            comparateurCount: stat.comparateurCount,
            expertBTPCount: stat.usersExpertBTP.size,
            chatBTPCount: stat.usersChatBTP.size,
            total: stat.descriptifCount + stat.autocontactCount + stat.comparateurCount
        };
    });
    
    // Map column names from HTML to object property names
    const columnMapping = {
        'agency': 'agency',
        'shortfall': 'shortfall',
        'descriptif': 'adoptionDescriptif',
        'autocontact': 'adoptionAutocontact',
        'comparateur': 'adoptionComparateur',
        'expert-btp': 'adoptionExpertBTP',
        'chat-btp': 'adoptionChatBTP',
        'total': 'total'
    };
    
    // Sort
    rows.sort((a, b) => {
        const propertyName = columnMapping[tableSortState.column] || tableSortState.column;
        let valA = a[propertyName];
        let valB = b[propertyName];
        
        // Handle undefined, null, NaN, Infinity values
        if (valA === undefined || valA === null || isNaN(valA) || !isFinite(valA)) {
            valA = typeof valA === 'string' ? '' : 0;
        }
        if (valB === undefined || valB === null || isNaN(valB) || !isFinite(valB)) {
            valB = typeof valB === 'string' ? '' : 0;
        }
        
        // If both are strings, compare as strings
        if (typeof valA === 'string' && typeof valB === 'string') {
            return tableSortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        
        // Convert to numbers for comparison
        const numA = typeof valA === 'number' ? valA : parseFloat(valA) || 0;
        const numB = typeof valB === 'number' ? valB : parseFloat(valB) || 0;
        
        return tableSortState.ascending ? numA - numB : numB - numA;
    });
    
    // Render
    agencyTableBodyEl.innerHTML = '';
    
    if (rows.length === 0) {
        agencyTableBodyEl.innerHTML = `
            <tr>
                <td colspan="8" class="px-6 py-4 text-center text-gray-500">
                    Aucune donnée disponible
                </td>
            </tr>
        `;
        return;
    }
    
    rows.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        
        const getColorClass = (rate) => {
            if (rate >= 50) return 'text-green-600';
            if (rate >= 20) return 'text-yellow-600';
            return 'text-red-600';
        };
        
        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${row.agency}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                <span class="font-medium text-red-600">${formatNumber(row.shortfall)} €</span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                <div class="flex flex-col items-center justify-center">
                    <span class="font-medium ${getColorClass(row.adoptionDescriptif)}">${row.adoptionDescriptif.toFixed(1)}%</span>
                    <span class="text-xs text-gray-400">(${row.descriptifCount})</span>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                <div class="flex flex-col items-center justify-center">
                    <span class="font-medium ${getColorClass(row.adoptionAutocontact)}">${row.adoptionAutocontact.toFixed(1)}%</span>
                    <span class="text-xs text-gray-400">(${row.autocontactCount})</span>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                <div class="flex flex-col items-center justify-center">
                    <span class="font-medium ${getColorClass(row.adoptionComparateur)}">${row.adoptionComparateur.toFixed(1)}%</span>
                    <span class="text-xs text-gray-400">(${row.comparateurCount})</span>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                <div class="flex flex-col items-center justify-center">
                    <span class="font-medium ${getColorClass(row.adoptionExpertBTP)}">${row.adoptionExpertBTP.toFixed(1)}%</span>
                    <span class="text-xs text-gray-400">(${row.expertBTPCount})</span>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                <div class="flex flex-col items-center justify-center">
                    <span class="font-medium ${getColorClass(row.adoptionChatBTP)}">${row.adoptionChatBTP.toFixed(1)}%</span>
                    <span class="text-xs text-gray-400">(${row.chatBTPCount})</span>
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-blue-600 text-center">${row.total}</td>
        `;
        agencyTableBodyEl.appendChild(tr);
    });
    
    updateSortIcons();
}

/**
 * Sort table function
 */
function sortTable(column) {
    if (tableSortState.column === column) {
        tableSortState.ascending = !tableSortState.ascending;
    } else {
        tableSortState.column = column;
        tableSortState.ascending = false;
    }
    updateAgencyTable();
}

function updateSortIcons() {
    ['agency', 'shortfall', 'descriptif', 'autocontact', 'comparateur', 'expert-btp', 'chat-btp', 'total'].forEach(col => {
        const icon = document.getElementById(`sort-icon-${col}`);
        if (icon) {
            if (tableSortState.column === col) {
                icon.textContent = tableSortState.ascending ? '↑' : '↓';
                icon.className = 'ml-1 text-blue-600';
            } else {
                icon.textContent = '↕';
                icon.className = 'ml-1 text-gray-400';
            }
        }
    });
}

// ==================== DATA PROCESSING ====================

/**
 * Process descriptif data
 */
function processDescriptifData(data) {
    // Filter YIELD affairs and apply current filters
    const filtered = getFilteredData(data).filter(item => 
        !item.contractNumber.toUpperCase().includes('YIELD')
    );
    
    // Total RICT = nombre unique d'affaires (contractNumber uniques)
    const uniqueContracts = new Set();
    filtered.forEach(item => {
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            uniqueContracts.add(item.contractNumber);
        }
    });
    const totalRict = uniqueContracts.size;
    
    // Filter by type
    const descriptifFiltered = filtered.filter(item => 
        isDescriptifRow(item)
    );
    
    // Total utilisations = nombre de descriptifs générés
    const totalUtilisations = descriptifFiltered.length;
    
    // Unique users
    const uniqueUsers = new Set();
    descriptifFiltered.forEach(item => {
        if (item.email && item.email.trim() !== '') {
            uniqueUsers.add(item.email);
        }
    });
    
    // Unique operations (contracts) - exclure les RICT avec moins de 100 mots
    const uniqueOperations = new Set();
    descriptifFiltered.forEach(item => {
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            // Compter les mots dans la description (utilise précalculé si dispo)
            const wordCount = (typeof item.descriptionWordCount === 'number')
                ? item.descriptionWordCount
                : countWords(extractText(item.description || ''));

            // Ne compter que les RICT avec au moins 100 mots
            if (wordCount >= 100) {
                uniqueOperations.add(item.contractNumber);
            }
        }
    });

    return {
        totalRict,
        totalUtilisations,
        uniqueUsers: uniqueUsers.size,
        uniqueOperations: uniqueOperations.size
    };
}

/**
 * Process autocontact data
 */
function processAutocontactData(data) {
    // Filter YIELD affairs and apply current filters
    const filtered = getFilteredData(data).filter(item => 
        !item.contractNumber.toUpperCase().includes('YIELD')
    );
    
    // Total contacts
    const totalContacts = filtered.length;
    
    // Filter by FromAI
    const aiFiltered = filtered.filter(item => item.fromAI);
    
    // Total AI contacts
    const aiContacts = aiFiltered.length;
    
    // Unique users (from AI contacts only)
    const uniqueUsers = new Set();
    aiFiltered.forEach(item => {
        if (item.email && item.email.trim() !== '' && item.email.includes('@btp-consultants.fr')) {
            uniqueUsers.add(item.email);
        }
    });
    
    // Unique operations (contracts with AI contacts)
    const uniqueOperations = new Set();
    aiFiltered.forEach(item => {
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            uniqueOperations.add(item.contractNumber);
        }
    });
    
    console.log('Autocontact Stats (Index Page):');
    console.log('- Total contacts (excl YIELD):', totalContacts);
    console.log('- AI contacts:', aiContacts);
    console.log('- Unique users with AI:', uniqueUsers.size);
    console.log('- Unique operations:', uniqueOperations.size);
    
    return {
        totalContacts,
        aiContacts,
        uniqueUsers: uniqueUsers.size,
        uniqueOperations: uniqueOperations.size
    };
}

/**
 * Process Autocontact SPS data.
 * La source (backoffice BTP Force) EST le marqueur de BU : aucune ligne n'est à
 * exclure, contrairement à l'Autocontact CT où l'on retire les affaires YIELD.
 */
function processAutocontactSpsData(data) {
    const filtered = getFilteredData(data);
    const aiFiltered = filtered.filter(item => item.fromAI);

    // Utilisateurs : ceux qui ont créé au moins un contact VIA L'IA.
    const uniqueUsers = new Set();
    aiFiltered.forEach(item => {
        if (item.email && item.email.trim() !== '') uniqueUsers.add(item.email);
    });

    // "Utilisation" = une affaire touchée par l'IA, comme uniqueOperations côté CT.
    const uniqueOperations = new Set();
    aiFiltered.forEach(item => {
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            uniqueOperations.add(item.contractNumber);
        }
    });

    return {
        totalContacts: filtered.length,
        aiContacts: aiFiltered.length,
        uniqueUsers: uniqueUsers.size,
        uniqueOperations: uniqueOperations.size
    };
}

/**
 * Process comparateur data
 */
function processComparateurData(data) {
    // Apply filters
    const filtered = getFilteredData(data);
    
    // Total comparisons
    const totalComparisons = filtered.length;
    
    // Unique users
    const uniqueUsers = new Set();
    filtered.forEach(item => {
        if (item.email && item.email.trim() !== '') {
            uniqueUsers.add(item.email);
        }
    });
    
    // Unique operations (contracts)
    const uniqueOperations = new Set();
    filtered.forEach(item => {
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            uniqueOperations.add(item.contractNumber);
        }
    });
    
    // Total pages analyzed
    let totalPages = 0;
    filtered.forEach(item => {
        totalPages += item.maxPage || 0;
    });
    
    return {
        totalComparisons,
        uniqueUsers: uniqueUsers.size,
        uniqueOperations: uniqueOperations.size,
        totalPages
    };
}

/**
 * Process geotech (analyse géotechnique) data — quality-focused brique, no time/€ gain.
 * Dedupes operations via DeliverableId (one operation emits 2 events: Notice + Report).
 */
function processGeotechData(data) {
    const filtered = getFilteredData(data);
    const uniqueUsers = new Set();
    const uniqueDeliverables = new Set();
    let totalNotices = 0;
    let totalReports = 0;
    filtered.forEach(item => {
        if (item.email) uniqueUsers.add(item.email);
        if (item.deliverableId) uniqueDeliverables.add(item.deliverableId);
        if (item.isNotice) totalNotices += item.noticesCount || 1;
        if (item.isReport) totalReports++;
    });
    return {
        totalOperations: uniqueDeliverables.size,
        totalNotices,
        totalReports,
        uniqueUsers: uniqueUsers.size,
    };
}

// Brique qualité (pas de gain h/€), source AIDeliverable : opérations
// (dédup DeliverableId), affaires uniques, utilisateurs uniques. L'injection
// dans S+ (notices, rapports) est portée par chaque ligne livrable (card 158,
// lue dans les events Create Notice/Report From AI Acoustic).
function processAcoustiqueData(data) {
    const filtered = getFilteredData(data);
    const uniqueUsers = new Set();
    const uniqueDeliverables = new Set();
    const uniqueContracts = new Set();
    let totalNotices = 0;
    let totalReports = 0;
    filtered.forEach(item => {
        if (item.email) uniqueUsers.add(item.email);
        if (item.contractNumber) uniqueContracts.add(item.contractNumber);
        if (!item.deliverableId || uniqueDeliverables.has(item.deliverableId)) return;
        uniqueDeliverables.add(item.deliverableId);
        totalNotices += item.noticesCount || 0;
        totalReports += item.reportsCount || 0;
    });
    return {
        totalOperations: uniqueDeliverables.size,
        uniqueContracts: uniqueContracts.size,
        uniqueUsers: uniqueUsers.size,
        totalNotices,
        totalReports,
    };
}

// Analyse CCTP vs Référentiel : brique qualité (pas de gain h/€). Agrégats
// partagés avec analyse-cctp.html (KPI.aggregateCctp) ; les lancements en
// erreur ne comptent pas comme analyses.
function processCctpData(data) {
    return KPI.aggregateCctp(getFilteredData(data));
}

/**
 * Calculate gains - MUST match the logic in descriptif.js, autocontact.js, comparateur.js, chat and expert pages
 */
function calculateGains(descriptifCount, aiContactsCount, totalPages, chatBTPMessages, expertBTPMessages, chatCitaeMessages, expertCitaeMessages, chatBTPDiagMessages, expertBTPDiagMessages, nfHabitatPoints, aoAnalyses, chatBtpSpsMessages, expertBtpSpsMessages, autocontactSpsContacts) {
    // Gain en temps pour descriptifs (minutes → heures)
    const timeGainMinutesDescriptif = descriptifCount * MINUTES_PER_DESCRIPTIF;
    const timeGainHoursDescriptif = timeGainMinutesDescriptif / 60;

    // Gain en temps pour autocontacts (secondes → heures)
    const timeGainSecondsAutocontact = aiContactsCount * SECONDS_PER_CONTACT;
    const timeGainHoursAutocontact = timeGainSecondsAutocontact / 3600;

    // Gain en temps pour comparateur (secondes → heures)
    const timeGainSecondsComparateur = totalPages * SECONDS_PER_PAGE;
    const timeGainHoursComparateur = timeGainSecondsComparateur / 3600;

    // Gain en temps pour chat BTP (minutes → heures)
    const timeGainMinutesChatBTP = (chatBTPMessages || 0) * MINUTES_PER_MESSAGE;
    const timeGainHoursChatBTP = timeGainMinutesChatBTP / 60;

    // Gain en temps pour expert BTP (minutes → heures)
    const timeGainMinutesExpertBTP = (expertBTPMessages || 0) * MINUTES_PER_MESSAGE_EXPERT;
    const timeGainHoursExpertBTP = timeGainMinutesExpertBTP / 60;

    // Gain en temps pour chat Citae (minutes → heures)
    const timeGainMinutesChatCitae = (chatCitaeMessages || 0) * MINUTES_PER_MESSAGE;
    const timeGainHoursChatCitae = timeGainMinutesChatCitae / 60;

    // Gain en temps pour expert Citae (minutes → heures)
    const timeGainMinutesExpertCitae = (expertCitaeMessages || 0) * MINUTES_PER_MESSAGE_EXPERT;
    const timeGainHoursExpertCitae = timeGainMinutesExpertCitae / 60;

    // Gain en temps pour chat BTP Diagnostics (minutes → heures)
    const timeGainMinutesChatBTPDiag = (chatBTPDiagMessages || 0) * MINUTES_PER_MESSAGE;
    const timeGainHoursChatBTPDiag = timeGainMinutesChatBTPDiag / 60;

    // Gain en temps pour expert BTP Diagnostics (minutes → heures)
    const timeGainMinutesExpertBTPDiag = (expertBTPDiagMessages || 0) * MINUTES_PER_MESSAGE_EXPERT;
    const timeGainHoursExpertBTPDiag = timeGainMinutesExpertBTPDiag / 60;

    // Gain en temps pour chat BTP Consultants SPS (minutes → heures)
    const timeGainMinutesChatBtpSps = (chatBtpSpsMessages || 0) * MINUTES_PER_MESSAGE;
    const timeGainHoursChatBtpSps = timeGainMinutesChatBtpSps / 60;

    // Gain en temps pour expert BTP Consultants SPS (minutes → heures)
    const timeGainMinutesExpertBtpSps = (expertBtpSpsMessages || 0) * MINUTES_PER_MESSAGE_EXPERT;
    const timeGainHoursExpertBtpSps = timeGainMinutesExpertBtpSps / 60;

    // Gain en temps pour Autocontact SPS (secondes → heures) : même hypothèse que
    // l'Autocontact CT, c'est le même geste métier dans une autre application.
    const timeGainSecondsAutocontactSps = (autocontactSpsContacts || 0) * SECONDS_PER_CONTACT;
    const timeGainHoursAutocontactSps = timeGainSecondsAutocontactSps / 3600;

    // Gain en temps pour NF Habitat (heures par point)
    const timeGainHoursNFHabitat = (nfHabitatPoints || 0) * HOURS_PER_POINT_NF;

    // Gain en temps pour Analyse AO (minutes → heures)
    const timeGainMinutesAO = (aoAnalyses || 0) * MINUTES_PER_AO_ANALYSE;
    const timeGainHoursAO = timeGainMinutesAO / 60;

    // Total time gain
    const totalTimeGain = timeGainHoursDescriptif + timeGainHoursAutocontact + timeGainHoursComparateur
        + timeGainHoursChatBTP + timeGainHoursExpertBTP + timeGainHoursChatCitae + timeGainHoursExpertCitae
        + timeGainHoursChatBTPDiag + timeGainHoursExpertBTPDiag + timeGainHoursChatBtpSps + timeGainHoursExpertBtpSps
        + timeGainHoursAutocontactSps + timeGainHoursNFHabitat + timeGainHoursAO;

    // Gain en % volume d'affaire (BTP Consultants scope: 44M€)
    const percentGain = (totalTimeGain / (TOTAL_EFFECTIF * ANNUAL_HOURS)) * 100;

    // Gain en €
    const euroGain = (percentGain / 100) * TOTAL_REVENUE;

    return {
        timeGainHours: totalTimeGain,
        timeGainHoursDescriptif,
        timeGainHoursAutocontact,
        timeGainHoursComparateur,
        timeGainHoursChatBTP,
        timeGainHoursExpertBTP,
        timeGainHoursChatCitae,
        timeGainHoursExpertCitae,
        timeGainHoursChatBTPDiag,
        timeGainHoursExpertBTPDiag,
        timeGainHoursChatBtpSps,
        timeGainHoursExpertBtpSps,
        timeGainHoursAutocontactSps,
        timeGainHoursNFHabitat,
        timeGainHoursAO,
        percentGain,
        euroGain
    };
}

/**
 * Format number with thousands separator (cf. shared/utils.js)
 */
function formatNumber(num) {
    return KPI.formatNumber(num);
}

// ==================== UPDATE UI ====================

function processExpertBTPData(data) {
    // Apply filters
    const filtered = getFilteredData(data);
    
    // Total sessions (each item is a session)
    const totalSessions = filtered.length;
    
    // Unique users
    const uniqueUsers = new Set();
    filtered.forEach(item => {
        if (item.email && item.email.trim() !== '') {
            uniqueUsers.add(item.email);
        }
    });
    
    // Total messages
    const totalMessages = filtered.reduce((sum, item) => sum + (item.messagesLength || 0), 0);
    
    // Total cost
    const totalCost = filtered.reduce((sum, item) => sum + (item.totalCostInDollars || 0), 0);
    
    return {
        totalSessions,
        uniqueUsers: uniqueUsers.size,
        totalMessages,
        totalCost
    };
}

function processChatBTPData(data) {
    // Apply filters
    const filtered = getFilteredData(data);
    
    // Total sessions (each item is a session)
    const totalSessions = filtered.length;
    
    // Unique users
    const uniqueUsers = new Set();
    filtered.forEach(item => {
        if (item.email && item.email.trim() !== '') {
            uniqueUsers.add(item.email);
        }
    });
    
    // Total messages
    const totalMessages = filtered.reduce((sum, item) => sum + (item.messagesLength || 0), 0);
    
    // Total cost
    const totalCost = filtered.reduce((sum, item) => sum + (item.totalCostInDollars || 0), 0);
    
    return {
        totalSessions,
        uniqueUsers: uniqueUsers.size,
        totalMessages,
        totalCost
    };
}

function processExpertCitaeData(data) {
    // Apply filters
    const filtered = getFilteredData(data);
    
    // Total sessions (each item is a session)
    const totalSessions = filtered.length;
    
    // Unique users
    const uniqueUsers = new Set();
    filtered.forEach(item => {
        if (item.email && item.email.trim() !== '') {
            uniqueUsers.add(item.email);
        }
    });
    
    // Total messages
    const totalMessages = filtered.reduce((sum, item) => sum + (item.messagesLength || 0), 0);
    
    // Total cost
    const totalCost = filtered.reduce((sum, item) => sum + (item.totalCostInDollars || 0), 0);
    
    return {
        totalSessions,
        uniqueUsers: uniqueUsers.size,
        totalMessages,
        totalCost
    };
}

function processChatCitaeData(data) {
    // Apply filters
    const filtered = getFilteredData(data);
    
    // Total sessions (each item is a session)
    const totalSessions = filtered.length;
    
    // Unique users
    const uniqueUsers = new Set();
    filtered.forEach(item => {
        if (item.email && item.email.trim() !== '') {
            uniqueUsers.add(item.email);
        }
    });
    
    // Total messages
    const totalMessages = filtered.reduce((sum, item) => sum + (item.messagesLength || 0), 0);
    
    // Total cost
    const totalCost = filtered.reduce((sum, item) => sum + (item.totalCostInDollars || 0), 0);
    
    return {
        totalSessions,
        uniqueUsers: uniqueUsers.size,
        totalMessages,
        totalCost
    };
}

function processExpertBTPDiagData(data) {
    const filtered = getFilteredData(data).filter(item =>
        item.email && item.email.includes('@btp-diagnostics.fr')
    );
    const totalSessions = filtered.length;
    const uniqueUsers = new Set();
    filtered.forEach(item => {
        if (item.email && item.email.trim() !== '') uniqueUsers.add(item.email);
    });
    const totalMessages = filtered.reduce((sum, item) => sum + (item.messagesLength || 0), 0);
    const totalCost = filtered.reduce((sum, item) => sum + (item.totalCostInDollars || 0), 0);
    return { totalSessions, uniqueUsers: uniqueUsers.size, totalMessages, totalCost };
}

function processChatBTPDiagData(data) {
    const filtered = getFilteredData(data).filter(item =>
        item.email && item.email.includes('@btp-diagnostics.fr')
    );
    const totalSessions = filtered.length;
    const uniqueUsers = new Set();
    filtered.forEach(item => {
        if (item.email && item.email.trim() !== '') uniqueUsers.add(item.email);
    });
    const totalMessages = filtered.reduce((sum, item) => sum + (item.messagesLength || 0), 0);
    const totalCost = filtered.reduce((sum, item) => sum + (item.totalCostInDollars || 0), 0);
    return { totalSessions, uniqueUsers: uniqueUsers.size, totalMessages, totalCost };
}

// Expert / Chat BTP Consultants SPS : données déjà isolées par source (fichiers _btp_sps).
// Pas de re-filtre par email (le domaine @btp-consultants.fr est partagé avec BTP Consultants).
function processExpertBtpSpsData(data) {
    const filtered = getFilteredData(data);
    const totalSessions = filtered.length;
    const uniqueUsers = new Set();
    filtered.forEach(item => {
        if (item.email && item.email.trim() !== '') uniqueUsers.add(item.email);
    });
    const totalMessages = filtered.reduce((sum, item) => sum + (item.messagesLength || 0), 0);
    const totalCost = filtered.reduce((sum, item) => sum + (item.totalCostInDollars || 0), 0);
    return { totalSessions, uniqueUsers: uniqueUsers.size, totalMessages, totalCost };
}

function processChatBtpSpsData(data) {
    const filtered = getFilteredData(data);
    const totalSessions = filtered.length;
    const uniqueUsers = new Set();
    filtered.forEach(item => {
        if (item.email && item.email.trim() !== '') uniqueUsers.add(item.email);
    });
    const totalMessages = filtered.reduce((sum, item) => sum + (item.messagesLength || 0), 0);
    const totalCost = filtered.reduce((sum, item) => sum + (item.totalCostInDollars || 0), 0);
    return { totalSessions, uniqueUsers: uniqueUsers.size, totalMessages, totalCost };
}

/**
 * NF Habitat filter: controlName contains "NF" AND "Habitat" (case-insensitive), status === "COMPLETED"
 */
function isNFHabitatItem(item) {
    const name = (item.controlName || '').toLowerCase();
    return name.includes('nf') && name.includes('habitat') && item.status === 'COMPLETED';
}

function processNFHabitatData(data) {
    const filtered = getFilteredData(data).filter(isNFHabitatItem);
    const uniqueUsers = new Set();
    const uniqueProjects = new Set();
    let totalPoints = 0;
    filtered.forEach(item => {
        totalPoints += (item.pointCount || 0);
        const email = (item.userEmail || item.email || '').trim();
        if (email) uniqueUsers.add(email.toLowerCase());
        const proj = item.projectId || item.projectName;
        if (proj) uniqueProjects.add(proj);
    });
    return {
        totalControls: filtered.length,
        totalPoints,
        uniqueUsers: uniqueUsers.size,
        uniqueProjects: uniqueProjects.size
    };
}

function updateKPIs() {
    const descriptifStats = processDescriptifData(descriptifData);
    const autocontactStats = processAutocontactData(autocontactData);
    const comparateurStats = processComparateurData(comparateurData);
    const geotechStats = processGeotechData(geotechData);
    const acoustiqueStats = processAcoustiqueData(acoustiqueData);
    const cctpStats = processCctpData(cctpData);
    const expertBTPStats = processExpertBTPData(expertBTPData);
    const chatBTPStats = processChatBTPData(chatBTPData);
    const expertCitaeStats = processExpertCitaeData(expertCitaeData);
    const chatCitaeStats = processChatCitaeData(chatCitaeData);
    const expertBTPDiagStats = processExpertBTPDiagData(expertBTPDiagData);
    const chatBTPDiagStats = processChatBTPDiagData(chatBTPDiagData);
    const expertBtpSpsStats = processExpertBtpSpsData(expertBtpSpsData);
    const chatBtpSpsStats = processChatBtpSpsData(chatBtpSpsData);
    const autocontactSpsStats = processAutocontactSpsData(autocontactSpsData);
    const nfHabitatStats = processNFHabitatData(nfHabitatData);

    // Global stats
    // For autocontact, use uniqueOperations (number of usages) instead of aiContacts (total contacts generated)
    // For geotech, use totalOperations (distinct DeliverableId) — one operation = 1 notice + 1 report, so we dedup.
    const totalUtilisations = descriptifStats.totalUtilisations + autocontactStats.uniqueOperations + comparateurStats.totalComparisons + expertBTPStats.totalSessions + chatBTPStats.totalSessions + expertCitaeStats.totalSessions + chatCitaeStats.totalSessions + expertBTPDiagStats.totalSessions + chatBTPDiagStats.totalSessions + expertBtpSpsStats.totalSessions + chatBtpSpsStats.totalSessions + autocontactSpsStats.uniqueOperations + nfHabitatStats.totalControls + geotechStats.totalOperations + acoustiqueStats.totalOperations + cctpStats.totalOperations;
    const allUsers = new Set();
    
    getFilteredData(descriptifData).filter(item => isDescriptifRow(item)).forEach(item => {
        if (item.email) allUsers.add(item.email);
    });
    
    // For autocontact: filter YIELD affairs first, then filter by FromAI
    getFilteredData(autocontactData)
        .filter(item => !item.contractNumber.toUpperCase().includes('YIELD'))
        .filter(item => item.fromAI)
        .forEach(item => {
            if (item.email && item.email.trim() !== '' && item.email.includes('@btp-consultants.fr')) {
                allUsers.add(item.email);
            }
        });
        
    getFilteredData(comparateurData).forEach(item => {
        if (item.email) allUsers.add(item.email);
    });

    getFilteredData(geotechData).forEach(item => {
        if (item.email) allUsers.add(item.email);
    });

    getFilteredData(acoustiqueData).forEach(item => {
        if (item.email) allUsers.add(item.email);
    });

    getFilteredData(cctpData).filter(item => item.status !== 'ERROR').forEach(item => {
        if (item.email) allUsers.add(item.email);
    });

    getFilteredData(expertBTPData).forEach(item => {
        if (item.email && item.email.includes('@btp-consultants.fr')) {
            allUsers.add(item.email);
        }
    });
    
    getFilteredData(chatBTPData).forEach(item => {
        if (item.email && item.email.includes('@btp-consultants.fr')) {
            allUsers.add(item.email);
        }
    });
    
    getFilteredData(expertCitaeData).forEach(item => {
        if (item.email && item.email.includes('@citae.fr')) {
            allUsers.add(item.email);
        }
    });
    
    getFilteredData(chatCitaeData).forEach(item => {
        if (item.email && item.email.includes('@citae.fr')) {
            allUsers.add(item.email);
        }
    });
    
    getFilteredData(expertBTPDiagData).forEach(item => {
        if (item.email && item.email.includes('@btp-diagnostics.fr')) {
            allUsers.add(item.email);
        }
    });
    
    getFilteredData(chatBTPDiagData).forEach(item => {
        if (item.email && item.email.includes('@btp-diagnostics.fr')) {
            allUsers.add(item.email);
        }
    });

    // Expert / Chat BTP Consultants SPS users — comptés dans le total Groupe,
    // mais pas dans la filiale BTP Consultants (cf. getFilteredData).
    getFilteredData(expertBtpSpsData).forEach(item => {
        if (item.email && item.email.trim() !== '') allUsers.add(item.email);
    });
    getFilteredData(chatBtpSpsData).forEach(item => {
        if (item.email && item.email.trim() !== '') allUsers.add(item.email);
    });
    // Autocontact SPS : seuls les utilisateurs de l'IA comptent (la saisie manuelle
    // de contacts n'est pas un usage IA).
    getFilteredData(autocontactSpsData).forEach(item => {
        if (item.fromAI && item.email && item.email.trim() !== '') allUsers.add(item.email);
    });

    // NF Habitat users
    getFilteredData(nfHabitatData).filter(isNFHabitatItem).forEach(item => {
        const email = (item.userEmail || item.email || '').trim().toLowerCase();
        if (email) allUsers.add(email);
    });

    totalUtilisationsEl.textContent = formatNumber(totalUtilisations);
    totalUsersEl.textContent = allUsers.size;

    // NF Habitat card stats
    const nfHabitatCountEl = document.getElementById('nf-habitat-count');
    const nfHabitatPointsEl = document.getElementById('nf-habitat-points');
    const nfHabitatProjectsEl = document.getElementById('nf-habitat-projects');
    const nfHabitatUsersEl = document.getElementById('nf-habitat-users');
    if (nfHabitatCountEl) nfHabitatCountEl.textContent = formatNumber(nfHabitatStats.totalControls);
    if (nfHabitatPointsEl) nfHabitatPointsEl.textContent = formatNumber(nfHabitatStats.totalPoints);
    if (nfHabitatProjectsEl) nfHabitatProjectsEl.textContent = formatNumber(nfHabitatStats.uniqueProjects);
    if (nfHabitatUsersEl) nfHabitatUsersEl.textContent = formatNumber(nfHabitatStats.uniqueUsers);
    
    // Descriptif stats
    descriptifCountEl.textContent = formatNumber(descriptifStats.totalUtilisations);
    descriptifOpsEl.textContent = formatNumber(descriptifStats.uniqueOperations);
    descriptifTotalRictEl.textContent = formatNumber(descriptifStats.totalRict);
    descriptifUsersEl.textContent = descriptifStats.uniqueUsers;
    
    // Autocontact stats
    autocontactOpsEl.textContent = formatNumber(autocontactStats.uniqueOperations);
    autocontactAiContactsEl.textContent = formatNumber(autocontactStats.aiContacts);
    autocontactTotalContactsEl.textContent = formatNumber(autocontactStats.totalContacts);
    autocontactUsersEl.textContent = autocontactStats.uniqueUsers;
    
    // Autocontact SPS stats — mêmes indicateurs, dans le même ordre, que la tuile
    // Auto Contacts de BTP Consultants : utilisations / contacts IA / total / users.
    const autocontactSpsOpsEl = document.getElementById('autocontact-sps-ops');
    const autocontactSpsAiContactsEl = document.getElementById('autocontact-sps-ai-contacts');
    const autocontactSpsTotalEl = document.getElementById('autocontact-sps-total-contacts');
    const autocontactSpsUsersEl = document.getElementById('autocontact-sps-users');
    if (autocontactSpsOpsEl) autocontactSpsOpsEl.textContent = formatNumber(autocontactSpsStats.uniqueOperations);
    if (autocontactSpsAiContactsEl) autocontactSpsAiContactsEl.textContent = formatNumber(autocontactSpsStats.aiContacts);
    if (autocontactSpsTotalEl) autocontactSpsTotalEl.textContent = formatNumber(autocontactSpsStats.totalContacts);
    if (autocontactSpsUsersEl) autocontactSpsUsersEl.textContent = formatNumber(autocontactSpsStats.uniqueUsers);

    // Comparateur stats
    comparateurCountEl.textContent = formatNumber(comparateurStats.totalComparisons);
    comparateurOpsEl.textContent = formatNumber(comparateurStats.uniqueOperations);
    comparateurPagesEl.textContent = formatNumber(comparateurStats.totalPages);
    comparateurUsersEl.textContent = comparateurStats.uniqueUsers;

    // Analyse géotechnique stats (quality-focused — no gain h/€)
    if (analyseGeoCountEl) analyseGeoCountEl.textContent = formatNumber(geotechStats.totalOperations);
    if (analyseGeoOpsEl) analyseGeoOpsEl.textContent = formatNumber(geotechStats.totalOperations);
    if (analyseGeoNoticesEl) analyseGeoNoticesEl.textContent = formatNumber(geotechStats.totalNotices);
    if (analyseGeoReportsEl) analyseGeoReportsEl.textContent = formatNumber(geotechStats.totalReports);
    if (analyseGeoUsersEl) analyseGeoUsersEl.textContent = formatNumber(geotechStats.uniqueUsers);

    // Analyse Acoustique tile
    if (analyseAcouCountEl) analyseAcouCountEl.textContent = formatNumber(acoustiqueStats.totalOperations);
    if (analyseAcouContractsEl) analyseAcouContractsEl.textContent = formatNumber(acoustiqueStats.uniqueContracts);
    if (analyseAcouUsersEl) analyseAcouUsersEl.textContent = formatNumber(acoustiqueStats.uniqueUsers);
    if (analyseAcouNoticesEl) analyseAcouNoticesEl.textContent = formatNumber(acoustiqueStats.totalNotices);
    if (analyseAcouReportsEl) analyseAcouReportsEl.textContent = formatNumber(acoustiqueStats.totalReports);

    // Analyse CCTP vs Référentiel tile
    if (analyseCctpCountEl) analyseCctpCountEl.textContent = formatNumber(cctpStats.totalOperations);
    if (analyseCctpContractsEl) analyseCctpContractsEl.textContent = formatNumber(cctpStats.uniqueContracts);
    if (analyseCctpAvisEl) analyseCctpAvisEl.textContent = formatNumber(cctpStats.totalAvis);
    if (analyseCctpUsersEl) analyseCctpUsersEl.textContent = formatNumber(cctpStats.uniqueUsers);

    // Analyse AO stats (funnel : captés → filtrés → analysés → opportunité)
    const aoStats = processAOData(aoMarches);
    if (analyseAoCaptesEl)   analyseAoCaptesEl.textContent   = formatNumber(aoStats.captes);
    if (analyseAoFiltresEl)  analyseAoFiltresEl.textContent  = formatNumber(aoStats.filtres);
    if (analyseAoAnalysesEl) analyseAoAnalysesEl.textContent = formatNumber(aoStats.analyses);
    if (analyseAoOppEl)      analyseAoOppEl.textContent      = formatNumber(aoStats.opportunites);
    
    // Expert BTP stats
    if (expertTechBTPCountEl) expertTechBTPCountEl.textContent = formatNumber(expertBTPStats.totalSessions);
    if (expertTechBTPUsersEl) expertTechBTPUsersEl.textContent = formatNumber(expertBTPStats.uniqueUsers);
    if (expertTechBTPMessagesEl) expertTechBTPMessagesEl.textContent = formatNumber(expertBTPStats.totalMessages);
    if (expertTechBTPCostEl) expertTechBTPCostEl.textContent = new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(expertBTPStats.totalCost);
    
    // Chat BTP stats
    if (chatProjetBTPCountEl) chatProjetBTPCountEl.textContent = formatNumber(chatBTPStats.totalSessions);
    if (chatProjetBTPUsersEl) chatProjetBTPUsersEl.textContent = formatNumber(chatBTPStats.uniqueUsers);
    if (chatProjetBTPMessagesEl) chatProjetBTPMessagesEl.textContent = formatNumber(chatBTPStats.totalMessages);
    if (chatProjetBTPCostEl) chatProjetBTPCostEl.textContent = new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(chatBTPStats.totalCost);
    
    // Expert Citae stats
    if (expertTechCitaeCountEl) expertTechCitaeCountEl.textContent = formatNumber(expertCitaeStats.totalSessions);
    if (expertTechCitaeUsersEl) expertTechCitaeUsersEl.textContent = formatNumber(expertCitaeStats.uniqueUsers);
    if (expertTechCitaeMessagesEl) expertTechCitaeMessagesEl.textContent = formatNumber(expertCitaeStats.totalMessages);
    if (expertTechCitaeCostEl) expertTechCitaeCostEl.textContent = new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(expertCitaeStats.totalCost);
    
    // Chat Citae stats
    if (chatProjetCitaeCountEl) chatProjetCitaeCountEl.textContent = formatNumber(chatCitaeStats.totalSessions);
    if (chatProjetCitaeUsersEl) chatProjetCitaeUsersEl.textContent = formatNumber(chatCitaeStats.uniqueUsers);
    if (chatProjetCitaeMessagesEl) chatProjetCitaeMessagesEl.textContent = formatNumber(chatCitaeStats.totalMessages);
    if (chatProjetCitaeCostEl) chatProjetCitaeCostEl.textContent = new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(chatCitaeStats.totalCost);

    // Expert BTP Diagnostics stats
    if (expertTechBTPDiagCountEl) expertTechBTPDiagCountEl.textContent = formatNumber(expertBTPDiagStats.totalSessions);
    if (expertTechBTPDiagUsersEl) expertTechBTPDiagUsersEl.textContent = formatNumber(expertBTPDiagStats.uniqueUsers);
    if (expertTechBTPDiagMessagesEl) expertTechBTPDiagMessagesEl.textContent = formatNumber(expertBTPDiagStats.totalMessages);
    if (expertTechBTPDiagCostEl) expertTechBTPDiagCostEl.textContent = new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(expertBTPDiagStats.totalCost);

    // Chat BTP Diagnostics stats
    if (chatProjetBTPDiagCountEl) chatProjetBTPDiagCountEl.textContent = formatNumber(chatBTPDiagStats.totalSessions);
    if (chatProjetBTPDiagUsersEl) chatProjetBTPDiagUsersEl.textContent = formatNumber(chatBTPDiagStats.uniqueUsers);
    if (chatProjetBTPDiagMessagesEl) chatProjetBTPDiagMessagesEl.textContent = formatNumber(chatBTPDiagStats.totalMessages);
    if (chatProjetBTPDiagCostEl) chatProjetBTPDiagCostEl.textContent = new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(chatBTPDiagStats.totalCost);

    // Expert BTP Consultants SPS stats
    if (expertTechSpsCountEl) expertTechSpsCountEl.textContent = formatNumber(expertBtpSpsStats.totalSessions);
    if (expertTechSpsUsersEl) expertTechSpsUsersEl.textContent = formatNumber(expertBtpSpsStats.uniqueUsers);
    if (expertTechSpsMessagesEl) expertTechSpsMessagesEl.textContent = formatNumber(expertBtpSpsStats.totalMessages);
    if (expertTechSpsCostEl) expertTechSpsCostEl.textContent = new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(expertBtpSpsStats.totalCost);

    // Chat BTP Consultants SPS stats
    if (chatProjetSpsCountEl) chatProjetSpsCountEl.textContent = formatNumber(chatBtpSpsStats.totalSessions);
    if (chatProjetSpsUsersEl) chatProjetSpsUsersEl.textContent = formatNumber(chatBtpSpsStats.uniqueUsers);
    if (chatProjetSpsMessagesEl) chatProjetSpsMessagesEl.textContent = formatNumber(chatBtpSpsStats.totalMessages);
    if (chatProjetSpsCostEl) chatProjetSpsCostEl.textContent = new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(chatBtpSpsStats.totalCost);

    // Calculate and display gains - USE SAME VALUES AS IN DETAIL PAGES
    // Descriptif page uses: totalOperations (unique operations)
    // Autocontact page uses: aiContacts (total AI contacts, not operations)
    // Comparateur page uses: totalPages
    // Chat and Expert pages use: totalMessages
    // NF Habitat uses: totalPoints
    // Gain total : on réutilise le moteur mensuel des jauges (attribution premier-mois,
    // pas de double comptage inter-mois) restreint à la fenêtre de date active, pour que
    // cette carte et les jauges « Objectifs de gain » concordent exactement.
    const gains = calculateWindowedGains();

    // Détail à 1 décimale → la somme des postes affichés colle à l'entête (pas de dérive d'arrondi).
    const fmt1 = (h) => (Math.round(h * 10) / 10).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const breakdown = [
        ['Descriptif',   gains.timeGainHoursDescriptif],
        ['Auto',         gains.timeGainHoursAutocontact],
        ['Comp',         gains.timeGainHoursComparateur],
        ['Chat BTP',     gains.timeGainHoursChatBTP],
        ['Expert BTP',   gains.timeGainHoursExpertBTP],
        ['Chat Citae',   gains.timeGainHoursChatCitae],
        ['Expert Citae', gains.timeGainHoursExpertCitae],
        ['Chat Diag',    gains.timeGainHoursChatBTPDiag],
        ['Expert Diag',  gains.timeGainHoursExpertBTPDiag],
        ['Chat SPS',     gains.timeGainHoursChatBtpSps],
        ['Expert SPS',   gains.timeGainHoursExpertBtpSps],
        ['Auto SPS',     gains.timeGainHoursAutocontactSps],
        ['NF Habitat',   gains.timeGainHoursNFHabitat],
        ['Analyse AO',   gains.timeGainHoursAO],
    ].map(([label, h]) => `${label}: ${fmt1(h)}h`).join(' + ');

    // Entête arrondi à l'entier, comme les jauges (formatNumber(Math.round(...))) → chiffres identiques.
    gainHeuresEl.textContent = formatNumber(gains.timeGainHours);
    gainSubtitleEl.innerHTML = `
        <div class="space-y-1">
            <div>Heures économisées (${breakdown})</div>
            <div class="text-xs">≈ ${gains.percentGain.toFixed(4)}% du volume d'affaires</div>
            <div class="text-xs">≈ ${formatNumber(gains.euroGain)} €</div>
        </div>
    `;
}

// ==================== AUTHENTICATION ====================

// Get login modal and form elements
const loginModal = document.getElementById('login-modal');
const loginForm = document.getElementById('login-form');
const passwordInput = document.getElementById('password-input');
const loginButton = document.getElementById('login-button');
const loginText = document.getElementById('login-text');
const loginError = document.getElementById('login-error');

// Check if user is already authenticated
async function checkAuthentication() {
    const storedPassword = localStorage.getItem('roi_password');
    
    if (storedPassword) {
        // Try to authenticate with stored password
        const success = await authenticateWithPassword(storedPassword);
        if (success) {
            loginModal.classList.add('hidden');
            await loadData();
            return;
        } else {
            // Stored password is invalid, remove it
            localStorage.removeItem('roi_password');
        }
    }
    
    // Show login modal
    loginModal.classList.remove('hidden');
    passwordInput.focus();
}

// Authenticate with webhook
async function authenticateWithPassword(password) {
    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: password
        });
        
        if (!response.ok) {
            return false;
        }
        
        const result = await response.text();
        
        // Parse the response to extract URLs (accepts both single and double quotes)
        const urlRegex = (name) => result.match(new RegExp(name + `\\s*=\\s*['"]([^'"]+)['"]`));
        const descriptifMatch  = urlRegex('DESCRIPTIF_URL');
        const autocontactMatch = urlRegex('AUTOCONTACT_URL');
        const comparateurMatch = urlRegex('COMPARATEUR_URL');
        const nfHabitatMatch   = urlRegex('NF_HABITAT_URL');
        const geotechMatch     = urlRegex('GEOTECH_URL');
        const aoMatch          = urlRegex('ANALYSE_AO_URL');
        const acoustiqueMatch  = urlRegex('ANALYSE_ACOUSTIQUE_URL');
        const cctpMatch        = urlRegex('ANALYSE_CCTP_URL');

        if (descriptifMatch && autocontactMatch && comparateurMatch) {
            DESCRIPTIF_URL = descriptifMatch[1];
            AUTOCONTACT_URL = autocontactMatch[1];
            COMPARATEUR_URL = comparateurMatch[1];
            if (nfHabitatMatch) NF_HABITAT_URL = nfHabitatMatch[1];
            if (geotechMatch) GEOTECH_URL = geotechMatch[1];
            if (aoMatch) AO_URL = aoMatch[1];
            if (acoustiqueMatch) ACOUSTIQUE_URL = acoustiqueMatch[1];
            if (cctpMatch) CCTP_URL = cctpMatch[1];
            const autocontactSpsMatch = urlRegex('AUTOCONTACT_SPS_URL');
            if (autocontactSpsMatch) AUTOCONTACT_SPS_URL = autocontactSpsMatch[1];

            // URLs signées chat/expert/population (remplacent les fallbacks publics)
            const expertBtpMatch     = urlRegex('EXPERT_BTP_URL');
            const chatBtpMatch       = urlRegex('CHAT_BTP_URL');
            const expertCitaeMatch   = urlRegex('EXPERT_CITAE_URL');
            const chatCitaeMatch     = urlRegex('CHAT_CITAE_URL');
            const expertBtpDiagMatch = urlRegex('EXPERT_BTPDIAG_URL');
            const chatBtpDiagMatch   = urlRegex('CHAT_BTPDIAG_URL');
            const expertBtpSpsMatch  = urlRegex('EXPERT_BTP_SPS_URL');
            const chatBtpSpsMatch    = urlRegex('CHAT_BTP_SPS_URL');
            const populationMatch    = urlRegex('POPULATION_CIBLE_URL');
            if (expertBtpMatch)     EXPERT_BTP_URL     = expertBtpMatch[1];
            if (chatBtpMatch)       CHAT_BTP_URL       = chatBtpMatch[1];
            if (expertCitaeMatch)   EXPERT_CITAE_URL   = expertCitaeMatch[1];
            if (chatCitaeMatch)     CHAT_CITAE_URL     = chatCitaeMatch[1];
            if (expertBtpDiagMatch) EXPERT_BTPDIAG_URL = expertBtpDiagMatch[1];
            if (chatBtpDiagMatch)   CHAT_BTPDIAG_URL   = chatBtpDiagMatch[1];
            if (expertBtpSpsMatch)  EXPERT_BTP_SPS_URL = expertBtpSpsMatch[1];
            if (chatBtpSpsMatch)    CHAT_BTP_SPS_URL   = chatBtpSpsMatch[1];
            if (populationMatch)    POPULATION_URL     = populationMatch[1];

            // Pas de cache de la réponse (roi_auth_result) : les URLs sont
            // SIGNÉES (validité 12h), un cache servirait des liens expirés.
            localStorage.removeItem('roi_auth_result');

            console.log('Authentication successful');
            return true;
        }

        return false;
    } catch (error) {
        console.error('Authentication error:', error);
        return false;
    }
}

// Handle login form submission
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const password = passwordInput.value;
    loginError.classList.add('hidden');
    loginButton.disabled = true;
    loginText.textContent = 'Connexion...';
    
    const success = await authenticateWithPassword(password);
    
    if (success) {
        // Store password in localStorage
        localStorage.setItem('roi_password', password);
        
        // Hide login modal
        loginModal.classList.add('hidden');
        
        // Load data
        await loadData();
    } else {
        // Show error
        loginError.classList.remove('hidden');
        loginButton.disabled = false;
        loginText.textContent = 'Se connecter';
        passwordInput.value = '';
        passwordInput.focus();
    }
});

// ==================== INITIALIZATION ====================

async function loadData() {
    try {
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');
        mainContentEl.classList.add('hidden');

        // 1. Load Population Data (Always available, public URL)
        console.log('Loading population data...');
        try {
            const popResponse = await fetch(POPULATION_URL);
            if (popResponse.ok) {
                const popCsv = await popResponse.text();
                parsePopulationData(popCsv);
            } else {
                console.warn('Failed to load population data:', popResponse.status);
            }
        } catch (e) {
            console.warn('Error loading population data:', e);
        }

        // 2. Load Main Data files
        console.log('Loading descriptif data...');
        const descriptifResponse = await fetch(DESCRIPTIF_URL);
        if (!descriptifResponse.ok) {
            throw new Error(`Erreur lors du chargement de descriptif.json: ${descriptifResponse.status}`);
        }
        const descriptifRaw = await descriptifResponse.text();
        
        let descriptifCSV = null;
        try {
            const descriptifJson = JSON.parse(descriptifRaw);
            if (Array.isArray(descriptifJson) && descriptifJson.length > 0 && descriptifJson[0].data) {
                // Legacy format: [{ data: "csv..." }]
                descriptifCSV = descriptifJson[0].data;
            } else if (Array.isArray(descriptifJson) && descriptifJson.length > 0) {
                // New direct JSON array format from Metabase
                console.log('Found direct JSON array format for descriptif');
                descriptifData = parseDescriptifJSON(descriptifJson);
                console.log('Loaded', descriptifData.length, 'descriptif records (JSON)');
                descriptifCSV = null;
            }
        } catch (e) {
            console.warn('Failed to parse descriptif JSON:', e);
        }

        if (descriptifCSV) {
            descriptifData = parseDescriptifCSV(descriptifCSV);
            console.log('Loaded', descriptifData.length, 'descriptif records (CSV)');
        }

        // Le dataset contient-il une colonne type renseignée ? (cf. isDescriptifRow)
        descriptifTypePresent = descriptifData.some(item => item.type && item.type.trim() !== '');

        console.log('Loading autocontact data...');
        const autocontactResponse = await fetch(AUTOCONTACT_URL);
        if (!autocontactResponse.ok) {
            throw new Error(`Erreur lors du chargement de autocontact.json: ${autocontactResponse.status}`);
        }
        const autocontactRaw = await autocontactResponse.text();
        
        let autocontactCSV = null;
        try {
            const autocontactJson = JSON.parse(autocontactRaw);
            if (Array.isArray(autocontactJson) && autocontactJson.length > 0 && autocontactJson[0].data) {
                // Legacy format: [{ data: "csv..." }]
                autocontactCSV = autocontactJson[0].data;
            } else if (Array.isArray(autocontactJson) && autocontactJson.length > 0) {
                // New direct JSON array format from Metabase
                console.log('Found direct JSON array format for autocontact');
                autocontactData = parseAutocontactJSON(autocontactJson);
                console.log('Loaded', autocontactData.length, 'autocontact records (JSON)');
                autocontactCSV = null;
            }
        } catch (e) {
            console.warn('Failed to parse autocontact JSON:', e);
        }

        if (autocontactCSV) {
            autocontactData = parseAutocontactCSV(autocontactCSV);
            console.log('Loaded', autocontactData.length, 'autocontact records (CSV)');
        }

        console.log('Loading comparateur data...');
        const comparateurResponse = await fetch(COMPARATEUR_URL);
        if (!comparateurResponse.ok) {
            throw new Error(`Erreur lors du chargement de comparateur.json: ${comparateurResponse.status}`);
        }
        const comparateurRaw = await comparateurResponse.text();
        
        let comparateurCSV = null;
        try {
            const comparateurJson = JSON.parse(comparateurRaw);
            if (Array.isArray(comparateurJson) && comparateurJson.length > 0 && comparateurJson[0].data) {
                comparateurCSV = comparateurJson[0].data;
            } else if (Array.isArray(comparateurJson) && comparateurJson.length > 0) {
                // New direct JSON array format
                console.log('Found direct JSON array format for comparateur');
                comparateurData = parseComparateurJSON(comparateurJson);
                console.log('Loaded', comparateurData.length, 'comparateur records');
                comparateurCSV = null; // already parsed
            }
        } catch (e) {
            console.warn('Failed to parse comparateur JSON:', e);
        }

        if (comparateurCSV) {
            comparateurData = parseComparateurCSV(comparateurCSV);
            console.log('Loaded', comparateurData.length, 'comparateur records');
        }

        // Load Analyse géotechnique data (optional — depends on n8n exposing GEOTECH_URL)
        if (GEOTECH_URL) {
            console.log('Loading geotech data...');
            try {
                const geotechResponse = await fetch(GEOTECH_URL);
                if (geotechResponse.ok) {
                    const geotechRaw = await geotechResponse.text();
                    let payload = null;
                    try { payload = JSON.parse(geotechRaw); } catch (_) { /* raw CSV fallthrough */ }

                    if (payload === null) {
                        // Raw CSV without JSON envelope
                        geotechData = parseGeotechCSV(geotechRaw);
                    } else if (Array.isArray(payload) && payload.length && payload[0].data && typeof payload[0].data === 'string') {
                        // n8n envelope: [{ data: "<csv-or-json>" }]
                        const inner = payload[0].data;
                        let innerJson = null;
                        try { innerJson = JSON.parse(inner); } catch (_) { /* CSV */ }
                        geotechData = Array.isArray(innerJson) ? parseGeotechJSON(innerJson) : parseGeotechCSV(inner);
                    } else if (payload && payload.data && typeof payload.data === 'string') {
                        // { data: "<csv-or-json>" }
                        const inner = payload.data;
                        let innerJson = null;
                        try { innerJson = JSON.parse(inner); } catch (_) {}
                        geotechData = Array.isArray(innerJson) ? parseGeotechJSON(innerJson) : parseGeotechCSV(inner);
                    } else if (Array.isArray(payload)) {
                        // Direct JSON array
                        geotechData = parseGeotechJSON(payload);
                    }
                    console.log('Loaded', geotechData.length, 'geotech events');
                } else {
                    console.warn('Geotech URL responded with status', geotechResponse.status);
                }
            } catch (e) {
                console.warn('Failed to load geotech data:', e);
            }
        } else {
            console.log('No GEOTECH_URL configured — analyse géotechnique tile will show 0.');
        }

        // Load Analyse acoustique data (optional — depends on n8n exposing ANALYSE_ACOUSTIQUE_URL)
        if (ACOUSTIQUE_URL) {
            console.log('Loading acoustique data...');
            try {
                const acoustiqueResponse = await fetch(ACOUSTIQUE_URL);
                if (acoustiqueResponse.ok) {
                    const acoustiqueRaw = await acoustiqueResponse.text();
                    let payload = null;
                    try { payload = JSON.parse(acoustiqueRaw); } catch (_) { /* raw CSV fallthrough */ }

                    if (payload === null) {
                        // Raw CSV without JSON envelope
                        acoustiqueData = parseAcoustiqueCSV(acoustiqueRaw);
                    } else if (Array.isArray(payload) && payload.length && payload[0].data && typeof payload[0].data === 'string') {
                        // n8n envelope: [{ data: "<csv-or-json>" }]
                        const inner = payload[0].data;
                        let innerJson = null;
                        try { innerJson = JSON.parse(inner); } catch (_) { /* CSV */ }
                        acoustiqueData = Array.isArray(innerJson) ? parseAcoustiqueJSON(innerJson) : parseAcoustiqueCSV(inner);
                    } else if (payload && payload.data && typeof payload.data === 'string') {
                        // { data: "<csv-or-json>" }
                        const inner = payload.data;
                        let innerJson = null;
                        try { innerJson = JSON.parse(inner); } catch (_) {}
                        acoustiqueData = Array.isArray(innerJson) ? parseAcoustiqueJSON(innerJson) : parseAcoustiqueCSV(inner);
                    } else if (Array.isArray(payload)) {
                        // Direct JSON array
                        acoustiqueData = parseAcoustiqueJSON(payload);
                    }
                    console.log('Loaded', acoustiqueData.length, 'acoustique events');
                } else {
                    console.warn('Acoustique URL responded with status', acoustiqueResponse.status);
                }
            } catch (e) {
                console.warn('Failed to load acoustique data:', e);
            }
        } else {
            console.log('No ANALYSE_ACOUSTIQUE_URL configured — analyse acoustique tile will show 0.');
        }

        // Load Analyse CCTP vs Référentiel data (optional — depends on n8n exposing ANALYSE_CCTP_URL)
        if (CCTP_URL) {
            try {
                const cctpResponse = await fetch(CCTP_URL);
                if (cctpResponse.ok) {
                    cctpData = KPI.parseCctpPayload(await cctpResponse.text());
                    console.log('Loaded', cctpData.length, 'CCTP deliverables');
                } else {
                    console.warn('CCTP URL responded with status', cctpResponse.status);
                }
            } catch (e) {
                console.warn('Failed to load CCTP data:', e);
            }
        } else {
            console.log('No ANALYSE_CCTP_URL configured — analyse CCTP tile will show 0.');
        }

        // Load Analyse AO data (optional — depends on n8n exposing ANALYSE_AO_URL)
        if (AO_URL) {
            console.log('Loading AO data from:', AO_URL);
            try {
                const aoResponse = await fetch(AO_URL);
                if (aoResponse.ok) {
                    const aoRaw = await aoResponse.text();
                    let payload = null;
                    try { payload = JSON.parse(aoRaw); } catch (_) {}

                    // n8n envelope variants:
                    //   [{ data: "json-string" }]      → ancien format n8n
                    //   [{ data: [...], count: N }]    → n8n upload direct sans unwrap (cas actuel)
                    //   { data: "json-string" }        → flatten single
                    //   { count, data: [...] }         → format API SF natif
                    if (Array.isArray(payload) && payload.length && payload[0] && typeof payload[0] === 'object') {
                        const first = payload[0];
                        if (typeof first.data === 'string') {
                            try { payload = JSON.parse(first.data); } catch (_) {}
                        } else if (first.data !== undefined) {
                            payload = first;
                        }
                    } else if (payload && typeof payload.data === 'string') {
                        try { payload = JSON.parse(payload.data); } catch (_) {}
                    }

                    aoMarches = parseAOPayload(payload);
                    console.log('Loaded', aoMarches.length, 'AO marchés');
                } else {
                    console.warn('AO URL responded with status', aoResponse.status);
                }
            } catch (e) {
                console.warn('Failed to load AO data:', e);
            }
        } else {
            console.log('No ANALYSE_AO_URL configured — analyse AO tile will show 0.');
        }

        // Load Expert BTP Consultants data
        console.log('Loading Expert BTP Consultants data...');
        try {
            const expertBTPResponse = await fetch(EXPERT_BTP_URL);
            if (expertBTPResponse.ok) {
                const expertBTPJson = await expertBTPResponse.json();
                // Transform JSON data to our format
                expertBTPData = expertBTPJson.map(item => {
                    const metadata = item.metadata || {};
                    const productionService = metadata.productionService || '';
                    const management = metadata.management || '';
                    
                    return {
                        id: item.id,
                        title: item.title || '',
                        email: KPI.chatEmail(item),
                        createdAt: item.createdAt || '',
                        updatedAt: item.updatedAt || '',
                        messagesLength: item.messagesLength || item._count?.messages || 0,
                        totalCostInDollars: item.totalCostInDollars || 0,
                        agency: productionService,
                        agencyCode: productionService,
                        direction: management || (agencyToDirection[productionService] || ''),
                        metadata: metadata
                    };
                });
                
                // Update directions based on agencyToDirection mapping
                expertBTPData.forEach(item => {
                    if (!item.direction && item.agencyCode && agencyToDirection[item.agencyCode]) {
                        item.direction = agencyToDirection[item.agencyCode];
                    }
                });
                
                console.log('Loaded', expertBTPData.length, 'Expert BTP Consultants records');
            } else {
                console.warn('Failed to load Expert BTP Consultants data:', expertBTPResponse.status);
            }
        } catch (e) {
            console.warn('Error loading Expert BTP Consultants data:', e);
        }

        // Load Chat BTP Consultants data
        console.log('Loading Chat BTP Consultants data...');
        try {
            const chatBTPResponse = await fetch(CHAT_BTP_URL);
            if (chatBTPResponse.ok) {
                const chatBTPJson = await chatBTPResponse.json();
                // Transform JSON data to our format
                chatBTPData = chatBTPJson.map(item => {
                    const metadata = item.metadata || {};
                    const productionService = metadata.productionService || '';
                    let management = metadata.management || '';
                    
                    // Fix encoding for management field
                    if (management) {
                        management = fixEncoding(management);
                    }
                    
                    return {
                        id: item.id,
                        title: item.title || '',
                        email: KPI.chatEmail(item),
                        createdAt: item.createdAt || '',
                        updatedAt: item.updatedAt || '',
                        messagesLength: item.messagesLength || item._count?.messages || 0,
                        totalCostInDollars: item.totalCostInDollars || 0,
                        agency: productionService,
                        agencyCode: productionService,
                        direction: management || (agencyToDirection[productionService] || ''),
                        metadata: metadata
                    };
                });
                
                // Update directions based on agencyToDirection mapping
                chatBTPData.forEach(item => {
                    if (!item.direction && item.agencyCode && agencyToDirection[item.agencyCode]) {
                        item.direction = fixEncoding(agencyToDirection[item.agencyCode]);
                    }
                });
                
                console.log('Loaded', chatBTPData.length, 'Chat BTP Consultants records');
            } else {
                console.warn('Failed to load Chat BTP Consultants data:', chatBTPResponse.status);
            }
        } catch (e) {
            console.warn('Error loading Chat BTP Consultants data:', e);
        }

        // Load Expert Citae data
        console.log('Loading Expert Citae data...');
        try {
            const expertCitaeResponse = await fetch(EXPERT_CITAE_URL);
            if (expertCitaeResponse.ok) {
                const expertCitaeJson = await expertCitaeResponse.json();
                // Transform JSON data to our format
                expertCitaeData = expertCitaeJson.map(item => {
                    const metadata = item.metadata || {};
                    const productionService = metadata.productionService || '';
                    let management = metadata.management || '';
                    
                    return {
                        id: item.id,
                        title: item.title || '',
                        email: KPI.chatEmail(item),
                        createdAt: item.createdAt || '',
                        updatedAt: item.updatedAt || '',
                        messagesLength: item.messagesLength || item._count?.messages || 0,
                        totalCostInDollars: item.totalCostInDollars || 0,
                        agency: productionService || 'Non spécifié',
                        agencyCode: productionService || '',
                        direction: management || '',
                        metadata: metadata
                    };
                });
                
                console.log('Loaded', expertCitaeData.length, 'Expert Citae records');
            } else {
                console.warn('Failed to load Expert Citae data:', expertCitaeResponse.status);
            }
        } catch (e) {
            console.warn('Error loading Expert Citae data:', e);
        }

        // Load Chat Citae data
        console.log('Loading Chat Citae data...');
        try {
            const chatCitaeResponse = await fetch(CHAT_CITAE_URL);
            if (chatCitaeResponse.ok) {
                const chatCitaeJson = await chatCitaeResponse.json();
                // Transform JSON data to our format
                chatCitaeData = chatCitaeJson.map(item => {
                    const metadata = item.metadata || {};
                    const productionService = metadata.productionService || '';
                    let management = metadata.management || '';
                    
                    return {
                        id: item.id,
                        title: item.title || '',
                        email: KPI.chatEmail(item),
                        createdAt: item.createdAt || '',
                        updatedAt: item.updatedAt || '',
                        messagesLength: item.messagesLength || item._count?.messages || 0,
                        totalCostInDollars: item.totalCostInDollars || 0,
                        agency: productionService || 'Non spécifié',
                        agencyCode: productionService || '',
                        direction: management || '',
                        metadata: metadata
                    };
                });
                
                console.log('Loaded', chatCitaeData.length, 'Chat Citae records');
            } else {
                console.warn('Failed to load Chat Citae data:', chatCitaeResponse.status);
            }
        } catch (e) {
            console.warn('Error loading Chat Citae data:', e);
        }

        // Load Expert BTP Diagnostics data
        console.log('Loading Expert BTP Diagnostics data...');
        try {
            const expertBTPDiagResponse = await fetch(EXPERT_BTPDIAG_URL);
            if (expertBTPDiagResponse.ok) {
                const expertBTPDiagJson = await expertBTPDiagResponse.json();
                expertBTPDiagData = expertBTPDiagJson
                    .filter(item => (item.email || '').includes('@btp-diagnostics.fr'))
                    .map(item => {
                        const metadata = item.metadata || {};
                        const productionService = metadata.productionService || '';
                        const management = metadata.management || '';
                        return {
                            id: item.id,
                            title: item.title || '',
                            email: KPI.chatEmail(item),
                            createdAt: item.createdAt || '',
                            updatedAt: item.updatedAt || '',
                            messagesLength: item.messagesLength || item._count?.messages || 0,
                            totalCostInDollars: item.totalCostInDollars || 0,
                            agency: productionService || 'Non spécifié',
                            agencyCode: productionService || '',
                            direction: management || '',
                            metadata: metadata
                        };
                    });
                console.log('Loaded', expertBTPDiagData.length, 'Expert BTP Diagnostics records');
            } else {
                console.warn('Failed to load Expert BTP Diagnostics data:', expertBTPDiagResponse.status);
            }
        } catch (e) {
            console.warn('Error loading Expert BTP Diagnostics data:', e);
        }

        // Load Chat BTP Diagnostics data
        console.log('Loading Chat BTP Diagnostics data...');
        try {
            const chatBTPDiagResponse = await fetch(CHAT_BTPDIAG_URL);
            if (chatBTPDiagResponse.ok) {
                const chatBTPDiagJson = await chatBTPDiagResponse.json();
                chatBTPDiagData = chatBTPDiagJson
                    .filter(item => (item.email || '').includes('@btp-diagnostics.fr'))
                    .map(item => {
                        const metadata = item.metadata || {};
                        const productionService = metadata.productionService || '';
                        const management = metadata.management || '';
                        return {
                            id: item.id,
                            title: item.title || '',
                            email: KPI.chatEmail(item),
                            createdAt: item.createdAt || '',
                            updatedAt: item.updatedAt || '',
                            messagesLength: item.messagesLength || item._count?.messages || 0,
                            totalCostInDollars: item.totalCostInDollars || 0,
                            agency: productionService || 'Non spécifié',
                            agencyCode: productionService || '',
                            direction: management || '',
                            metadata: metadata
                        };
                    });
                console.log('Loaded', chatBTPDiagData.length, 'Chat BTP Diagnostics records');
            } else {
                console.warn('Failed to load Chat BTP Diagnostics data:', chatBTPDiagResponse.status);
            }
        } catch (e) {
            console.warn('Error loading Chat BTP Diagnostics data:', e);
        }

        // Load Expert BTP Consultants SPS data — BU distincte, marquée bu:'SPS'
        console.log('Loading Expert BTP Consultants SPS data...');
        try {
            const expertBtpSpsResponse = await fetch(EXPERT_BTP_SPS_URL);
            if (expertBtpSpsResponse.ok) {
                const expertBtpSpsJson = await expertBtpSpsResponse.json();
                expertBtpSpsData = expertBtpSpsJson.map(item => {
                    const metadata = item.metadata || {};
                    const productionService = metadata.productionService || '';
                    const management = metadata.management || '';
                    return {
                        id: item.id,
                        title: item.title || '',
                        email: KPI.chatEmail(item),
                        createdAt: item.createdAt || '',
                        updatedAt: item.updatedAt || '',
                        messagesLength: item.messagesLength || item._count?.messages || 0,
                        totalCostInDollars: item.totalCostInDollars || 0,
                        agency: productionService || 'Non spécifié',
                        agencyCode: productionService || '',
                        direction: management || '',
                        bu: 'SPS',
                        metadata: metadata
                    };
                });
                console.log('Loaded', expertBtpSpsData.length, 'Expert BTP Consultants SPS records');
            } else {
                console.warn('Failed to load Expert BTP Consultants SPS data:', expertBtpSpsResponse.status);
            }
        } catch (e) {
            console.warn('Error loading Expert BTP Consultants SPS data:', e);
        }

        // Load Chat BTP Consultants SPS data
        console.log('Loading Chat BTP Consultants SPS data...');
        try {
            const chatBtpSpsResponse = await fetch(CHAT_BTP_SPS_URL);
            if (chatBtpSpsResponse.ok) {
                const chatBtpSpsJson = await chatBtpSpsResponse.json();
                chatBtpSpsData = chatBtpSpsJson.map(item => {
                    const metadata = item.metadata || {};
                    const productionService = metadata.productionService || '';
                    const management = metadata.management || '';
                    return {
                        id: item.id,
                        title: item.title || '',
                        email: KPI.chatEmail(item),
                        createdAt: item.createdAt || '',
                        updatedAt: item.updatedAt || '',
                        messagesLength: item.messagesLength || item._count?.messages || 0,
                        totalCostInDollars: item.totalCostInDollars || 0,
                        agency: productionService || 'Non spécifié',
                        agencyCode: productionService || '',
                        direction: management || '',
                        bu: 'SPS',
                        metadata: metadata
                    };
                });
                console.log('Loaded', chatBtpSpsData.length, 'Chat BTP Consultants SPS records');
            } else {
                console.warn('Failed to load Chat BTP Consultants SPS data:', chatBtpSpsResponse.status);
            }
        } catch (e) {
            console.warn('Error loading Chat BTP Consultants SPS data:', e);
        }

        // Load Autocontact SPS data — backoffice BTP Force, application des SPS :
        // toutes les lignes sont SPS (bu:'SPS'), aucun filtre d'email à appliquer.
        if (AUTOCONTACT_SPS_URL) {
            console.log('Loading Autocontact SPS data...');
            try {
                const autocontactSpsResponse = await fetch(AUTOCONTACT_SPS_URL);
                if (autocontactSpsResponse.ok) {
                    const json = await autocontactSpsResponse.json();
                    const items = Array.isArray(json) ? json
                        : (Array.isArray(json?.items) ? json.items : []);
                    autocontactSpsData = items.map(item => ({
                        email: (item.userEmail || '').toLowerCase().trim(),
                        createdAt: item.createdAt || '',
                        fromAI: (item.sourceType || '').toUpperCase() === 'IA',
                        // contractNumber : même nom que côté Autocontact CT, pour que
                        // "une utilisation" veuille dire la même chose dans les deux briques.
                        contractNumber: item.affairNumber || '',
                        agency: item.agencyName || '',
                        direction: item.direction || '',
                        deliverableId: item.deliverableId || '',
                        bu: 'SPS'
                    }));
                    console.log('Loaded', autocontactSpsData.length, 'Autocontact SPS records');
                } else {
                    console.warn('Failed to load Autocontact SPS data:', autocontactSpsResponse.status);
                }
            } catch (e) {
                console.warn('Error loading Autocontact SPS data:', e);
            }
        } else {
            console.warn('AUTOCONTACT_SPS_URL not set — skipping Autocontact SPS data');
        }

        // Load NF Habitat data
        if (NF_HABITAT_URL) {
            console.log('Loading NF Habitat data...');
            try {
                const nfHabitatResponse = await fetch(NF_HABITAT_URL);
                if (nfHabitatResponse.ok) {
                    const nfHabitatJson = await nfHabitatResponse.json();
                    // Handle all wrapper formats:
                    // [{items:[...]}]  ← format réel de l'API
                    // {items:[...]}    ← sans tableau externe
                    // [...]            ← tableau direct
                    let items;
                    if (Array.isArray(nfHabitatJson) && nfHabitatJson.length > 0 && Array.isArray(nfHabitatJson[0].items)) {
                        items = nfHabitatJson[0].items;
                    } else if (!Array.isArray(nfHabitatJson) && Array.isArray(nfHabitatJson.items)) {
                        items = nfHabitatJson.items;
                    } else if (Array.isArray(nfHabitatJson)) {
                        items = nfHabitatJson;
                    } else {
                        items = [];
                    }
                    nfHabitatData = items.map(item => {
                        const email = (item.user && item.user.email) ? item.user.email : (item.email || '');
                        return {
                            id: item.id,
                            createdAt: item.createdAt || '',
                            status: item.status || '',
                            projectId: item.projectId || '',
                            projectName: item.projectName || '',
                            totalCost: item.totalCost || 0,
                            pointCount: item.pointCount || 0,
                            controlName: item.controlName || '',
                            email: email,        // used by getFilteredData filiale filter
                            userEmail: email,
                            userName: (item.user && item.user.name) ? item.user.name : (item.userName || ''),
                            direction: '',       // NF Habitat has no direction
                            agency: ''           // NF Habitat has no agency
                        };
                    });
                    console.log('Loaded', nfHabitatData.length, 'NF Habitat records');
                } else {
                    console.warn('Failed to load NF Habitat data:', nfHabitatResponse.status);
                }
            } catch (e) {
                console.warn('Error loading NF Habitat data:', e);
            }
        } else {
            console.warn('NF_HABITAT_URL not set — skipping NF Habitat data');
        }

        // Initialize filters and table
        extractDirectionsAndAgencies();
        populateFilters();
        populateGaugeSelectors();

        // Update Dashboard (KPIs + Table)
        updateDashboard();

        // Initialize feature cards after data is loaded
        initializeFeatureCards();

        // Instantané des gains pour la page « Pilotage économique »
        publishGainsSnapshot();
        // Instantané adoption / systématisation pour la page « COPIL IA »
        publishCopilSnapshot();

        // Show main content
        loadingEl.classList.add('hidden');
        mainContentEl.classList.remove('hidden');
    } catch (error) {
        console.error('Error loading data:', error);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }
}

// ==================== FILIALE FILTERING ====================

// Map each feature card to its filiale
const featureCards = [
    { id: 'descriptif', filiale: 'BTP Consultants', element: null },
    { id: 'autocontact', filiale: 'BTP Consultants', element: null },
    { id: 'comparateur', filiale: 'BTP Consultants', element: null },
    { id: 'chat-projet-btp', filiale: 'BTP Consultants', element: null },
    { id: 'expert-tech-btp', filiale: 'BTP Consultants', element: null },
    { id: 'analyse-geo', filiale: 'BTP Consultants', element: null },
    { id: 'analyse-acou', filiale: 'BTP Consultants', element: null },
    { id: 'analyse-cctp', filiale: 'BTP Consultants', element: null },
    { id: 'chat-projet-citae', filiale: 'Citae', element: null },
    { id: 'expert-tech-citae', filiale: 'Citae', element: null },
    { id: 'nf-habitat', filiale: 'Citae', element: null },
    { id: 'chat-projet-btpdiag', filiale: 'BTP Diagnostics', element: null },
    { id: 'expert-tech-btpdiag', filiale: 'BTP Diagnostics', element: null },
    { id: 'chat-projet-sps', filiale: 'BTP Consultants SPS', element: null },
    { id: 'expert-tech-sps', filiale: 'BTP Consultants SPS', element: null },
    { id: 'autocontact-sps', filiale: 'BTP Consultants SPS', element: null }
];

/**
 * Initialize feature card elements
 */
function initializeFeatureCards() {
    featureCards.forEach(card => {
        // Find the card element by looking for the count element's parent.
        // Les tuiles Auto Contacts (CT et SPS) affichent des « utilisations » :
        // leur grand chiffre porte l'id `-ops`, sans quoi la carte n'était
        // rattachée à rien et échappait au filtre filiale.
        const countEl = document.getElementById(`${card.id}-count`)
            || document.getElementById(`${card.id}-ops`);
        if (countEl) {
            // Go up to the card container (2 or 3 levels up depending on structure)
            let parent = countEl;
            while (parent && !parent.classList.contains('bg-white')) {
                parent = parent.parentElement;
            }
            card.element = parent;
        }
    });
}

/**
 * Update Dashboard
 */
function updateDashboard() {
    // Update KPIs (calls process...Data which uses getFilteredData)
    updateKPIs();

    // Update objective gauges (always current month/year, ignores date filter)
    updateObjectiveGauges();

    // Update Agency Table
    updateAgencyTable();
    
    // Update specific cards (Chat Projet, etc.) based on Filiale filter only?
    // Or should they respect all filters?
    // The previous implementation only filtered by Filiale.
    // Let's keep filtering by Filiale for these specific cards as they seem tied to specific entities (Citae/BTP)
    
    const filiale = filialeFilterEl.value;
    featureCards.forEach(card => {
        if (!card.element) return;
        
        if (!filiale || filiale === '' || card.filiale === filiale) {
            card.element.style.display = '';
        } else {
            card.element.style.display = 'none';
        }
    });
}

/**
 * Update reset button visibility
 */
function updateResetButtonVisibility() {
    const hasFilters = filialeFilterEl.value !== '' || directionFilterEl.value !== '' || agencyFilterEl.value !== '' || 
                       startDateEl.value !== '' || endDateEl.value !== '';
    if (hasFilters) {
        resetFiltersBtn.classList.remove('hidden');
    } else {
        resetFiltersBtn.classList.add('hidden');
    }
}

// Event listeners
filialeFilterEl.addEventListener('change', () => {
    updateDashboard();
    updateResetButtonVisibility();
});

directionFilterEl.addEventListener('change', () => {
    populateAgencyFilter();
    updateDashboard();
    updateResetButtonVisibility();
});

agencyFilterEl.addEventListener('change', () => {
    updateDashboard();
    updateResetButtonVisibility();
});

resetFiltersBtn.addEventListener('click', () => {
    filialeFilterEl.value = '';
    directionFilterEl.value = '';
    populateAgencyFilter(); // Reset agencies
    agencyFilterEl.value = '';
    startDateEl.value = '';
    endDateEl.value = '';
    dateFilter.startDate = null;
    dateFilter.endDate = null;
    
    updateDashboard();
    updateResetButtonVisibility();
});

// Apply date filter button
applyDateFilterBtn.addEventListener('click', () => {
    dateFilter.startDate = startDateEl.value || null;
    dateFilter.endDate = endDateEl.value || null;
    
    console.log('Applying date filter:', dateFilter);
    
    updateDashboard();
    updateResetButtonVisibility();
});

// ==================== GAIN EVOLUTION MODAL ====================

// ==================== USERS LIST MODAL ====================

/**
 * Catalogue des modules IA suivis par utilisateur (popup « Utilisateurs
 * actifs » et note d'adoption). Ajouter un module = ajouter UNE entrée ici :
 * il apparaît dans la popup, entre dans le périmètre de sa filiale et prend
 * un poids d'exposition calculé depuis son premier usage observé (ou depuis
 * `lancement`, à renseigner si les données contiennent des essais antérieurs
 * au vrai lancement).
 *
 * events() renvoie les lignes d'usage réel, toutes périodes confondues
 * ({ email, createdAt }) : une ligne = une session. Le filtre de dates est
 * appliqué ensuite par collectActiveUsers.
 * Mêmes règles d'usage réel que le COPIL (publishCopilSnapshot).
 */
const ADOPTION_FILIALES = {
    CT:    { label: 'BTP Consultants',     domain: '@btp-consultants.fr' },
    SPS:   { label: 'BTP Consultants SPS', domain: null }, // isolée par la source, pas par le domaine
    CITAE: { label: 'Citae',               domain: '@citae.fr' },
    DIAG:  { label: 'BTP Diagnostics',     domain: '@btp-diagnostics.fr' },
};

function adoptionModules() {
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
        : countWords(extractText(item.description || ''));
    const { CT, SPS, CITAE, DIAG } = ADOPTION_FILIALES;

    return [
        // BTP Consultants (contrôle technique)
        // Descriptif : au-delà de 100 mots l'IA apporte une valeur réelle (seuil COPIL).
        { id: 'descriptif', label: 'Descriptif', filiale: CT,
          events: () => descriptifData.filter(i => notYield(i) && isDescriptifRow(i) && wordCount(i) >= 100) },
        { id: 'autocontact', label: 'Auto-contact', filiale: CT,
          events: () => autocontactData.filter(i => notYield(i) && i.fromAI) },
        { id: 'comparateur', label: 'Comparateur', filiale: CT,
          events: () => comparateurData },
        // Géotech / Acoustique / CCTP : l'email est celui du chargé d'affaires.
        { id: 'analyse-geo', label: 'Géotechnique', filiale: CT,
          events: () => uniqueDeliverables(geotechData) },
        { id: 'analyse-acou', label: 'Acoustique', filiale: CT,
          events: () => uniqueDeliverables(acoustiqueData) },
        { id: 'analyse-cctp', label: 'CCTP', filiale: CT,
          events: () => uniqueDeliverables(cctpData).filter(i => i.status !== 'ERROR') },
        { id: 'expert-ct', label: 'Expert', filiale: CT, events: () => expertBTPData },
        { id: 'chat-ct', label: 'Chat', filiale: CT, events: () => chatBTPData },

        // BTP Consultants SPS
        { id: 'autocontact-sps', label: 'Auto-contact', filiale: SPS,
          events: () => autocontactSpsData.filter(i => i.fromAI) },
        { id: 'expert-sps', label: 'Expert', filiale: SPS, events: () => expertBtpSpsData },
        { id: 'chat-sps', label: 'Chat', filiale: SPS, events: () => chatBtpSpsData },

        // Citae
        { id: 'nf-habitat', label: 'NF Habitat', filiale: CITAE,
          events: () => nfHabitatData.filter(isNFHabitatItem) },
        { id: 'expert-citae', label: 'Expert', filiale: CITAE, events: () => expertCitaeData },
        { id: 'chat-citae', label: 'Chat', filiale: CITAE, events: () => chatCitaeData },

        // BTP Diagnostics
        { id: 'expert-diag', label: 'Expert', filiale: DIAG, events: () => expertBTPDiagData },
        { id: 'chat-diag', label: 'Chat', filiale: DIAG, events: () => chatBTPDiagData },
    ];
}

/**
 * Utilisateurs actifs, une ligne par couple (email, filiale) : chacun est noté
 * sur le périmètre de modules de SA filiale (cf. KPI.adoptionScore).
 * Respecte le filtre de dates.
 * Agence de rattachement : agence majoritaire de ses sessions, toutes périodes
 * confondues (code de l'affaire, ou service de production pour les chats) —
 * elle ne bouge pas avec le filtre de dates.
 * Returns { refDate, modules, users: [{email, filiale, agency, features: Set,
 *           sessions, lastActivity, adoption}] }
 */
function collectActiveUsers() {
    const modules = adoptionModules().map(m => {
        const domain = m.filiale.domain;
        const events = [];
        m.events().forEach(item => {
            const email = (item.email || '').toLowerCase().trim();
            if (!email || (domain && !email.includes(domain))) return;
            const date = parseFrenchDate(item.createdAt);
            if (!date) return;
            const agency = (item.agencyCode || extractAgency(item.contractNumber) || item.agency || '').trim().toUpperCase();
            events.push({ email, date, agency: agency === 'NON SPÉCIFIÉ' ? '' : agency });
        });
        // Lancement : premier usage observé, toutes périodes confondues.
        const launch = m.lancement || events.reduce((min, e) => (!min || e.date < min ? e.date : min), null);
        return { id: m.id, label: m.label, filiale: m.filiale.label, events, launch };
    });

    const start = dateFilter.startDate ? new Date(dateFilter.startDate) : null;
    if (start) start.setHours(0, 0, 0, 0);
    const end = dateFilter.endDate ? new Date(dateFilter.endDate) : null;
    if (end) end.setHours(23, 59, 59, 999);
    const inRange = d => (!start || d >= start) && (!end || d <= end);

    // Date de référence : fin du filtre, plafonnée au dernier usage observé
    // (jamais « aujourd'hui » — mêmes données, même note).
    let refDate = null;
    modules.forEach(m => m.events.forEach(e => { if (!refDate || e.date > refDate) refDate = e.date; }));
    if (end && refDate && end < refDate) refDate = end;

    // Somme des poids d'exposition des modules de chaque filiale.
    const exposure = {};
    modules.forEach(m => {
        exposure[m.filiale] = (exposure[m.filiale] || 0) + KPI.exposureWeight(m.launch, refDate);
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
            usersMap.set(key, { email: e.email, filiale: m.filiale, agency: KPI.mode(agencies[key]) || '',
                                features: new Set(), moduleIds: new Set(),
                                sessions: 0, weeks: new Set(), firstActivity: null, lastActivity: null });
        }
        const u = usersMap.get(key);
        u.features.add(m.label);
        u.moduleIds.add(m.id);
        u.sessions += 1;
        u.weeks.add(KPI.weekIndex(e.date));
        if (!u.firstActivity || e.date < u.firstActivity) u.firstActivity = e.date;
        if (!u.lastActivity || e.date > u.lastActivity) u.lastActivity = e.date;
    }));

    const users = Array.from(usersMap.values());
    users.forEach(u => {
        u.adoption = KPI.adoptionScore({
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

const FILIALE_BADGE = {
    'BTP Consultants':    'bg-blue-100 text-blue-800',
    'Citae':              'bg-green-100 text-green-800',
    'BTP Diagnostics':    'bg-orange-100 text-orange-800',
    'BTP Consultants SPS': 'bg-cyan-100 text-cyan-800',
    'Autre':              'bg-gray-100 text-gray-600',
};

let activeUsersCache = null;
let currentUsersTab = 'population'; // 'population' | 'active'

function renderPopulationTab() {
    const tbody = document.getElementById('population-table-body');
    if (!tbody) return;

    const rows = populationRows.slice().sort((a, b) => a.dr.localeCompare(b.dr) || a.agencyCode.localeCompare(b.agencyCode));
    const total = rows.reduce((s, r) => s + r.effectif, 0);

    document.getElementById('pop-total-effectif').textContent = total;
    document.getElementById('tab-population-count').textContent = rows.length + ' agences';

    // Group by DR for alternating section colours
    let lastDr = null;
    let drColor = false;
    tbody.innerHTML = rows.map(r => {
        if (r.dr !== lastDr) { lastDr = r.dr; drColor = !drColor; }
        const bg = drColor ? '' : 'bg-gray-50/40';
        return `<tr class="${bg} hover:bg-indigo-50/30 transition-colors">
            <td class="px-4 py-2.5 text-gray-700">${r.dr}</td>
            <td class="px-4 py-2.5 font-mono font-medium text-indigo-700">${r.agencyCode}</td>
            <td class="px-4 py-2.5 text-right font-semibold text-gray-800">${r.effectif}</td>
        </tr>`;
    }).join('');
}

const ADOPTION_BADGE = {
    'Adopté':      'bg-emerald-100 text-emerald-800',
    'Régulier':    'bg-indigo-100 text-indigo-800',
    'Occasionnel': 'bg-amber-100 text-amber-800',
    'Découverte':  'bg-gray-100 text-gray-600',
};

let usersSortByAdoption = false;

const fmtScorePart = v => v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Méthode de calcul, construite depuis KPI.ADOPTION : le texte suit les
// constantes si on les ajuste.
function adoptionMethodHtml() {
    const A = KPI.ADOPTION, W = A.weights;
    const esc = KPI.escapeHtml;
    const fmtDate = d => d ? new Intl.DateTimeFormat('fr-FR').format(d) : '—';
    const { refDate, modules } = activeUsersCache;
    const fresh = A.freshness.map(([days, part]) => `≤ ${days} j : ${Math.round(part * W.freshness)}`).join(' · ');
    const levels = A.levels.map(([min, label], i) => {
        const prev = A.levels[i - 1];
        return prev ? `${min}–${prev[0] - 1} ${label}` : `${min}+ ${label}`;
    }).join(' · ');

    const byFiliale = {};
    modules.forEach(m => {
        const w = KPI.exposureWeight(m.launch, refDate);
        const label = w < 1 && m.launch
            ? `${m.label} <span class="text-amber-300">(lancé le ${fmtDate(m.launch)}, compte pour ${Math.round(w * 100)} %)</span>`
            : m.label;
        (byFiliale[m.filiale] = byFiliale[m.filiale] || []).push(label);
    });
    const perimetres = Object.keys(byFiliale)
        .map(f => `<li><span class="font-semibold">${esc(f)}</span> : ${byFiliale[f].join(', ')}</li>`).join('');

    return `<p class="font-semibold text-sm mb-1">Note d'adoption /100</p>
        <p class="text-gray-300 mb-2">Calculée sur les modules de la filiale de l'utilisateur, au ${fmtDate(refDate)}
        (fin du filtre de dates, sinon dernier usage observé). Mêmes données, même note.</p>
        <ul class="space-y-1 mb-2">
            <li><span class="font-semibold">Récurrence (${W.recurrence})</span> : semaines avec au moins un usage ÷ semaines depuis le premier usage (minimum ${A.minWeeks}).</li>
            <li><span class="font-semibold">Volume (${W.volume})</span> : nombre de sessions, échelle logarithmique, plein à ${A.volumeFull}.</li>
            <li><span class="font-semibold">Diversité (${W.diversity})</span> : modules utilisés ÷ modules de la filiale. Un module récent compte au prorata de son ancienneté : 0 à son lancement, plein après ${A.exposureWeeks} semaines.</li>
            <li><span class="font-semibold">Fraîcheur (${W.freshness})</span> : dernier usage ${fresh} · au-delà : 0.</li>
        </ul>
        <p class="mb-2"><span class="font-semibold">Niveaux</span> : ${levels}</p>
        <p class="font-semibold mb-0.5">Modules par filiale</p>
        <ul class="space-y-0.5 text-gray-300">${perimetres}</ul>`;
}

// Commentaires de la note d'un utilisateur, partagés par l'infobulle et l'export Excel.
function adoptionDetailLines(u) {
    const a = u.adoption, d = a.details, W = KPI.ADOPTION.weights;
    const days = d.daysSince === Infinity ? '—' : d.daysSince === 0 ? 'le jour même' : `il y a ${d.daysSince} j`;
    const exposure = d.exposure.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    return [
        { label: 'Récurrence', value: a.parts.recurrence, max: W.recurrence, text: `actif ${d.activeWeeks} sem. sur ${d.weeksObserved}` },
        { label: 'Volume', value: a.parts.volume, max: W.volume, text: `${d.sessions} session${d.sessions > 1 ? 's' : ''}` },
        { label: 'Diversité', value: a.parts.diversity, max: W.diversity, text: `${d.modulesUsed} module${d.modulesUsed > 1 ? 's' : ''} sur ${exposure} accessibles` },
        { label: 'Fraîcheur', value: a.parts.freshness, max: W.freshness, text: `dernier usage ${days}` },
    ];
}

function adoptionDetailText(u) {
    return adoptionDetailLines(u).map(l => `${l.label} ${fmtScorePart(l.value)}/${l.max} : ${l.text}`).join(' · ');
}

// Détail de la note d'un utilisateur (survol de la pastille).
function adoptionDetailHtml(u) {
    const a = u.adoption;
    const rows = adoptionDetailLines(u).map(l => `<tr>
        <td class="pr-3 font-semibold">${l.label}</td>
        <td class="pr-3 text-right whitespace-nowrap">${fmtScorePart(l.value)} / ${l.max}</td>
        <td class="text-gray-300">${l.text}</td></tr>`).join('');
    return `<p class="font-semibold text-sm mb-1.5">${a.score}/100 · ${a.level}</p>
        <table class="w-full"><tbody>${rows}</tbody></table>`;
}

function renderActiveUsersTab() {
    const tbody = document.getElementById('active-users-table-body');
    const countLabel = document.getElementById('active-users-count-label');
    if (!tbody) return;

    if (!activeUsersCache) activeUsersCache = collectActiveUsers();
    const all = activeUsersCache.users;

    const search  = (document.getElementById('users-list-search').value || '').toLowerCase().trim();
    const filiale = document.getElementById('users-list-filiale').value;
    const niveauEl = document.getElementById('users-list-niveau');

    // Compteurs par niveau dans le sélecteur (sur la filiale choisie).
    const niveau = niveauEl.value;
    const perLevel = {};
    all.forEach(u => { if (!filiale || u.filiale === filiale) perLevel[u.adoption.level] = (perLevel[u.adoption.level] || 0) + 1; });
    niveauEl.innerHTML = '<option value="">Tous les niveaux</option>' + KPI.ADOPTION.levels
        .map(([, label]) => `<option value="${label}">${label} (${perLevel[label] || 0})</option>`).join('');
    niveauEl.value = niveau;

    const filtered = all.filter(u => {
        if (search && !u.email.includes(search) && !u.agency.toLowerCase().includes(search)) return false;
        if (filiale && u.filiale !== filiale) return false;
        if (niveau && u.adoption.level !== niveau) return false;
        return true;
    });
    if (usersSortByAdoption) filtered.sort((a, b) => b.adoption.score - a.adoption.score || b.sessions - a.sessions);
    document.getElementById('users-sort-adoption-arrow').textContent = usersSortByAdoption ? '↓' : '↕';

    const emails = new Set(all.map(u => u.email));
    updateUsersTabCounts();

    const fmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const esc = KPI.escapeHtml;
    tbody.innerHTML = filtered.map(u => {
        const badgeClass = FILIALE_BADGE[u.filiale] || FILIALE_BADGE['Autre'];
        const features = Array.from(u.features).join(', ') || '—';
        const lastDate = u.lastActivity ? fmt.format(u.lastActivity) : '—';
        const idx = all.indexOf(u);
        return `<tr class="hover:bg-indigo-50/30 transition-colors">
            <td class="px-4 py-2.5 font-medium text-gray-800">${esc(u.email)}${u.agency ? `<span class="block text-xs font-normal font-mono text-gray-400">${esc(u.agency)}</span>` : ''}</td>
            <td class="px-4 py-2.5">
                <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${badgeClass}">${esc(u.filiale)}</span>
            </td>
            <td class="px-4 py-2.5 text-gray-600 text-xs">${esc(features)}</td>
            <td class="px-4 py-2.5 text-right text-gray-700">${u.sessions}</td>
            <td class="px-4 py-2.5 text-right text-gray-500">${lastDate}</td>
            <td class="px-4 py-2.5 text-right whitespace-nowrap">
                <span data-adoption-user="${idx}" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold cursor-help ${ADOPTION_BADGE[u.adoption.level]}">
                    <span class="tabular-nums">${u.adoption.score}</span><span class="font-normal">${u.adoption.level}</span>
                </span>
            </td>
        </tr>`;
    }).join('');

    if (countLabel) {
        const multi = all.length - emails.size;
        const base = filtered.length < all.length
            ? `${filtered.length} ligne(s) affichée(s) sur ${all.length}`
            : `${filtered.length} ligne(s) au total`;
        countLabel.textContent = multi > 0
            ? `${base} · ${multi} personne(s) active(s) dans plusieurs filiales : une ligne et une note par filiale`
            : base;
    }
}

// Infobulle unique en position fixe : elle n'est pas rognée par le défilement
// de la modale.
function showAdoptionTooltip(anchor, html) {
    const tip = document.getElementById('adoption-tooltip');
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - t.width, window.innerWidth - t.width - 8));
    const below = r.bottom + 8;
    const top = below + t.height > window.innerHeight - 8 ? Math.max(8, r.top - t.height - 8) : below;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
}

function hideAdoptionTooltip() {
    const tip = document.getElementById('adoption-tooltip');
    if (tip) tip.classList.add('hidden');
}

// Couleur de chaque profil, partagée par le camembert et les barres de
// répartition (mêmes teintes que les pastilles ADOPTION_BADGE). Le gris de
// « Découverte » est volontairement neutre ; les autres teintes passent la
// validation daltonisme (dataviz validate_palette). Libellés + légende +
// tableau accompagnent toujours la couleur.
const ADOPTION_LEVEL_COLORS = {
    'Découverte':  '#9ca3af',
    'Occasionnel': '#f59e0b',
    'Régulier':    '#6366f1',
    'Adopté':      '#059669',
};
// Ordre de lecture : du profil le plus faible au plus fort.
const adoptionLevelsAsc = () => KPI.ADOPTION.levels.map(([, label]) => label).reverse();

// Barre 100 % empilée par profil, segments séparés de 2px.
function adoptionLevelBar(levels, total, widthClass) {
    if (!total) return `<div class="h-2 ${widthClass} rounded-full bg-gray-100"></div>`;
    const segs = adoptionLevelsAsc().map(label => {
        const n = levels[label] || 0;
        return n ? `<div title="${label} : ${n}" style="width:${(n / total) * 100}%;background:${ADOPTION_LEVEL_COLORS[label]}"></div>` : '';
    }).join('');
    return `<div class="flex gap-[2px] h-2 ${widthClass} rounded-full overflow-hidden">${segs}</div>`;
}

const fmtPct = v => v === null ? '—' : Math.round(v * 100) + ' %';

let synthesisChart = null;

// Pourcentage écrit dans chaque part (≥ 5 %) : l'identité ne repose pas sur
// la couleur seule.
const pieLabelsPlugin = {
    id: 'adoptionPieLabels',
    afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const data = chart.data.datasets[0].data;
        const total = data.reduce((s, v) => s + v, 0);
        if (!total) return;
        ctx.save();
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        chart.getDatasetMeta(0).data.forEach((arc, i) => {
            const share = data[i] / total;
            if (share < 0.05) return;
            const { x, y } = arc.tooltipPosition();
            const label = chart.data.labels[i];
            ctx.fillStyle = (label === 'Régulier' || label === 'Adopté') ? '#ffffff' : '#111827';
            ctx.fillText(Math.round(share * 100) + ' %', x, y);
        });
        ctx.restore();
    },
};

// Compteurs des onglets, quel que soit l'onglet ouvert en premier.
function updateUsersTabCounts() {
    if (!activeUsersCache) activeUsersCache = collectActiveUsers();
    if (!agencyScoresCache) agencyScoresCache = collectAgencyScores(activeUsersCache.users);
    document.getElementById('tab-active-count').textContent =
        new Set(activeUsersCache.users.map(u => u.email)).size + ' utilisateurs';
    document.getElementById('tab-agencies-count').textContent =
        agencyScoresCache.filter(a => a.agency).length + ' agences';
}

function renderSynthesisTab() {
    if (!activeUsersCache) activeUsersCache = collectActiveUsers();
    updateUsersTabCounts();
    const all = activeUsersCache.users;
    const filiale = document.getElementById('synthesis-filiale').value;
    const scope = filiale ? all.filter(u => u.filiale === filiale) : all;
    const s = KPI.adoptionSummary(scope.map(u => u.adoption));
    const order = adoptionLevelsAsc();

    // Tuiles
    const tile = (label, value, sub) => `<div class="border border-gray-200 rounded-xl px-4 py-3">
        <p class="text-xs text-gray-500">${label}</p>
        <p class="text-2xl font-semibold text-gray-900 tabular-nums mt-0.5">${value}</p>
        <p class="text-xs text-gray-400 mt-0.5">${sub}</p></div>`;
    const people = new Set(scope.map(u => u.email)).size;
    document.getElementById('synthesis-tiles').innerHTML =
        tile('Utilisateurs notés', s.count, people !== s.count ? `${people} personnes (une note par filiale)` : 'une note par utilisateur')
        + tile('Note médiane', s.median === null ? '—' : `${s.median}<span class="text-sm text-gray-400 font-normal"> /100</span>`,
               s.median === null ? '' : KPI.adoptionLevel(s.median))
        + tile('Régulier ou Adopté', fmtPct(s.regularShare), `note ≥ ${KPI.ADOPTION.levels[KPI.ADOPTION.levels.length - 3][0]}`);

    // Légende (effectifs + parts)
    document.getElementById('synthesis-legend').innerHTML = order.slice().reverse().map(label => {
        const n = s.levels[label] || 0;
        return `<li class="flex items-center gap-2">
            <span class="w-3 h-3 rounded-sm flex-shrink-0" style="background:${ADOPTION_LEVEL_COLORS[label]}"></span>
            <span class="text-gray-700 flex-1">${label}</span>
            <span class="tabular-nums text-gray-900 font-medium">${n}</span>
            <span class="tabular-nums text-gray-400 w-12 text-right">${s.count ? fmtPct(n / s.count) : '—'}</span></li>`;
    }).join('');

    // Camembert
    const canvas = document.getElementById('synthesis-pie');
    const data = order.map(label => s.levels[label] || 0);
    if (synthesisChart) {
        synthesisChart.data.datasets[0].data = data;
        synthesisChart.update();
    } else if (canvas && typeof Chart !== 'undefined') {
        synthesisChart = new Chart(canvas.getContext('2d'), {
            type: 'pie',
            data: {
                labels: order,
                datasets: [{
                    data,
                    backgroundColor: order.map(l => ADOPTION_LEVEL_COLORS[l]),
                    borderColor: '#ffffff',
                    borderWidth: 2,
                    hoverOffset: 6,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                animation: { duration: 300 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: c => {
                                const total = c.dataset.data.reduce((a, b) => a + b, 0);
                                return ` ${c.label} : ${c.parsed} utilisateur${c.parsed > 1 ? 's' : ''} (${total ? Math.round(c.parsed / total * 100) : 0} %)`;
                            },
                        },
                    },
                },
            },
            plugins: [pieLabelsPlugin],
        });
    }

    // Par filiale (toujours toutes les filiales ; la sélection est surlignée)
    const filiales = Object.values(ADOPTION_FILIALES).map(f => f.label);
    document.getElementById('synthesis-filiales').innerHTML = filiales.map(f => {
        const fs = KPI.adoptionSummary(all.filter(u => u.filiale === f).map(u => u.adoption));
        const badgeClass = FILIALE_BADGE[f] || FILIALE_BADGE['Autre'];
        const selected = filiale === f ? 'bg-indigo-50/60' : '';
        return `<tr class="${selected}">
            <td class="py-2.5"><span class="px-2 py-0.5 rounded-full text-xs font-semibold ${badgeClass}">${KPI.escapeHtml(f)}</span></td>
            <td class="py-2.5 text-right tabular-nums text-gray-700">${fs.count}</td>
            <td class="py-2.5 text-right tabular-nums font-medium text-gray-900">${fs.median === null ? '—' : fs.median}</td>
            <td class="py-2.5 pl-4">${adoptionLevelBar(fs.levels, fs.count, 'w-40')}</td>
            <td class="py-2.5 text-right tabular-nums text-gray-700">${fmtPct(fs.regularShare)}</td>
        </tr>`;
    }).join('');
}

// Seuil sous lequel une médiane d'agence est signalée comme peu représentative.
const AGENCY_MIN_USERS = 3;

/**
 * Note d'adoption par agence = médiane des notes de ses utilisateurs actifs
 * (agence de rattachement, cf. collectActiveUsers). Une ligne par couple
 * (filiale, agence) ; les utilisateurs sans agence identifiable forment une
 * ligne « Agence non renseignée » par filiale.
 */
function collectAgencyScores(users) {
    const groups = new Map();
    users.forEach(u => {
        const key = u.filiale + '|' + u.agency;
        if (!groups.has(key)) groups.set(key, { filiale: u.filiale, agency: u.agency, users: [] });
        groups.get(key).users.push(u);
    });
    return Array.from(groups.values()).map(g => {
        const scores = g.users.map(u => u.adoption.score);
        const med = KPI.median(scores);
        const levels = {};
        g.users.forEach(u => { levels[u.adoption.level] = (levels[u.adoption.level] || 0) + 1; });
        // Effectif : population cible (contrôle technique uniquement).
        const effectif = g.agency && g.filiale === ADOPTION_FILIALES.CT.label ? (agencyPopulation[g.agency] || 0) : 0;
        const sorted = scores.slice().sort((a, b) => a - b);
        return {
            filiale: g.filiale,
            agency: g.agency,
            direction: g.agency ? (agencyToDirection[g.agency] || '') : '',
            active: g.users.length,
            effectif,
            coverage: effectif ? g.users.length / effectif : null,
            median: med === null ? null : Math.round(med),
            level: med === null ? null : KPI.adoptionLevel(Math.round(med)),
            levels,
            min: sorted[0],
            max: sorted[sorted.length - 1],
        };
    // Agences identifiées d'abord, puis celles à trop peu d'utilisateurs, puis les
    // « non renseignées » ; dans chaque bloc, par médiane décroissante.
    }).sort((a, b) => (!a.agency) - (!b.agency)
        || (a.active < AGENCY_MIN_USERS) - (b.active < AGENCY_MIN_USERS)
        || (b.median - a.median) || (b.active - a.active) || a.agency.localeCompare(b.agency));
}

let agencyScoresCache = null;

function agencyMethodHtml() {
    return `<p class="font-semibold text-sm mb-1">Note d'adoption par agence</p>
        <ul class="space-y-1">
            <li><span class="font-semibold">Note</span> : médiane des notes d'adoption des utilisateurs actifs rattachés à l'agence (survoler l'en-tête « Adoption » de l'onglet Utilisateurs actifs pour le calcul d'une note).</li>
            <li><span class="font-semibold">Rattachement</span> : agence majoritaire des sessions de l'utilisateur, toutes périodes confondues (agence de l'affaire, ou service de production pour les chats). Une personne active dans deux filiales compte dans chacune.</li>
            <li><span class="font-semibold">Couverture</span> : utilisateurs actifs ÷ effectif de la population cible (contrôle technique). La médiane ne dit rien de ceux qui n'utilisent pas l'IA : la lire avec la couverture.</li>
            <li><span class="font-semibold">Moins de ${AGENCY_MIN_USERS} utilisateurs</span> : médiane grisée, peu représentative.</li>
        </ul>`;
}

// Commentaire d'une agence, partagé par l'infobulle et l'export Excel.
function agencyDetailText(a) {
    const levels = KPI.ADOPTION.levels.map(([, label]) => `${label} ${a.levels[label] || 0}`).join(', ');
    return `${a.active} utilisateur${a.active > 1 ? 's' : ''} actif${a.active > 1 ? 's' : ''} · notes de ${a.min} à ${a.max} · ${levels}`
        + (a.active < AGENCY_MIN_USERS ? ' · échantillon faible' : '');
}

function agencyDetailHtml(a) {
    const lines = KPI.ADOPTION.levels.map(([, label]) => `<tr><td class="pr-3">${label}</td><td class="text-right">${a.levels[label] || 0}</td></tr>`).join('');
    return `<p class="font-semibold text-sm mb-1.5">${KPI.escapeHtml(a.agency || 'Agence non renseignée')} · médiane ${a.median}/100</p>
        <p class="text-gray-300 mb-1.5">${a.active} utilisateur${a.active > 1 ? 's' : ''} actif${a.active > 1 ? 's' : ''} · notes de ${a.min} à ${a.max}</p>
        <table><tbody>${lines}</tbody></table>`;
}

function renderAgenciesTab() {
    const tbody = document.getElementById('agencies-table-body');
    if (!tbody) return;
    if (!activeUsersCache) activeUsersCache = collectActiveUsers();
    if (!agencyScoresCache) agencyScoresCache = collectAgencyScores(activeUsersCache.users);

    const filiale = document.getElementById('agencies-list-filiale').value;
    const rows = agencyScoresCache.filter(a => !filiale || a.filiale === filiale);
    updateUsersTabCounts();

    const esc = KPI.escapeHtml;
    tbody.innerHTML = rows.map(a => {
        const idx = agencyScoresCache.indexOf(a);
        const badgeClass = FILIALE_BADGE[a.filiale] || FILIALE_BADGE['Autre'];
        const weak = a.active < AGENCY_MIN_USERS;
        const coverage = a.coverage === null ? '<span class="text-gray-300">—</span>'
            : `${Math.round(a.coverage * 100)} %<span class="text-gray-400 text-xs"> (${a.active}/${a.effectif})</span>`;
        return `<tr class="hover:bg-indigo-50/30 transition-colors">
            <td class="px-4 py-2.5">
                ${a.agency ? `<span class="font-mono font-medium text-indigo-700">${esc(a.agency)}</span>`
                           : '<span class="italic text-gray-400">Agence non renseignée</span>'}
                ${a.direction ? `<span class="block text-xs text-gray-400">${esc(a.direction)}</span>` : ''}
            </td>
            <td class="px-4 py-2.5"><span class="px-2 py-0.5 rounded-full text-xs font-semibold ${badgeClass}">${esc(a.filiale)}</span></td>
            <td class="px-4 py-2.5 text-right text-gray-700">${a.active}</td>
            <td class="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">${coverage}</td>
            <td class="px-4 py-2.5">${adoptionLevelBar(a.levels, a.active, 'w-32')}</td>
            <td class="px-4 py-2.5 text-right whitespace-nowrap">
                <span data-adoption-agency="${idx}" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold cursor-help ${weak ? 'bg-gray-50 text-gray-400' : ADOPTION_BADGE[a.level]}">
                    <span class="tabular-nums">${a.median}</span><span class="font-normal">${a.level}</span>
                </span>
            </td>
        </tr>`;
    }).join('');

    const label = document.getElementById('agencies-count-label');
    if (label) {
        const without = rows.filter(a => !a.agency).reduce((s, a) => s + a.active, 0);
        label.textContent = `${rows.filter(a => a.agency).length} agence(s) affichée(s)`
            + (without ? ` · ${without} utilisateur(s) sans agence identifiable (sessions sans code agence : chats sans service de production, NF Habitat…)` : '');
    }
}

function switchUsersListTab(tab) {
    currentUsersTab = tab;
    const tabs = {
        population: { btn: 'tab-population', panel: 'panel-population', subtitle: 'Collaborateurs BTP Consultants (population cible)' },
        synthesis:  { btn: 'tab-synthesis', panel: 'panel-synthesis', subtitle: "Répartition des profils d'adoption" },
        active:     { btn: 'tab-active-users', panel: 'panel-active-users', subtitle: 'Tous les utilisateurs ayant utilisé au moins une fonctionnalité' },
        agencies:   { btn: 'tab-agencies', panel: 'panel-agencies', subtitle: "Note d'adoption médiane par agence" },
    };
    hideAdoptionTooltip();
    Object.keys(tabs).forEach((key, i) => {
        const on = key === tab;
        document.getElementById(tabs[key].btn).className = 'px-4 py-3 text-sm font-medium border-b-2 transition-colors'
            + (i ? ' ml-2' : '')
            + (on ? ' border-indigo-600 text-indigo-600' : ' border-transparent text-gray-500 hover:text-gray-700');
        document.getElementById(tabs[key].panel).classList.toggle('hidden', !on);
    });
    document.getElementById('users-list-subtitle').textContent = tabs[tab].subtitle;
    if (tab === 'active') renderActiveUsersTab();
    if (tab === 'agencies') renderAgenciesTab();
    if (tab === 'synthesis') renderSynthesisTab();
}

function openUsersListModal() {
    activeUsersCache = null; // always refresh on open
    agencyScoresCache = null;
    document.getElementById('users-list-modal').classList.remove('hidden');
    renderPopulationTab();
    switchUsersListTab('population');
}

function closeUsersListModal() {
    hideAdoptionTooltip();
    document.getElementById('users-list-modal').classList.add('hidden');
}

// ==================== EXPORT EXCEL (ADOPTION) ====================

// SheetJS n'est chargé qu'au premier export (inutile au reste du dashboard).
const XLSX_LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

function loadXlsxLib() {
    if (typeof XLSX !== 'undefined') return Promise.resolve(XLSX);
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = XLSX_LIB_URL;
        s.onload = () => resolve(XLSX);
        s.onerror = () => reject(new Error('Chargement de SheetJS impossible'));
        document.head.appendChild(s);
    });
}

// Feuille depuis un tableau [en-têtes, ...lignes], avec largeurs de colonnes
// et formats numériques optionnels ({ indexColonne: '0%' }).
function adoptionSheet(lib, rows, widths, formats) {
    const ws = lib.utils.aoa_to_sheet(rows, { cellDates: true });
    ws['!cols'] = widths.map(wch => ({ wch }));
    ws['!autofilter'] = { ref: lib.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
    Object.keys(formats || {}).forEach(c => {
        for (let r = 1; r < rows.length; r++) {
            const cell = ws[lib.utils.encode_cell({ r, c: +c })];
            if (cell && cell.t !== 's') cell.z = formats[c];
        }
    });
    return ws;
}

/**
 * Classeur des deux onglets « Utilisateurs actifs » et « Adoption par agence »
 * (toutes les lignes, sans les filtres de recherche / filiale / niveau de la
 * popup, sur la période du filtre de dates), plus une feuille Méthode.
 */
function buildAdoptionWorkbook(lib) {
    if (!activeUsersCache) activeUsersCache = collectActiveUsers();
    if (!agencyScoresCache) agencyScoresCache = collectAgencyScores(activeUsersCache.users);
    const { refDate, modules, users } = activeUsersCache;
    const A = KPI.ADOPTION, W = A.weights;
    const r1 = v => Math.round(v * 10) / 10;
    const day = d => d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : '';

    const usersRows = [[
        'Email', 'Filiale', 'Agence', 'Direction régionale', 'Fonctionnalités', 'Sessions',
        'Semaines actives', 'Semaines observées', 'Modules utilisés', 'Modules accessibles (pondérés)',
        'Première activité', 'Dernière activité', 'Jours depuis le dernier usage',
        `Récurrence /${W.recurrence}`, `Volume /${W.volume}`, `Diversité /${W.diversity}`, `Fraîcheur /${W.freshness}`,
        'Note /100', 'Niveau', 'Commentaire',
    ]];
    users.slice().sort((a, b) => b.adoption.score - a.adoption.score || a.email.localeCompare(b.email)).forEach(u => {
        const a = u.adoption, d = a.details;
        usersRows.push([
            u.email, u.filiale, u.agency || '', u.agency ? (agencyToDirection[u.agency] || '') : '',
            Array.from(u.features).join(', '), u.sessions,
            d.activeWeeks, d.weeksObserved, d.modulesUsed, r1(d.exposure),
            day(u.firstActivity), day(u.lastActivity), d.daysSince === Infinity ? '' : d.daysSince,
            r1(a.parts.recurrence), r1(a.parts.volume), r1(a.parts.diversity), r1(a.parts.freshness),
            a.score, a.level, adoptionDetailText(u),
        ]);
    });

    const levelLabels = A.levels.map(([, label]) => label);
    const agencyRows = [[
        'Agence', 'Direction régionale', 'Filiale', 'Utilisateurs actifs', 'Effectif (population cible)', 'Couverture',
        'Note médiane', 'Niveau', 'Note min', 'Note max', ...levelLabels, `Moins de ${AGENCY_MIN_USERS} utilisateurs`,
        'Commentaire',
    ]];
    agencyScoresCache.forEach(a => {
        agencyRows.push([
            a.agency || 'Agence non renseignée', a.direction, a.filiale, a.active, a.effectif || '',
            a.coverage === null ? '' : a.coverage,
            a.median, a.level, a.min, a.max, ...levelLabels.map(l => a.levels[l] || 0),
            a.active < AGENCY_MIN_USERS ? 'oui' : 'non',
            agencyDetailText(a),
        ]);
    });

    const fmtDate = d => d ? new Intl.DateTimeFormat('fr-FR').format(d) : '—';
    const periode = (dateFilter.startDate || dateFilter.endDate)
        ? `${dateFilter.startDate ? fmtDate(new Date(dateFilter.startDate)) : 'début'} → ${dateFilter.endDate ? fmtDate(new Date(dateFilter.endDate)) : 'fin'}`
        : 'Tout l\'historique';
    const methodRows = [
        ['Paramètre', 'Valeur'],
        ['Généré le', new Date()],
        ['Période (filtre de dates)', periode],
        ['Date de référence', day(refDate)],
        ['Note', 'Calculée sur les modules de la filiale de l\'utilisateur ; une ligne par couple email × filiale.'],
        [`Récurrence (${W.recurrence})`, `Semaines avec au moins un usage ÷ semaines depuis le premier usage (minimum ${A.minWeeks}).`],
        [`Volume (${W.volume})`, `Sessions, échelle logarithmique, plein à ${A.volumeFull}.`],
        [`Diversité (${W.diversity})`, `Modules utilisés ÷ modules de la filiale, un module récent comptant au prorata de son ancienneté (plein après ${A.exposureWeeks} semaines).`],
        [`Fraîcheur (${W.freshness})`, A.freshness.map(([days, part]) => `≤ ${days} j : ${Math.round(part * W.freshness)}`).join(' · ') + ' · au-delà : 0'],
        ['Niveaux', A.levels.map(([min, label]) => `${label} ≥ ${min}`).join(' · ')],
        ['Note par agence', 'Médiane des notes des utilisateurs actifs rattachés à l\'agence (agence majoritaire de leurs sessions, toutes périodes).'],
        ['Couverture', 'Utilisateurs actifs ÷ effectif de la population cible (contrôle technique uniquement).'],
        [],
        ['Module', 'Filiale', 'Lancement (premier usage observé)', 'Poids dans la diversité'],
        ...modules.map(m => [m.label, m.filiale, day(m.launch), KPI.exposureWeight(m.launch, refDate)]),
    ];

    // Synthèse : répartition des profils, toutes filiales puis par filiale.
    // (SheetJS édition communautaire ne crée pas de graphique : le camembert
    // est dans la popup, ici les mêmes chiffres en tableau.)
    const asc = adoptionLevelsAsc();
    const synthRows = [['Périmètre', 'Utilisateurs notés', 'Note médiane',
        ...asc, ...asc.map(l => `% ${l}`), '% Régulier ou Adopté']];
    const synthLine = (label, list) => {
        const sm = KPI.adoptionSummary(list.map(u => u.adoption));
        synthRows.push([label, sm.count, sm.median === null ? '' : sm.median,
            ...asc.map(l => sm.levels[l] || 0),
            ...asc.map(l => sm.count ? (sm.levels[l] || 0) / sm.count : ''),
            sm.regularShare === null ? '' : sm.regularShare]);
    };
    synthLine('Toutes filiales', users);
    Object.values(ADOPTION_FILIALES).forEach(f => synthLine(f.label, users.filter(u => u.filiale === f.label)));
    const pctCols = {};
    for (let c = 3 + asc.length; c < synthRows[0].length; c++) pctCols[c] = '0%';

    const wb = lib.utils.book_new();
    lib.utils.book_append_sheet(wb, adoptionSheet(lib, synthRows,
        [22, 10, 10, ...asc.map(() => 11), ...asc.map(() => 13), 14], pctCols), 'Synthèse');
    lib.utils.book_append_sheet(wb, adoptionSheet(lib, usersRows,
        [34, 20, 10, 18, 40, 9, 9, 9, 9, 11, 12, 12, 10, 10, 9, 9, 9, 9, 12, 110],
        { 10: 'dd/mm/yyyy', 11: 'dd/mm/yyyy' }), 'Utilisateurs actifs');
    lib.utils.book_append_sheet(wb, adoptionSheet(lib, agencyRows,
        [24, 20, 20, 10, 12, 11, 10, 12, 9, 9, 9, 9, 11, 11, 12, 70],
        { 5: '0%' }), 'Adoption par agence');
    const wsMethod = lib.utils.aoa_to_sheet(methodRows, { cellDates: true });
    wsMethod['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 30 }, { wch: 22 }];
    ['B2', 'B4'].forEach(ref => { if (wsMethod[ref]) wsMethod[ref].z = ref === 'B2' ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy'; });
    for (let r = 14; r < methodRows.length; r++) {
        const c = wsMethod[lib.utils.encode_cell({ r, c: 2 })];
        if (c && c.t !== 's') c.z = 'dd/mm/yyyy';
        const w = wsMethod[lib.utils.encode_cell({ r, c: 3 })];
        if (w) w.z = '0%';
    }
    lib.utils.book_append_sheet(wb, wsMethod, 'Méthode');

    const stamp = refDate ? refDate.toISOString().slice(0, 10) : 'na';
    return { wb, filename: `adoption-ia_${stamp}.xlsx` };
}

async function exportAdoptionXlsx() {
    const label = document.getElementById('export-adoption-xlsx-label');
    const initial = label ? label.textContent : '';
    try {
        if (label) label.textContent = 'Export…';
        const lib = await loadXlsxLib();
        const { wb, filename } = buildAdoptionWorkbook(lib);
        lib.writeFile(wb, filename);
    } catch (e) {
        console.error('Export Excel adoption :', e);
        alert('Export Excel impossible : ' + e.message);
    } finally {
        if (label) label.textContent = initial;
    }
}

(function initUsersListModal() {
    const btn = document.getElementById('open-users-list-btn');
    if (btn) btn.addEventListener('click', openUsersListModal);

    const closeBtn = document.getElementById('close-users-list-modal');
    if (closeBtn) closeBtn.addEventListener('click', closeUsersListModal);

    const modal = document.getElementById('users-list-modal');
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeUsersListModal(); });

    const tabPop    = document.getElementById('tab-population');
    const tabActive = document.getElementById('tab-active-users');
    if (tabPop)    tabPop.addEventListener('click', () => switchUsersListTab('population'));
    if (tabActive) tabActive.addEventListener('click', () => switchUsersListTab('active'));
    const exportBtn = document.getElementById('export-adoption-xlsx');
    if (exportBtn) exportBtn.addEventListener('click', exportAdoptionXlsx);
    const tabSynthesis = document.getElementById('tab-synthesis');
    if (tabSynthesis) tabSynthesis.addEventListener('click', () => switchUsersListTab('synthesis'));
    const synthesisFiliale = document.getElementById('synthesis-filiale');
    if (synthesisFiliale) synthesisFiliale.addEventListener('change', renderSynthesisTab);
    const tabAgencies = document.getElementById('tab-agencies');
    if (tabAgencies) tabAgencies.addEventListener('click', () => switchUsersListTab('agencies'));
    const agenciesFiliale = document.getElementById('agencies-list-filiale');
    if (agenciesFiliale) agenciesFiliale.addEventListener('change', renderAgenciesTab);

    const search  = document.getElementById('users-list-search');
    const filiale = document.getElementById('users-list-filiale');
    const niveau  = document.getElementById('users-list-niveau');
    const refresh = () => renderActiveUsersTab();
    if (search)  search.addEventListener('input', refresh);
    if (filiale) filiale.addEventListener('change', refresh);
    if (niveau)  niveau.addEventListener('change', refresh);

    const sortBtn = document.getElementById('users-sort-adoption');
    if (sortBtn) sortBtn.addEventListener('click', () => { usersSortByAdoption = !usersSortByAdoption; refresh(); });

    // Survol : méthode de calcul (icônes d'en-tête) et détail des notes (pastilles),
    // pour les onglets Utilisateurs actifs et Adoption par agence.
    const HOVER = '#adoption-method-info, #agency-method-info, [data-adoption-user], [data-adoption-agency]';
    const scroller = document.getElementById('panel-active-users')?.parentElement;
    if (scroller) {
        scroller.addEventListener('mouseover', e => {
            const el = e.target.closest(HOVER);
            if (!el || !activeUsersCache) return;
            if (el.id === 'adoption-method-info') showAdoptionTooltip(el, adoptionMethodHtml());
            else if (el.id === 'agency-method-info') showAdoptionTooltip(el, agencyMethodHtml());
            else if (el.dataset.adoptionUser) showAdoptionTooltip(el, adoptionDetailHtml(activeUsersCache.users[+el.dataset.adoptionUser]));
            else if (agencyScoresCache) showAdoptionTooltip(el, agencyDetailHtml(agencyScoresCache[+el.dataset.adoptionAgency]));
        });
        scroller.addEventListener('mouseout', e => {
            const from = e.target.closest(HOVER);
            if (from && !from.contains(e.relatedTarget)) hideAdoptionTooltip();
        });
        scroller.addEventListener('scroll', hideAdoptionTooltip);
    }
})();

// ==================== USERS EVOLUTION MODAL ====================

let usersEvolutionChart = null;
let usersModalView = 'monthly'; // 'monthly' | 'cumul' | 'filiale'
let usersModalData = null; // cached monthly users data

/**
 * Calculate monthly user metrics from all data sources (no active filters, full history).
 * Returns per-month: activeUsers (unique users active that month), newUsers (first appearance),
 * cumulativeUsers (total unique users up to and including that month).
 */
function calculateMonthlyUsers() {
    const monthlyUserSets = {}; // key → Set<email>

    const addUser = (dateString, email, domain) => {
        if (!email || !email.trim()) return;
        if (domain && !email.includes(domain)) return;
        const key = getMonthKey(dateString);
        if (!key) return;
        if (!monthlyUserSets[key]) monthlyUserSets[key] = new Set();
        monthlyUserSets[key].add(email.toLowerCase().trim());
    };

    // Descriptif (type = DESCRIPTIF_TYPE, pas de YIELD)
    getFilteredData(descriptifData)
        .filter(item => isDescriptifRow(item) && !item.contractNumber.toUpperCase().includes('YIELD'))
        .forEach(item => addUser(item.createdAt, item.email));

    // Autocontact (@btp-consultants.fr, pas de YIELD, fromAI)
    getFilteredData(autocontactData)
        .filter(item => !item.contractNumber.toUpperCase().includes('YIELD') && item.fromAI)
        .forEach(item => addUser(item.createdAt, item.email, '@btp-consultants.fr'));

    // Comparateur
    getFilteredData(comparateurData).forEach(item => addUser(item.createdAt, item.email));

    // Expert / Chat BTP Consultants
    getFilteredData(expertBTPData).forEach(item => addUser(item.createdAt, item.email, '@btp-consultants.fr'));
    getFilteredData(chatBTPData).forEach(item => addUser(item.createdAt, item.email, '@btp-consultants.fr'));

    // Expert / Chat Citae
    getFilteredData(expertCitaeData).forEach(item => addUser(item.createdAt, item.email, '@citae.fr'));
    getFilteredData(chatCitaeData).forEach(item => addUser(item.createdAt, item.email, '@citae.fr'));

    // Expert / Chat BTP Diagnostics
    getFilteredData(expertBTPDiagData).forEach(item => addUser(item.createdAt, item.email, '@btp-diagnostics.fr'));
    getFilteredData(chatBTPDiagData).forEach(item => addUser(item.createdAt, item.email, '@btp-diagnostics.fr'));

    // Expert / Chat BTP Consultants SPS — données isolées par source, pas de filtre domaine
    getFilteredData(expertBtpSpsData).forEach(item => addUser(item.createdAt, item.email));
    getFilteredData(chatBtpSpsData).forEach(item => addUser(item.createdAt, item.email));

    // Autocontact SPS — idem, et seule la création VIA L'IA compte comme usage
    getFilteredData(autocontactSpsData)
        .filter(item => item.fromAI)
        .forEach(item => addUser(item.createdAt, item.email));

    const sortedMonths = Object.keys(monthlyUserSets).sort();
    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

    const allSeenUsers = new Set();
    return sortedMonths.map(key => {
        const monthSet = monthlyUserSets[key];
        let newUsersCount = 0;
        monthSet.forEach(u => {
            if (!allSeenUsers.has(u)) {
                allSeenUsers.add(u);
                newUsersCount++;
            }
        });
        const [year, month] = key.split('-');
        return {
            key,
            label: `${monthNames[parseInt(month) - 1]} ${year}`,
            activeUsers: monthSet.size,
            newUsers: newUsersCount,
            cumulativeUsers: allSeenUsers.size,
        };
    });
}

// Répartition des utilisateurs actifs par filiale (réutilise collectActiveUsers : une
// ligne par couple email × filiale, filtre de date respecté — comme l'onglet « Utilisateurs actifs »).
const FILIALE_PIE_COLORS = {
    'BTP Consultants':     'rgba(59, 130, 246, 0.85)',
    'Citae':               'rgba(16, 185, 129, 0.85)',
    'BTP Diagnostics':     'rgba(249, 115, 22, 0.85)',
    'BTP Consultants SPS': 'rgba(14, 165, 233, 0.85)',
    'Autre':               'rgba(156, 163, 175, 0.85)',
};
function calculateUsersByFiliale() {
    const counts = {};
    collectActiveUsers().users.forEach(u => {
        counts[u.filiale] = (counts[u.filiale] || 0) + 1;
    });
    const order = ['BTP Consultants', 'Citae', 'BTP Diagnostics', 'BTP Consultants SPS', 'Autre'];
    const result = [];
    order.forEach(f => { if (counts[f]) result.push({ filiale: f, count: counts[f], color: FILIALE_PIE_COLORS[f] }); });
    Object.keys(counts).forEach(f => {
        if (!order.includes(f)) result.push({ filiale: f, count: counts[f], color: FILIALE_PIE_COLORS['Autre'] });
    });
    return result;
}

function buildUsersChart() {
    const canvas = document.getElementById('usersEvolutionChart');
    if (!canvas) return;

    if (usersEvolutionChart) {
        usersEvolutionChart.destroy();
        usersEvolutionChart = null;
    }

    const ctx = canvas.getContext('2d');

    // ── Vue « Par filiale » : camembert du nombre d'utilisateurs uniques par filiale ──
    if (usersModalView === 'filiale') {
        const data = calculateUsersByFiliale();
        const total = data.reduce((s, d) => s + d.count, 0);
        usersEvolutionChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: data.map(d => d.filiale),
                datasets: [{
                    data: data.map(d => d.count),
                    backgroundColor: data.map(d => d.color),
                    borderColor: '#ffffff',
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true, position: 'right',
                        labels: { font: { size: 13, weight: '500' }, color: '#1F2937', padding: 16, usePointStyle: true }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(17, 24, 39, 0.95)',
                        titleColor: '#F9FAFB', bodyColor: '#E5E7EB',
                        borderColor: 'rgba(75, 85, 99, 0.4)', borderWidth: 1,
                        padding: 12, cornerRadius: 8,
                        callbacks: {
                            label: function(ctx) {
                                const v = ctx.parsed;
                                const pct = total > 0 ? (v / total * 100) : 0;
                                return ` ${ctx.label} : ${new Intl.NumberFormat('fr-FR').format(v)} utilisateur${v > 1 ? 's' : ''} (${pct.toFixed(1)}%)`;
                            }
                        }
                    }
                }
            }
        });
        return;
    }

    if (!usersModalData) return;

    const labels = usersModalData.map(d => d.label);
    const isCumul = (usersModalView === 'cumul');

    if (isCumul) {
        // Cumulative view: area + bar for new users
        usersEvolutionChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Nouveaux utilisateurs',
                        data: usersModalData.map(d => d.newUsers),
                        backgroundColor: 'rgba(99, 102, 241, 0.6)',
                        borderColor: 'rgba(79, 70, 229, 1)',
                        borderWidth: 2,
                        borderRadius: 5,
                        yAxisID: 'yNew',
                        order: 2,
                    },
                    {
                        label: 'Utilisateurs cumulés',
                        data: usersModalData.map(d => d.cumulativeUsers),
                        type: 'line',
                        borderColor: 'rgba(16, 185, 129, 1)',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.35,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        pointBackgroundColor: 'rgba(16, 185, 129, 1)',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        yAxisID: 'yCumul',
                        order: 1,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true, position: 'top',
                        labels: { font: { size: 13, weight: '500' }, color: '#1F2937', padding: 16, usePointStyle: true }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(17, 24, 39, 0.95)',
                        titleColor: '#F9FAFB', bodyColor: '#E5E7EB',
                        borderColor: 'rgba(75, 85, 99, 0.4)', borderWidth: 1,
                        padding: 12, cornerRadius: 8,
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#6B7280' } },
                    yNew: {
                        type: 'linear', position: 'left', beginAtZero: true,
                        grid: { color: 'rgba(229, 231, 235, 0.8)' },
                        title: { display: true, text: 'Nouveaux utilisateurs', font: { size: 12, weight: 'bold' }, color: '#6366F1' },
                        ticks: { font: { size: 11 }, color: '#6366F1', stepSize: 1 }
                    },
                    yCumul: {
                        type: 'linear', position: 'right', beginAtZero: true,
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: 'Total cumulé', font: { size: 12, weight: 'bold' }, color: '#10B981' },
                        ticks: { font: { size: 11 }, color: '#10B981', stepSize: 1 }
                    }
                }
            }
        });
    } else {
        // Monthly view: bar chart of active users + line of new users
        usersEvolutionChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Utilisateurs actifs (mensuel)',
                        data: usersModalData.map(d => d.activeUsers),
                        backgroundColor: 'rgba(99, 102, 241, 0.7)',
                        borderColor: 'rgba(79, 70, 229, 1)',
                        borderWidth: 2,
                        borderRadius: 5,
                        yAxisID: 'yActive',
                        order: 2,
                    },
                    {
                        label: 'Nouveaux utilisateurs (mensuel)',
                        data: usersModalData.map(d => d.newUsers),
                        type: 'line',
                        borderColor: 'rgba(245, 158, 11, 1)',
                        backgroundColor: 'rgba(245, 158, 11, 0.08)',
                        borderWidth: 2.5,
                        fill: false,
                        tension: 0.35,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        pointBackgroundColor: 'rgba(245, 158, 11, 1)',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        yAxisID: 'yActive',
                        order: 1,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true, position: 'top',
                        labels: { font: { size: 13, weight: '500' }, color: '#1F2937', padding: 16, usePointStyle: true }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(17, 24, 39, 0.95)',
                        titleColor: '#F9FAFB', bodyColor: '#E5E7EB',
                        borderColor: 'rgba(75, 85, 99, 0.4)', borderWidth: 1,
                        padding: 12, cornerRadius: 8,
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#6B7280' } },
                    yActive: {
                        type: 'linear', position: 'left', beginAtZero: true,
                        grid: { color: 'rgba(229, 231, 235, 0.8)' },
                        title: { display: true, text: 'Utilisateurs', font: { size: 12, weight: 'bold' }, color: '#6366F1' },
                        ticks: { font: { size: 11 }, color: '#6366F1', stepSize: 1 }
                    }
                }
            }
        });
    }
}

function updateUsersToggleUI() {
    const btn = document.getElementById('users-cumul-toggle');
    if (!btn) return;
    const ACTIVE = 'px-3 py-1 rounded-md text-sm font-medium bg-white text-indigo-700 shadow-sm transition-all';
    const INACTIVE = 'px-3 py-1 rounded-md text-sm font-medium text-gray-500 hover:text-gray-700 transition-all';
    btn.querySelectorAll('[data-view]').forEach(pill => {
        pill.className = (pill.getAttribute('data-view') === usersModalView) ? ACTIVE : INACTIVE;
    });
}

function openUsersEvolutionModal() {
    const modal = document.getElementById('users-evolution-modal');
    modal.classList.remove('hidden');

    usersModalData = calculateMonthlyUsers();

    // Summary KPIs
    const totalUnique = usersModalData.length > 0
        ? usersModalData[usersModalData.length - 1].cumulativeUsers
        : 0;
    const lastMonthNew = usersModalData.length > 0
        ? usersModalData[usersModalData.length - 1].newUsers
        : 0;
    const lastLabel = usersModalData.length > 0
        ? usersModalData[usersModalData.length - 1].label
        : '—';
    const peakMonth = usersModalData.reduce((best, d) =>
        d.activeUsers > (best ? best.activeUsers : 0) ? d : best, null);

    document.getElementById('users-modal-total').textContent =
        new Intl.NumberFormat('fr-FR').format(totalUnique);
    document.getElementById('users-modal-new-last').textContent =
        new Intl.NumberFormat('fr-FR').format(lastMonthNew);
    document.getElementById('users-modal-new-label').textContent =
        `nouveaux en ${lastLabel}`;
    document.getElementById('users-modal-peak').textContent =
        peakMonth ? new Intl.NumberFormat('fr-FR').format(peakMonth.activeUsers) : '—';
    document.getElementById('users-modal-peak-label').textContent =
        peakMonth ? `actifs en ${peakMonth.label}` : 'utilisateurs actifs';

    // Reset toggle
    usersModalView = 'monthly';
    updateUsersToggleUI();
    buildUsersChart();
}

function closeUsersEvolutionModal() {
    document.getElementById('users-evolution-modal').classList.add('hidden');
    if (usersEvolutionChart) {
        usersEvolutionChart.destroy();
        usersEvolutionChart = null;
    }
}

(function initUsersModal() {
    const usersCard = document.getElementById('users-card');
    if (usersCard) usersCard.addEventListener('click', openUsersEvolutionModal);

    const closeBtn = document.getElementById('close-users-modal');
    if (closeBtn) closeBtn.addEventListener('click', closeUsersEvolutionModal);

    const modal = document.getElementById('users-evolution-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeUsersEvolutionModal();
        });
    }

    const toggleBtn = document.getElementById('users-cumul-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            const pill = e.target.closest('[data-view]');
            if (!pill) return;
            usersModalView = pill.getAttribute('data-view');
            updateUsersToggleUI();
            buildUsersChart();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeUsersListModal();
            closeUsersEvolutionModal();
            closeGainEvolutionModal();
        }
    });
})();

// ==================== GAIN EVOLUTION MODAL ====================

let gainEvolutionChart = null;

/**
 * Helper: extract YYYY-MM key from a date string.
 * Uses parseFrenchDate to handle both ISO and French date formats (CSV data).
 */
function getMonthKey(dateString) {
    const date = parseFrenchDate(dateString);
    if (!date || isNaN(date.getTime())) return null;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

/**
 * Calculate monthly gains from all data sources using the exact same logic
 * as updateKPIs (full history, no active filters applied).
 */
function calculateMonthlyGains() {
    const monthlyData = {};

    const ensureMonth = (key) => {
        if (!monthlyData[key]) {
            monthlyData[key] = {
                descriptifCount: 0,   // unique contracts (first occurrence only)
                aiContacts: 0,
                totalPages: 0,
                chatBTPMessages: 0,
                expertBTPMessages: 0,
                chatCitaeMessages: 0,
                expertCitaeMessages: 0,
                chatBTPDiagMessages: 0,
                expertBTPDiagMessages: 0,
                chatBtpSpsMessages: 0,
                expertBtpSpsMessages: 0,
                autocontactSpsContacts: 0,
                nfHabitatPoints: 0,
                aoAnalyses: 0,
            };
        }
    };

    // ── Descriptif ─────────────────────────────────────────────────────────────
    // Mirror processDescriptifData: exclude YIELD, type=DESCRIPTIF_TYPE, ≥100 words.
    // Each contract is attributed to the FIRST month it generated a qualifying
    // descriptif → sum-of-months == all-time unique total (matches the index page).
    const descriptifFirstMonth = new Map(); // contractNumber → earliest valid month key
    getFilteredData(descriptifData)
        .filter(item =>
            isDescriptifRow(item) &&
            item.contractNumber &&
            item.contractNumber.trim() !== '' &&
            !item.contractNumber.toUpperCase().includes('YIELD')
        )
        .forEach(item => {
            const key = getMonthKey(item.createdAt);
            if (!key) return;
            const wordCount = (typeof item.descriptionWordCount === 'number')
                ? item.descriptionWordCount
                : countWords(extractText(item.description || ''));
            if (wordCount < 100) return;
            const prev = descriptifFirstMonth.get(item.contractNumber);
            if (!prev || key < prev) {
                descriptifFirstMonth.set(item.contractNumber, key);
            }
        });

    descriptifFirstMonth.forEach((key) => {
        ensureMonth(key);
        monthlyData[key].descriptifCount += 1;
    });

    // ── Autocontact ─────────────────────────────────────────────────────────────
    // Mirror processAutocontactData: exclude YIELD, fromAI=true, count each item.
    getFilteredData(autocontactData)
        .filter(item =>
            !item.contractNumber.toUpperCase().includes('YIELD') &&
            item.fromAI
        )
        .forEach(item => {
            const key = getMonthKey(item.createdAt);
            if (!key) return;
            ensureMonth(key);
            monthlyData[key].aiContacts += 1;
        });

    // ── Comparateur ─────────────────────────────────────────────────────────────
    getFilteredData(comparateurData).forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].totalPages += (item.maxPage || 0);
    });

    // ── Chat / Expert BTP Consultants ───────────────────────────────────────────
    getFilteredData(chatBTPData).forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].chatBTPMessages += (item.messagesLength || 0);
    });

    getFilteredData(expertBTPData).forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].expertBTPMessages += (item.messagesLength || 0);
    });

    // ── Chat / Expert Citae ──────────────────────────────────────────────────────
    getFilteredData(chatCitaeData).forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].chatCitaeMessages += (item.messagesLength || 0);
    });

    getFilteredData(expertCitaeData).forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].expertCitaeMessages += (item.messagesLength || 0);
    });

    // ── Chat / Expert BTP Diagnostics ────────────────────────────────────────────
    getFilteredData(chatBTPDiagData).forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].chatBTPDiagMessages += (item.messagesLength || 0);
    });

    getFilteredData(expertBTPDiagData).forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].expertBTPDiagMessages += (item.messagesLength || 0);
    });

    // ── Chat / Expert BTP Consultants SPS ───────────────────────────────────
    getFilteredData(chatBtpSpsData).forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].chatBtpSpsMessages += (item.messagesLength || 0);
    });

    getFilteredData(expertBtpSpsData).forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].expertBtpSpsMessages += (item.messagesLength || 0);
    });

    // ── Autocontact SPS ──────────────────────────────────────────────────────
    // Mirror processAutocontactSpsData : un contact créé via l'IA = une ligne.
    getFilteredData(autocontactSpsData)
        .filter(item => item.fromAI)
        .forEach(item => {
            const key = getMonthKey(item.createdAt);
            if (!key) return;
            ensureMonth(key);
            monthlyData[key].autocontactSpsContacts += 1;
        });

    // ── NF Habitat ───────────────────────────────────────────────────────────────
    getFilteredData(nfHabitatData).filter(isNFHabitatItem).forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].nfHabitatPoints += (item.pointCount || 0);
    });

    // ── Analyse AO ───────────────────────────────────────────────────────────────
    // Une "analyse" = un lead créé. On l'attribue au mois de détection du marché,
    // cohérent avec le funnel mensuel de analyse-ao.html.
    aoMarches.forEach(m => {
        const key = getMonthKey(m.dateDetection);
        if (!key) return;
        const leads = (m.leads || []).length;
        if (leads === 0) return;
        ensureMonth(key);
        monthlyData[key].aoAnalyses += leads;
    });

    // ── Build sorted result ──────────────────────────────────────────────────────
    const sortedMonths = Object.keys(monthlyData).sort();
    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

    return sortedMonths.map(key => {
        const d = monthlyData[key];
        const gains = calculateGains(
            d.descriptifCount,   // unique contracts (first occurrence) — matches index page
            d.aiContacts,
            d.totalPages,
            d.chatBTPMessages,
            d.expertBTPMessages,
            d.chatCitaeMessages,
            d.expertCitaeMessages,
            d.chatBTPDiagMessages,
            d.expertBTPDiagMessages,
            d.nfHabitatPoints,
            d.aoAnalyses,
            d.chatBtpSpsMessages,
            d.expertBtpSpsMessages,
            d.autocontactSpsContacts
        );
        const [year, month] = key.split('-');
        return {
            key,
            label: `${monthNames[parseInt(month) - 1]} ${year}`,
            hours: gains.timeGainHours,
            euros: gains.euroGain,
            hoursDescriptif:    gains.timeGainHoursDescriptif,
            hoursAutocontact:   gains.timeGainHoursAutocontact,
            hoursComparateur:   gains.timeGainHoursComparateur,
            hoursChatBTP:       gains.timeGainHoursChatBTP,
            hoursExpertBTP:     gains.timeGainHoursExpertBTP,
            hoursChatCitae:     gains.timeGainHoursChatCitae,
            hoursExpertCitae:   gains.timeGainHoursExpertCitae,
            hoursChatBTPDiag:   gains.timeGainHoursChatBTPDiag,
            hoursExpertBTPDiag: gains.timeGainHoursExpertBTPDiag,
            hoursChatBtpSps:    gains.timeGainHoursChatBtpSps,
            hoursExpertBtpSps:  gains.timeGainHoursExpertBtpSps,
            hoursAutocontactSps: gains.timeGainHoursAutocontactSps,
            hoursNFHabitat:     gains.timeGainHoursNFHabitat,
            hoursAO:            gains.timeGainHoursAO,
        };
    });
}

/**
 * Gain agrégé pour la fenêtre de date active, calculé via le MÊME moteur mensuel
 * que les jauges (calculateMonthlyGains : attribution premier-mois par RICT, pas de
 * double comptage inter-mois). Garantit que la carte « Gain total estimé » et les
 * jauges « Objectifs de gain » donnent le même chiffre pour une même période.
 * Granularité = mois : une plage partielle inclut le(s) mois entier(s) qu'elle touche.
 * Les filtres filiale / direction / agence restent appliqués (seule la date est neutralisée).
 */
function calculateWindowedGains() {
    const saved = { startDate: dateFilter.startDate, endDate: dateFilter.endDate };
    dateFilter.startDate = null;
    dateFilter.endDate = null;
    const monthly = calculateMonthlyGains();
    dateFilter.startDate = saved.startDate;
    dateFilter.endDate = saved.endDate;

    const startKey = saved.startDate ? getMonthKey(saved.startDate) : null;
    const endKey   = saved.endDate   ? getMonthKey(saved.endDate)   : null;

    const acc = {
        timeGainHours: 0, euroGain: 0, percentGain: 0,
        timeGainHoursDescriptif: 0, timeGainHoursAutocontact: 0, timeGainHoursComparateur: 0,
        timeGainHoursChatBTP: 0, timeGainHoursExpertBTP: 0,
        timeGainHoursChatCitae: 0, timeGainHoursExpertCitae: 0,
        timeGainHoursChatBTPDiag: 0, timeGainHoursExpertBTPDiag: 0,
        timeGainHoursChatBtpSps: 0, timeGainHoursExpertBtpSps: 0,
        timeGainHoursAutocontactSps: 0,
        timeGainHoursNFHabitat: 0, timeGainHoursAO: 0,
    };
    monthly.forEach(m => {
        if (startKey && m.key < startKey) return;
        if (endKey && m.key > endKey) return;
        acc.timeGainHours            += m.hours;
        acc.euroGain                 += m.euros;
        acc.timeGainHoursDescriptif  += m.hoursDescriptif;
        acc.timeGainHoursAutocontact += m.hoursAutocontact;
        acc.timeGainHoursComparateur += m.hoursComparateur;
        acc.timeGainHoursChatBTP     += m.hoursChatBTP;
        acc.timeGainHoursExpertBTP   += m.hoursExpertBTP;
        acc.timeGainHoursChatCitae   += m.hoursChatCitae;
        acc.timeGainHoursExpertCitae += m.hoursExpertCitae;
        acc.timeGainHoursChatBTPDiag += m.hoursChatBTPDiag;
        acc.timeGainHoursExpertBTPDiag += m.hoursExpertBTPDiag;
        acc.timeGainHoursChatBtpSps  += m.hoursChatBtpSps;
        acc.timeGainHoursExpertBtpSps += m.hoursExpertBtpSps;
        acc.timeGainHoursAutocontactSps += m.hoursAutocontactSps;
        acc.timeGainHoursNFHabitat   += m.hoursNFHabitat;
        acc.timeGainHoursAO          += m.hoursAO;
    });
    acc.percentGain = (acc.timeGainHours / (TOTAL_EFFECTIF * ANNUAL_HOURS)) * 100;
    return acc;
}

/**
 * Publie un instantané compact des gains, consommé par la page « Pilotage
 * économique » (pilotage-ia.html). Cette page a besoin des heures gagnées et
 * des utilisateurs actifs par mois, mais ne recharge pas les 15 sources : elle
 * relit cet instantané.
 *
 * sessionStorage et non localStorage : effacé à la fermeture de l'onglet, donc
 * aucune donnée d'usage ne persiste sur le disque. Corollaire assumé : le lien
 * vers la page macro doit naviguer dans le MÊME onglet.
 *
 * L'instantané est toujours calculé SANS filtre — date, filiale, direction et
 * agence sont neutralisés puis restaurés — pour que la page macro reçoive le
 * périmètre groupe quel que soit l'état du dashboard au moment du
 * rafraîchissement. Même technique que calculateWindowedGains pour les dates,
 * étendue aux filtres d'organisation qui sont lus directement dans le DOM.
 */
// Exécute fn avec TOUS les filtres neutralisés (date, filiale, direction,
// agence), puis les restaure — même en cas d'exception. Utilisé par les
// instantanés publiés pour les pages macro, qui veulent le périmètre groupe
// quel que soit l'état du dashboard.
function withFiltersCleared(fn) {
    const savedDates = { startDate: dateFilter.startDate, endDate: dateFilter.endDate };
    const savedOrg = {
        filiale: filialeFilterEl ? filialeFilterEl.value : '',
        direction: directionFilterEl ? directionFilterEl.value : '',
        agency: agencyFilterEl ? agencyFilterEl.value : '',
    };
    try {
        dateFilter.startDate = null;
        dateFilter.endDate = null;
        if (filialeFilterEl) filialeFilterEl.value = '';
        if (directionFilterEl) directionFilterEl.value = '';
        if (agencyFilterEl) agencyFilterEl.value = '';
        return fn();
    } finally {
        dateFilter.startDate = savedDates.startDate;
        dateFilter.endDate = savedDates.endDate;
        if (filialeFilterEl) filialeFilterEl.value = savedOrg.filiale;
        if (directionFilterEl) directionFilterEl.value = savedOrg.direction;
        if (agencyFilterEl) agencyFilterEl.value = savedOrg.agency;
    }
}

function publishGainsSnapshot() {
    if (typeof sessionStorage === 'undefined') return;

    try {
        withFiltersCleared(() => {
            const byMonth = {};
            calculateMonthlyGains().forEach(m => {
                byMonth[m.key] = { hours: m.hours, users: 0 };
            });
            const monthlyUsers = calculateMonthlyUsers();
            monthlyUsers.forEach(m => {
                if (!byMonth[m.key]) byMonth[m.key] = { hours: 0, users: 0 };
                byMonth[m.key].users = m.activeUsers;
            });

            sessionStorage.setItem('kpi_snapshot_gains', JSON.stringify({
                generatedAt: new Date().toISOString(),
                effectif: TOTAL_EFFECTIF,
                byMonth,
                totalUsersAllTime: monthlyUsers.length
                    ? monthlyUsers[monthlyUsers.length - 1].cumulativeUsers
                    : 0,
            }));
        });
    } catch (e) {
        // Un instantané manquant dégrade proprement la page macro (deux KPIs en
        // « — ») : jamais de quoi interrompre le chargement du dashboard.
        console.warn('Instantané des gains non publié.', e);
    }
}

/**
 * Publie l'instantané consommé par la page « COPIL IA » (copil-ia.html).
 *
 * Le COPIL de septembre 2026 a décidé de piloter les modules sur l'ADOPTION
 * MENSUELLE (actifs du mois ÷ population concernée) et la SYSTÉMATISATION
 * (part des dossiers des actifs du mois traités avec le module), ventilées
 * par grand métier : pôle Conformité (CT, SPS, Diag) et PPI (Citae). Ce n'est
 * PAS le même calcul que les tuiles du dashboard : ici on suit des
 * utilisateurs et des dossiers mois par mois.
 *
 * app.js ne fait que normaliser chaque source en événements
 * { email, month, dossier, requests } (et, quand la source porte aussi les
 * dossiers SANS IA, en parc { email, month, dossier }). Le calcul des séries
 * est dans shared/copil.js, testé en Node.
 *
 * Seuls des agrégats sont stockés (aucun email) : sessionStorage, même
 * onglet — mêmes règles que kpi_snapshot_gains.
 */
function publishCopilSnapshot() {
    if (typeof sessionStorage === 'undefined' || typeof KPICopil === 'undefined') return;

    try {
        withFiltersCleared(() => {
            const notYield = item => !(item.contractNumber || '').toUpperCase().includes('YIELD');
            const ev = (item, dossier, requests) => ({
                email: item.email,
                month: getMonthKey(item.createdAt),
                dossier: dossier || '',
                requests,
            });
            const parcOf = items => items
                .filter(item => item.contractNumber)
                .map(item => ({ email: item.email, month: getMonthKey(item.createdAt), dossier: item.contractNumber }));
            // Les sources AIDeliverable / AnalyticEvent portent plusieurs lignes
            // par livrable (Notice + Report) : un livrable = une utilisation.
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
                : countWords(extractText(item.description || ''));
            const fromDomain = d => item => (item.email || '').includes(d);
            const any = () => true;

            // Descriptif — seuil retenu en COPIL : au-delà de 100 mots l'IA
            // apporte une valeur réelle. Il s'applique aux dossiers ET aux
            // utilisateurs (un descriptif plus court ne fait pas un adoptant).
            const rict = descriptifData.filter(item => notYield(item) && item.contractNumber);
            const descriptifIA = rict.filter(item => isDescriptifRow(item) && wordCount(item) >= 100);

            const autocontactCT = autocontactData.filter(notYield);
            const autocontactCTIA = autocontactCT.filter(item => item.fromAI && fromDomain('@btp-consultants.fr')(item));

            const cctpOk = uniqueDeliverables(cctpData).filter(item => item.status !== 'ERROR');

            // Usage libre : une requête = un message. Trois séries par métier :
            // l'ensemble (kind 'libre') et son détail chat / expert (kind
            // 'libre-detail', parent = l'ensemble), pour voir lequel tire une
            // hausse ou une baisse.
            const messages = (data, keep) => data.filter(keep).map(item => ev(item, '', item.messagesLength || 0));
            const usageLibre = (metier, suffix, chat, expert, keep) => {
                const parent = `libre-${suffix}`;
                const c = messages(chat, keep), e = messages(expert, keep);
                return [
                    { id: parent, label: 'Usage libre (chat + expert)', metier, kind: 'libre', unite: 'message',
                      events: c.concat(e), parc: null },
                    { id: `chat-${suffix}`, label: 'Chat projet', metier, kind: 'libre-detail', parent, unite: 'message',
                      events: c, parc: null },
                    { id: `expert-${suffix}`, label: 'Expert technique', metier, kind: 'libre-detail', parent, unite: 'message',
                      events: e, parc: null },
                ];
            };

            const sources = [
                { id: 'descriptif', label: 'Descriptif RICT', metier: 'CT', kind: 'module', unite: 'RICT',
                  events: descriptifIA.map(i => ev(i, i.contractNumber, 1)), parc: parcOf(rict) },
                { id: 'analyse-cctp', label: 'Analyse CCTP', metier: 'CT', kind: 'module', unite: 'affaire',
                  events: cctpOk.map(i => ev(i, i.contractNumber, 1)), parc: null },
                { id: 'autocontact', label: 'Autocontact', metier: 'CT', kind: 'module', unite: 'affaire',
                  events: autocontactCTIA.map(i => ev(i, i.contractNumber, 1)), parc: parcOf(autocontactCT) },
                { id: 'comparateur', label: "Comparateur d'indices", metier: 'CT', kind: 'module', unite: 'affaire',
                  events: comparateurData.map(i => ev(i, i.contractNumber, 1)), parc: null },
                { id: 'analyse-geo', label: 'Analyse géotechnique', metier: 'CT', kind: 'module', unite: 'affaire',
                  events: uniqueDeliverables(geotechData).map(i => ev(i, i.contractNumber, 1)), parc: null },
                { id: 'analyse-acou', label: 'Analyse acoustique', metier: 'CT', kind: 'module', unite: 'affaire',
                  events: uniqueDeliverables(acoustiqueData).map(i => ev(i, i.contractNumber, 1)), parc: null },
                ...usageLibre('CT', 'ct', chatBTPData, expertBTPData, fromDomain('@btp-consultants.fr')),

                { id: 'autocontact-sps', label: 'Autocontact SPS', metier: 'SPS', kind: 'module', unite: 'affaire',
                  events: autocontactSpsData.filter(i => i.fromAI).map(i => ev(i, i.contractNumber, 1)),
                  parc: parcOf(autocontactSpsData) },
                ...usageLibre('SPS', 'sps', chatBtpSpsData, expertBtpSpsData, any),

                ...usageLibre('DIAG', 'diag', chatBTPDiagData, expertBTPDiagData, fromDomain('@btp-diagnostics.fr')),

                // PPI : seule Citae est tracée (Nextiim et MBAcity pas encore).
                { id: 'nf-habitat', label: 'NF Habitat', metier: 'PPI', kind: 'module', unite: 'projet',
                  events: nfHabitatData.filter(isNFHabitatItem).map(i => ev(i, i.projectId, 1)), parc: null },
                ...usageLibre('PPI', 'ppi', chatCitaeData, expertCitaeData, fromDomain('@citae.fr')),
            ];

            // Heures gagnées par grand métier : le COPIL ne pilote plus les
            // modules en heures, mais la cible mensuelle reste suivie.
            const hoursByMonth = {};
            calculateMonthlyGains().forEach(m => {
                hoursByMonth[m.key] = {
                    total: m.hours,
                    CT: m.hoursDescriptif + m.hoursAutocontact + m.hoursComparateur
                        + m.hoursChatBTP + m.hoursExpertBTP + m.hoursAO,
                    SPS: m.hoursChatBtpSps + m.hoursExpertBtpSps + m.hoursAutocontactSps,
                    DIAG: m.hoursChatBTPDiag + m.hoursExpertBTPDiag,
                    PPI: m.hoursChatCitae + m.hoursExpertCitae + m.hoursNFHabitat,
                };
            });

            // Plage commune : du premier mois vu au mois en cours, sans trou
            // (un mois à zéro doit rester visible sur les courbes).
            const seenMonths = Object.keys(hoursByMonth);
            sources.forEach(src => src.events.forEach(e => { if (e.month) seenMonths.push(e.month); }));
            const now = new Date();
            const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const firstKey = seenMonths.length ? seenMonths.reduce((a, b) => (a < b ? a : b)) : currentKey;
            const months = KPICopil.monthRange(firstKey, currentKey);

            // Une série ne commence qu'au premier usage : avant, une adoption à
            // 0 % se lirait comme un échec.
            const trimmed = (series) => {
                const firstUse = series.findIndex(r => r.activeUsers > 0);
                return {
                    startMonth: firstUse >= 0 ? series[firstUse].month : null,
                    series: firstUse >= 0 ? series.slice(firstUse) : [],
                };
            };

            const modules = sources.map(src => Object.assign({
                id: src.id, label: src.label, metier: src.metier, kind: src.kind, unite: src.unite,
                parent: src.parent || null,
                hasParc: Array.isArray(src.parc),
            }, trimmed(KPICopil.buildModuleSeries(src.events, src.parc, months))));

            // Par métier, tous modules confondus : un utilisateur compte une
            // fois par mois quel que soit le nombre de modules utilisés.
            const metiers = KPICopil.METIER_ORDER.map(k => Object.assign({
                id: k, label: KPICopil.METIERS[k].label, metier: k,
            }, trimmed(KPICopil.buildModuleSeries(
                [].concat(...sources.filter(src => src.metier === k && src.kind !== 'libre-detail')
                    .map(src => src.events)), null, months))));

            sessionStorage.setItem('kpi_snapshot_copil', JSON.stringify({
                generatedAt: new Date().toISOString(),
                months,
                // CT : population_cible.csv (contrôleurs par agence). Les autres
                // métiers : KPICopil.POPULATIONS (null tant que non renseignée).
                populations: Object.assign({}, KPICopil.POPULATIONS, { CT: TOTAL_EFFECTIF }),
                hoursByMonth,
                metiers,
                modules,
            }));
        });
    } catch (e) {
        // Même règle que l'instantané des gains : la page COPIL se dégrade
        // (message « ouvrir d'abord la plateforme »), le dashboard continue.
        console.warn('Instantané COPIL non publié.', e);
    }
}

/**
 * Calculate gains for the current calendar month and year, ignoring any active
 * date filter (org filters still apply). Used by the objective gauges.
 */
function calculateObjectiveGains(selectedYear, selectedMonth) {
    const savedDateFilter = { ...dateFilter };
    dateFilter.startDate = null;
    dateFilter.endDate = null;

    const monthlyData = calculateMonthlyGains();

    dateFilter.startDate = savedDateFilter.startDate;
    dateFilter.endDate = savedDateFilter.endDate;

    const yearStr = String(selectedYear);
    const monthKey = `${yearStr}-${String(selectedMonth).padStart(2, '0')}`;

    let monthlyHours = 0;
    let annualHours = 0;
    monthlyData.forEach(entry => {
        if (entry.key === monthKey) monthlyHours = entry.hours;
        // Annual = YTD: sum all months in selected year up to and including selected month
        if (entry.key.startsWith(yearStr) && entry.key <= monthKey) annualHours += entry.hours;
    });

    return { monthlyHours, annualHours };
}

function populateGaugeSelectors() {
    const now = new Date();
    const monthEl = document.getElementById('gauge-month-select');
    const yearEl  = document.getElementById('gauge-year-select');
    if (!monthEl || !yearEl) return;

    // Default month to current month
    monthEl.value = String(now.getMonth() + 1);

    // Build year list from available data (ignoring any date filter)
    const savedDateFilter = { ...dateFilter };
    dateFilter.startDate = null;
    dateFilter.endDate = null;
    const months = calculateMonthlyGains();
    dateFilter.startDate = savedDateFilter.startDate;
    dateFilter.endDate = savedDateFilter.endDate;

    const yearsInData = [...new Set(months.map(m => m.key.split('-')[0]))].sort();
    const currentYearStr = String(now.getFullYear());
    if (!yearsInData.includes(currentYearStr)) yearsInData.push(currentYearStr);

    yearEl.innerHTML = yearsInData
        .map(y => `<option value="${y}" ${y === currentYearStr ? 'selected' : ''}>${y}</option>`)
        .join('');

    const refresh = () => updateObjectiveGauges();
    monthEl.addEventListener('change', refresh);
    yearEl.addEventListener('change', refresh);
}

// ==================== OBJECTIVE GAUGES ====================

function updateGaugeSVG(arcId, valueId, subId, badgeId, labelId, value, target, labelText, subText) {
    const pct = value / target;
    const capped = Math.min(pct, 1);

    const color = pct >= 1 ? '#f97316'
                : pct >= 0.8 ? '#22c55e'
                : pct >= 0.5 ? '#3b82f6'
                : '#94a3b8';

    const cx = 100, cy = 100, r = 80;
    let arcPath;
    if (capped <= 0) {
        arcPath = `M ${cx - r} ${cy}`;
    } else {
        const angle = Math.PI * (1 + capped);
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        // Always small arc: a 180° gauge never spans more than half a circle
        arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
    }

    const arcEl = document.getElementById(arcId);
    if (arcEl) {
        arcEl.setAttribute('d', arcPath);
        arcEl.setAttribute('stroke', color);
    }

    const pctStr = pct >= 1
        ? `${(pct * 100).toFixed(0)}% ✓`
        : `${(pct * 100).toFixed(0)}%`;

    const surplusHours = Math.round(value - target);
    const subDisplay = pct >= 1
        ? `+${formatNumber(surplusHours)} h au-dessus`
        : subText;

    document.getElementById(valueId).textContent = `${formatNumber(Math.round(value))} h`;
    document.getElementById(subId).textContent = subDisplay;
    document.getElementById(labelId).textContent = labelText;

    const badge = document.getElementById(badgeId);
    if (badge) {
        badge.textContent = pctStr;
        const classes = pct >= 1   ? 'bg-orange-100 text-orange-700'
                      : pct >= 0.8 ? 'bg-green-100 text-green-700'
                      : pct >= 0.5 ? 'bg-blue-100 text-blue-700'
                      :              'bg-gray-100 text-gray-500';
        badge.className = `px-2.5 py-1 text-xs font-semibold rounded-full ${classes}`;
    }
}

function updateObjectiveGauges() {
    const monthEl = document.getElementById('gauge-month-select');
    const yearEl  = document.getElementById('gauge-year-select');
    const now = new Date();
    const selectedMonth = monthEl ? parseInt(monthEl.value) : now.getMonth() + 1;
    const selectedYear  = yearEl  ? parseInt(yearEl.value)  : now.getFullYear();

    const { monthlyHours, annualHours } = calculateObjectiveGains(selectedYear, selectedMonth);

    const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
                        'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    const monthLabel = monthNames[selectedMonth - 1];

    const isCurrentYear = selectedYear === now.getFullYear();
    const annualLabel = isCurrentYear
        ? `YTD ${selectedYear} (Jan → ${monthLabel})`
        : `Bilan ${selectedYear}`;

    updateGaugeSVG(
        'gauge-monthly-arc', 'gauge-monthly-value', 'gauge-monthly-sub',
        'gauge-monthly-badge', 'gauge-monthly-label',
        monthlyHours, KPICopil.CIBLES.gainMensuelHeures,
        `${monthLabel} ${selectedYear}`,
        `sur ${formatNumber(KPICopil.CIBLES.gainMensuelHeures)} h`
    );

    updateGaugeSVG(
        'gauge-annual-arc', 'gauge-annual-value', 'gauge-annual-sub',
        'gauge-annual-badge', 'gauge-annual-label',
        annualHours, KPICopil.CIBLES.gainAnnuelHeures,
        annualLabel,
        `sur ${formatNumber(KPICopil.CIBLES.gainAnnuelHeures)} h`
    );
}

let gainModalIsCumulative = false;
let gainModalData = null; // cached monthly gains

function buildGainChart() {
    const canvas = document.getElementById('gainEvolutionChart');
    if (!canvas || !gainModalData) return;

    const isCumul = gainModalIsCumulative;

    // Feature definitions: key in gainModalData, display label, color
    const features = [
        { key: 'hoursDescriptif',    label: 'Descriptif',          color: 'rgba(59, 130, 246, 0.85)'  },
        { key: 'hoursAutocontact',   label: 'Autocontact',         color: 'rgba(16, 185, 129, 0.85)'  },
        { key: 'hoursComparateur',   label: 'Comparateur',         color: 'rgba(245, 158, 11, 0.85)'  },
        { key: 'hoursChatBTP',       label: 'Chat BTP',            color: 'rgba(139, 92, 246, 0.85)'  },
        { key: 'hoursExpertBTP',     label: 'Expert BTP',          color: 'rgba(99, 102, 241, 0.85)'  },
        { key: 'hoursChatCitae',     label: 'Chat Citae',          color: 'rgba(20, 184, 166, 0.85)'  },
        { key: 'hoursExpertCitae',   label: 'Expert Citae',        color: 'rgba(6, 182, 212, 0.85)'   },
        { key: 'hoursChatBTPDiag',   label: 'Chat BTP Diag',       color: 'rgba(244, 63, 94, 0.85)'   },
        { key: 'hoursExpertBTPDiag', label: 'Expert BTP Diag',     color: 'rgba(251, 146, 60, 0.85)'  },
        { key: 'hoursChatBtpSps',    label: 'Chat SPS',            color: 'rgba(14, 165, 233, 0.85)'  },
        { key: 'hoursExpertBtpSps',  label: 'Expert SPS',          color: 'rgba(2, 132, 199, 0.85)'   },
        { key: 'hoursAutocontactSps', label: 'Autocontact SPS',    color: 'rgba(103, 232, 249, 0.85)' },
        { key: 'hoursNFHabitat',     label: 'NF Habitat',          color: 'rgba(52, 211, 153, 0.85)'  },
        { key: 'hoursAO',            label: 'Analyse AO',          color: 'rgba(217, 70, 239, 0.85)'  },
    ];

    // Build cumulative or monthly series per feature + euros line
    const buildSeries = (fieldKey) => {
        if (isCumul) {
            let cum = 0;
            return gainModalData.map(d => { cum += (d[fieldKey] || 0); return Math.round(cum * 100) / 100; });
        }
        return gainModalData.map(d => Math.round((d[fieldKey] || 0) * 100) / 100);
    };

    let eurosData;
    if (isCumul) {
        let cumE = 0;
        eurosData = gainModalData.map(d => { cumE += d.euros; return Math.round(cumE); });
    } else {
        eurosData = gainModalData.map(d => Math.round(d.euros));
    }

    const labels = gainModalData.map(d => d.label);
    const modeLabel = isCumul ? ' (cumulé)' : ' (mensuel)';

    if (gainEvolutionChart) {
        gainEvolutionChart.destroy();
        gainEvolutionChart = null;
    }

    const ctx = canvas.getContext('2d');

    // One stacked bar dataset per feature + euros line on top
    const barDatasets = features.map(f => ({
        label: f.label,
        data: buildSeries(f.key),
        backgroundColor: f.color,
        borderColor: f.color.replace('0.85', '1'),
        borderWidth: 0,
        stack: 'hours',
        yAxisID: 'yHours',
        order: 2,
    }));

    gainEvolutionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                ...barDatasets,
                {
                    label: `Gain en €${modeLabel}`,
                    data: eurosData,
                    type: 'line',
                    borderColor: 'rgba(139, 92, 246, 1)',
                    backgroundColor: 'rgba(139, 92, 246, 0.08)',
                    borderWidth: 2.5,
                    fill: isCumul,
                    tension: 0.35,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: 'rgba(139, 92, 246, 1)',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    yAxisID: 'yEuros',
                    order: 1,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        font: { size: 12, weight: '500' },
                        color: '#1F2937',
                        padding: 14,
                        usePointStyle: true,
                        pointStyle: 'rectRounded',
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    titleColor: '#F9FAFB',
                    bodyColor: '#E5E7EB',
                    borderColor: 'rgba(75, 85, 99, 0.4)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            const label = context.dataset.label || '';
                            const value = context.parsed.y;
                            if (context.dataset.yAxisID === 'yHours') {
                                const h = Math.round(value * 10) / 10;
                                return ` ${label} : ${new Intl.NumberFormat('fr-FR').format(h)} h`;
                            }
                            return ` ${label} : ${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)}`;
                        },
                        footer: function(tooltipItems) {
                            // Sum of all bar segments = total hours for the month
                            const total = tooltipItems
                                .filter(i => i.dataset.yAxisID === 'yHours')
                                .reduce((sum, i) => sum + (i.parsed.y || 0), 0);
                            if (total <= 0) return '';
                            return `Total : ${new Intl.NumberFormat('fr-FR').format(Math.round(total * 10) / 10)} h`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11 }, color: '#6B7280' },
                    stacked: true,
                },
                yHours: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
                    stacked: true,
                    grid: { color: 'rgba(229, 231, 235, 0.8)' },
                    title: { display: true, text: 'Heures (h)', font: { size: 12, weight: 'bold' }, color: '#3B82F6' },
                    ticks: {
                        font: { size: 11 }, color: '#3B82F6',
                        callback: v => `${new Intl.NumberFormat('fr-FR').format(Math.round(v))} h`
                    }
                },
                yEuros: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'Euros (€)', font: { size: 12, weight: 'bold' }, color: '#8B5CF6' },
                    ticks: {
                        font: { size: 11 }, color: '#8B5CF6',
                        callback: v => `${new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(v)} €`
                    }
                }
            }
        }
    });
}

function openGainEvolutionModal() {
    const modal = document.getElementById('gain-evolution-modal');
    modal.classList.remove('hidden');

    // (Re)compute monthly data
    gainModalData = calculateMonthlyGains();

    // Update summary KPIs (always all-time totals)
    const totalHours = gainModalData.reduce((a, d) => a + d.hours, 0);
    const totalEuros = gainModalData.reduce((a, d) => a + d.euros, 0);
    document.getElementById('gain-modal-total-heures').textContent =
        `${new Intl.NumberFormat('fr-FR').format(Math.round(totalHours))} h`;
    document.getElementById('gain-modal-total-euros').textContent =
        new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(totalEuros);

    // Reset toggle to monthly view when opening
    gainModalIsCumulative = false;
    const toggleBtn = document.getElementById('gain-cumul-toggle');
    if (toggleBtn) {
        toggleBtn.setAttribute('data-active', 'monthly');
        updateGainToggleUI();
    }

    buildGainChart();
}

function closeGainEvolutionModal() {
    document.getElementById('gain-evolution-modal').classList.add('hidden');
    if (gainEvolutionChart) {
        gainEvolutionChart.destroy();
        gainEvolutionChart = null;
    }
}

function updateGainToggleUI() {
    const btn = document.getElementById('gain-cumul-toggle');
    if (!btn) return;
    const isMonthly = !gainModalIsCumulative;
    // Monthly pill
    const monthlyPill = btn.querySelector('[data-view="monthly"]');
    const cumulPill   = btn.querySelector('[data-view="cumul"]');
    if (monthlyPill && cumulPill) {
        if (isMonthly) {
            monthlyPill.className = 'px-3 py-1 rounded-md text-sm font-medium bg-white text-blue-700 shadow-sm transition-all';
            cumulPill.className   = 'px-3 py-1 rounded-md text-sm font-medium text-gray-500 hover:text-gray-700 transition-all';
        } else {
            cumulPill.className   = 'px-3 py-1 rounded-md text-sm font-medium bg-white text-blue-700 shadow-sm transition-all';
            monthlyPill.className = 'px-3 py-1 rounded-md text-sm font-medium text-gray-500 hover:text-gray-700 transition-all';
        }
    }
}

// Wire up the gain card click (DOM already loaded since script is at bottom of body)
(function initGainModal() {
    const gainCard = document.getElementById('gain-heures-card');
    if (gainCard) gainCard.addEventListener('click', openGainEvolutionModal);

    const closeBtn = document.getElementById('close-gain-modal');
    if (closeBtn) closeBtn.addEventListener('click', closeGainEvolutionModal);

    const modal = document.getElementById('gain-evolution-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeGainEvolutionModal();
        });
    }

    // Toggle mensuel/cumulé
    const toggleBtn = document.getElementById('gain-cumul-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            const pill = e.target.closest('[data-view]');
            if (!pill) return;
            const view = pill.getAttribute('data-view');
            gainModalIsCumulative = (view === 'cumul');
            updateGainToggleUI();
            buildGainChart();
        });
    }

})();

// ==================== REFRESH DATA BUTTON ====================

const refreshBtn = document.getElementById('refresh-data-btn');
const refreshIcon = document.getElementById('refresh-icon');
const refreshText = document.getElementById('refresh-text');

async function refreshData() {
    try {
        // Disable button
        refreshBtn.disabled = true;
        
        // Update UI to show loading state
        refreshText.textContent = 'Rafraîchissement en cours...';
        refreshIcon.classList.add('animate-spin');
        
        // Send refresh request
        const response = await fetch('https://databuildr.app.n8n.cloud/webhook/refresh-kpis', {
            method: 'GET'
        });
        
        if (!response.ok) {
            throw new Error(`Erreur lors du rafraîchissement: ${response.status}`);
        }
        
        // Wait a moment for the data to be updated on the server
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Reload the data
        await loadData();
        
        // Update UI to show success
        refreshText.textContent = 'Données rafraîchies !';
        refreshIcon.classList.remove('animate-spin');
        
        // Reset button text after 2 seconds
        setTimeout(() => {
            refreshText.textContent = 'Rafraîchir les données';
        }, 2000);
        
    } catch (error) {
        console.error('Error refreshing data:', error);
        
        // Show error state
        refreshText.textContent = 'Erreur de rafraîchissement';
        refreshIcon.classList.remove('animate-spin');
        
        // Reset button text after 3 seconds
        setTimeout(() => {
            refreshText.textContent = 'Rafraîchir les données';
        }, 3000);
    } finally {
        // Re-enable button
        refreshBtn.disabled = false;
    }
}

// Add event listener to refresh button
refreshBtn.addEventListener('click', refreshData);

// Add event listener to logout button
const logoutBtn = document.getElementById('logout-btn');
logoutBtn.addEventListener('click', () => {
    // Clear stored password
    localStorage.removeItem('roi_password');
    
    // Reload page to show login modal
    window.location.reload();
});

// Start the application
checkAuthentication().catch(error => {
    console.error('Error during initialization:', error);
    errorEl.classList.remove('hidden');
    loadingEl.classList.add('hidden');
    loginModal.classList.add('hidden');
});
