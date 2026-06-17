// ============================================================================
// Adoption & Pertinence par Agence — BTP Consultants Contrôle Technique (hors SPS)
// Version "explicite" de agencesCT : deux familles d'indicateurs séparées.
//   - Adoption  : utilisateurs uniques / effectif de l'agence (par personne)
//   - Pertinence: affaires couvertes IA / affaires éligibles ≥100 mots (par affaire)
// SPS (BU distincte, même domaine email) est exclu de l'effectif ET des numérateurs
// via la liste d'emails extraite des JSON chats/expert SPS.
// ============================================================================

// Configuration
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordadoption';

// URLs fetched from webhook after authentication
let DESCRIPTIF_URL = '';
let AUTOCONTACT_URL = '';
let COMPARATEUR_URL = '';
// Public sources — BTP Consultants Contrôle Technique
const EXPERT_BTP_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_btpconsultants_ct.json';
const CHAT_BTP_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_btpconsultants_ct.json';
const GEOTECH_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/analyse_geotechnique.json';
const POPULATION_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/population_cible.csv';
// SPS sources — utilisées UNIQUEMENT pour extraire les emails SPS à exclure
const EXPERT_BTP_SPS_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_btp_sps.json';
const CHAT_BTP_SPS_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_btp_sps.json';

// Constants
const DESCRIPTIF_TYPE = 'DESCRIPTIF_SOMMAIRE_DES_TRAVAUX';

// Date de démarrage du pilote IA descriptif. Avant juin 2025 : ~56 usages dispersés
// (phase de test). On exclut les RICT antérieurs pour ne pas fausser l'assiette.
const DESCRIPTIF_AI_START_DATE = new Date(2025, 5, 1); // 2025-06-01 local

function isAfterDescriptifAIStart(item) {
    const d = parseFrenchDate(item.createdAt);
    return d && d >= DESCRIPTIF_AI_START_DATE;
}

// State
let allRictData = [];
let descriptifData = [];
let autocontactData = [];
let comparateurData = [];
let expertBTPData = [];
let chatBTPData = [];
let geotechData = [];
let agencyPopulation = {};       // {agencyCode: effectif}  (SPS exclu)
let agencyToDR = {};
let agencyToDirection = {};
let emailToAgency = {};          // {email: agencyCode}     (SPS exclu)
let spsEmails = new Set();       // emails SPS (lowercased) à exclure
let spsExcludedFromEffectif = 0; // combien de collaborateurs SPS retirés de l'effectif
let availableAgencies = [];
let availableDirections = [];

let adoptionSort = { column: 'adoptionGlobale', ascending: false };
let pertinenceSort = { column: 'couverture', ascending: false };
let dateFilter = { startDate: null, endDate: null };

// Cache des stats calculées (recalculé à chaque changement de filtre)
let currentStats = [];

// DOM Elements
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const mainContentEl = document.getElementById('main-content');
const startDateEl = document.getElementById('start-date');
const endDateEl = document.getElementById('end-date');
const directionFilterEl = document.getElementById('direction-filter');
const agencyFilterEl = document.getElementById('agency-filter');
const resetFiltersBtn = document.getElementById('reset-filters');
const adoptionTableBodyEl = document.getElementById('adoption-table-body');
const pertinenceTableBodyEl = document.getElementById('pertinence-table-body');
const adoptionChartEl = document.getElementById('adoption-chart');

// Login elements
const loginModal = document.getElementById('login-modal');
const loginForm = document.getElementById('login-form');
const passwordInput = document.getElementById('password-input');
const loginButton = document.getElementById('login-button');
const loginText = document.getElementById('login-text');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');

// ==================== UTILITY FUNCTIONS ====================

function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatNumber(num) {
    return new Intl.NumberFormat('fr-FR').format(Math.round(num));
}

function parseFrenchDate(dateString) {
    if (!dateString) return null;
    let cleanDate = dateString.replace(/\\/g, '');
    let date = new Date(cleanDate);
    if (isNaN(date.getTime())) {
        const months = {
            'janvier': 0, 'février': 1, 'fevrier': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5,
            'juillet': 6, 'août': 7, 'aout': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11, 'decembre': 11
        };
        const match = cleanDate.match(/(\d+)\s+([a-zàâäéèêëïôùûü]+)[,\s]+(\d{4})/i);
        if (match) {
            const day = parseInt(match[1]);
            const monthName = match[2].toLowerCase().trim();
            const year = parseInt(match[3]);
            if (months[monthName] !== undefined) {
                date = new Date(year, months[monthName], day);
                const timeMatch = cleanDate.match(/(\d{1,2}):(\d{2})/);
                if (timeMatch) date.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
            }
        }
    }
    if (isNaN(date.getTime())) return null;
    return date;
}

function extractAgency(contractNumber) {
    if (!contractNumber || typeof contractNumber !== 'string') return null;
    const match = contractNumber.match(/C-([A-Z0-9]+)-/);
    return match && match[1] ? match[1] : null;
}

const HTML_TAG_RE = /<[^>]+>/g;
function extractText(html) {
    if (!html || typeof html !== 'string') return '';
    const withBreaks = html.replace(/<\/p>/gi, '\n\n');
    let text = withBreaks.replace(HTML_TAG_RE, '');
    text = text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&').replace(/[*_`]/g, '');
    return text.replace(/\s+/g, ' ').trim();
}

function countWords(text) {
    if (!text || typeof text !== 'string') return 0;
    const words = text.match(/[a-zA-ZÀ-ÿ]+/g);
    return words ? words.length : 0;
}

function parseCSVFull(csvText) {
    const rows = [];
    let row = [], current = '', inQuotes = false;
    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        if (inQuotes) {
            if (char === '"') {
                if (i + 1 < csvText.length && csvText[i + 1] === '"') { current += '"'; i++; }
                else inQuotes = false;
            } else current += char;
        } else {
            if (char === '"') inQuotes = true;
            else if (char === ',') { row.push(current.trim()); current = ''; }
            else if (char === '\n') { row.push(current.trim()); current = ''; if (row.some(v => v !== '')) rows.push(row); row = []; }
            else if (char === '\r') { /* skip */ }
            else current += char;
        }
    }
    if (current.trim() !== '' || row.length > 0) { row.push(current.trim()); if (row.some(v => v !== '')) rows.push(row); }
    return rows;
}

function extractCSVFromDataField(csvText) {
    const lines = csvText.split('\n');
    if (lines.length > 0 && lines[0].trim() === 'data') {
        const csvLines = lines.slice(1);
        if (csvLines.length > 0 && csvLines[0].startsWith('"')) csvLines[0] = csvLines[0].substring(1);
        if (csvLines.length > 0 && csvLines[csvLines.length - 1].trim() === '"') csvLines.pop();
        else if (csvLines.length > 0 && csvLines[csvLines.length - 1].endsWith('"')) csvLines[csvLines.length - 1] = csvLines[csvLines.length - 1].slice(0, -1);
        return csvLines.join('\n').trim();
    }
    return csvText;
}

function fixEncoding(text) {
    const replacements = {
        'Ã©': 'é', 'Ã¨': 'è', 'Ãª': 'ê', 'Ã ': 'à', 'Ã¢': 'â', 'Ã´': 'ô', 'Ã»': 'û',
        'Ã§': 'ç', 'Ã«': 'ë', 'Ã¯': 'ï', 'Ã¼': 'ü', '�': 'é'
    };
    let fixed = text;
    for (const [bad, good] of Object.entries(replacements)) fixed = fixed.replace(new RegExp(bad, 'g'), good);
    return fixed;
}

// ==================== SPS EMAILS (à exclure) ====================

// Charge les JSON SPS et construit l'ensemble des emails SPS à exclure.
// SPS partage le domaine @btp-consultants.fr mais constitue une BU distincte :
// on retire ces collaborateurs de l'effectif et des usages BTP Consultants CT.
async function loadSpsEmails() {
    const urls = [EXPERT_BTP_SPS_URL, CHAT_BTP_SPS_URL];
    for (const url of urls) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) { console.warn('SPS source indisponible:', url, resp.status); continue; }
            const json = await resp.json();
            if (Array.isArray(json)) {
                json.forEach(item => {
                    const email = ((item && (item.email || (item.metadata && item.metadata.email))) || '').toLowerCase().trim();
                    if (email) spsEmails.add(email);
                });
            }
        } catch (e) {
            console.warn('Erreur chargement emails SPS:', url, e);
        }
    }
    console.log('Emails SPS exclus:', spsEmails.size, [...spsEmails]);
}

function isSpsEmail(email) {
    if (!email) return false;
    return spsEmails.has(email.toLowerCase().trim());
}

// ==================== DATA PARSING ====================

function parseDescriptifCSV(csvString) {
    if (!csvString || typeof csvString !== 'string') return [];
    let csvText = csvString.trim();
    while (csvText.startsWith('[') || csvText.startsWith('{')) csvText = csvText.substring(1).trim();
    while (csvText.endsWith(']') || csvText.endsWith('}')) csvText = csvText.substring(0, csvText.length - 1).trim();
    const rows = parseCSVFull(csvText);
    if (rows.length === 0) return [];
    const headers = rows[0];
    let typeIndex = -1, contractIndex = -1, diffusedAtIndex = -1, emailIndex = -1;
    let agencyIndex = -1, managementIndex = -1, descriptionIndex = -1, aiResultIndex = -1;
    let descWcIndex = -1, aiWcIndex = -1, hasAiIndex = -1;
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toLowerCase();
        if (typeIndex === -1 && header.includes('aideliver') && header.includes('type')) typeIndex = i;
        if (contractIndex === -1 && header.includes('contractnumber')) contractIndex = i;
        if (diffusedAtIndex === -1 && header.includes('report') && header.includes('diffusedat')) diffusedAtIndex = i;
        if (emailIndex === -1 && header.includes('user') && header.includes('email')) emailIndex = i;
        if (agencyIndex === -1 && header.includes('productionservice')) agencyIndex = i;
        if (managementIndex === -1 && header.includes('management')) managementIndex = i;
        if (descWcIndex === -1 && header.includes('description') && header.includes('wordcount')) descWcIndex = i;
        if (aiWcIndex === -1 && header.includes('airesult') && header.includes('wordcount')) aiWcIndex = i;
        if (hasAiIndex === -1 && header.includes('hasai')) hasAiIndex = i;
        if (descriptionIndex === -1 && header.includes('description') && !header.includes('complement') && !header.includes('longresult') && !header.includes('wordcount')) descriptionIndex = i;
        if (aiResultIndex === -1 && ((header.includes('longresult') || header.includes('result')) && !header.includes('wordcount'))) aiResultIndex = i;
    }
    if (typeIndex === -1 || contractIndex === -1) return [];
    const data = [];
    for (let i = 1; i < rows.length; i++) {
        const values = rows[i];
        if (values.length < headers.length / 2) continue;
        const descWcRaw = descWcIndex >= 0 ? (values[descWcIndex] || '').toString().trim() : '';
        const aiWcRaw = aiWcIndex >= 0 ? (values[aiWcIndex] || '').toString().trim() : '';
        const hasAiRaw = hasAiIndex >= 0 ? (values[hasAiIndex] || '').toString().toLowerCase().trim() : '';
        data.push({
            type: (values[typeIndex] || '').trim(),
            contractNumber: (values[contractIndex] || '').trim(),
            createdAt: (diffusedAtIndex >= 0 ? (values[diffusedAtIndex] || '') : '').trim(),
            email: (emailIndex >= 0 ? (values[emailIndex] || '') : '').trim(),
            agency: ((agencyIndex >= 0 ? values[agencyIndex] : '') || '').trim(),
            direction: ((managementIndex >= 0 ? values[managementIndex] : '') || '').trim(),
            description: descriptionIndex >= 0 ? (values[descriptionIndex] || '') : '',
            aiResult: aiResultIndex >= 0 ? (values[aiResultIndex] || '') : '',
            descriptionWordCount: (descWcRaw !== '' && !isNaN(parseInt(descWcRaw))) ? parseInt(descWcRaw) : undefined,
            aiResultWordCount: (aiWcRaw !== '' && !isNaN(parseInt(aiWcRaw))) ? parseInt(aiWcRaw) : undefined,
            hasAi: hasAiRaw === 'true'
        });
    }
    return data;
}

function getDescWordCount(item) {
    if (typeof item.descriptionWordCount === 'number') return item.descriptionWordCount;
    return countWords(extractText(item.description || ''));
}

function parseAutocontactCSV(csvString) {
    if (!csvString || typeof csvString !== 'string') return [];
    let csvText = csvString.trim();
    while (csvText.startsWith('[') || csvText.startsWith('{')) csvText = csvText.substring(1).trim();
    while (csvText.endsWith(']') || csvText.endsWith('}')) csvText = csvText.substring(0, csvText.length - 1).trim();
    const rows = parseCSVFull(csvText);
    if (rows.length === 0) return [];
    const headers = rows[0];
    let contractIndex = -1, fromAIIndex = -1, emailIndex = -1, createdAtIndex = -1;
    let agencyIndex = -1, managementIndex = -1, deliverableTypeIndex = -1;
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toLowerCase();
        if (contractIndex === -1 && header.includes('contractnumber')) contractIndex = i;
        if (fromAIIndex === -1 && (header.includes('fromai') || header.includes('from_ai'))) fromAIIndex = i;
        if (emailIndex === -1 && header.includes('user') && header.includes('email')) emailIndex = i;
        if (createdAtIndex === -1 && (header.includes('createdat') || header.includes('created_at'))) createdAtIndex = i;
        if (agencyIndex === -1 && header.includes('productionservice')) agencyIndex = i;
        if (managementIndex === -1 && header.includes('management')) managementIndex = i;
        if (deliverableTypeIndex === -1 && header.includes('aideliver') && header.includes('type')) deliverableTypeIndex = i;
    }
    if (contractIndex === -1) return [];
    if (emailIndex === -1) {
        for (let rowIdx = 1; rowIdx < Math.min(10, rows.length); rowIdx++) {
            const values = rows[rowIdx];
            for (let colIdx = 0; colIdx < values.length; colIdx++) {
                if (values[colIdx] && values[colIdx].includes('@btp-consultants.fr')) { emailIndex = colIdx; break; }
            }
            if (emailIndex !== -1) break;
        }
    }
    const data = [];
    for (let i = 1; i < rows.length; i++) {
        const values = rows[i];
        if (values.length < headers.length / 2) continue;
        data.push({
            contractNumber: (values[contractIndex] || '').trim(),
            fromAI: fromAIIndex >= 0 ? (values[fromAIIndex] || '').toLowerCase() === 'true' : false,
            deliverableType: (deliverableTypeIndex >= 0 ? (values[deliverableTypeIndex] || '') : '').trim(),
            email: (emailIndex >= 0 ? (values[emailIndex] || '') : '').trim(),
            createdAt: (createdAtIndex >= 0 ? (values[createdAtIndex] || '') : '').trim(),
            agency: ((agencyIndex >= 0 ? values[agencyIndex] : '') || '').trim(),
            direction: ((managementIndex >= 0 ? values[managementIndex] : '') || '').trim()
        });
    }
    return data;
}

function parseComparateurCSV(csvString) {
    if (!csvString || typeof csvString !== 'string') return [];
    let csvText = csvString.trim();
    while (csvText.startsWith('[') || csvText.startsWith('{')) csvText = csvText.substring(1).trim();
    while (csvText.endsWith(']') || csvText.endsWith('}')) csvText = csvText.substring(0, csvText.length - 1).trim();
    const rows = parseCSVFull(csvText);
    if (rows.length === 0) return [];
    const headers = rows[0];
    let contractIndex = -1, emailIndex = -1, longResultIndex = -1, agencyIndex = -1, managementIndex = -1, createdAtIndex = -1;
    let longResultIsItemsArray = false;
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        const headerLower = header.toLowerCase();
        if (contractIndex === -1 && (headerLower.includes('contractnumber') || header.includes('SubAffairDetailId'))) contractIndex = i;
        if (emailIndex === -1 && headerLower.includes('email')) emailIndex = i;
        if (longResultIndex === -1 && headerLower.includes('longresult') && headerLower.includes('indexcomparator')) { longResultIndex = i; longResultIsItemsArray = true; }
        if (longResultIndex === -1 && headerLower === 'longresult') longResultIndex = i;
        if (agencyIndex === -1 && headerLower.includes('productionservice')) agencyIndex = i;
        if (managementIndex === -1 && headerLower.includes('management')) managementIndex = i;
        if (createdAtIndex === -1 && headerLower.includes('createdat')) createdAtIndex = i;
    }
    if (contractIndex === -1 || longResultIndex === -1) return [];
    const data = [];
    for (let i = 1; i < rows.length; i++) {
        const values = rows[i];
        if (values.length < headers.length / 2) continue;
        let maxPage = 0;
        try {
            const parsed = JSON.parse(values[longResultIndex] || (longResultIsItemsArray ? '[]' : '{}'));
            const items = longResultIsItemsArray
                ? (Array.isArray(parsed) ? parsed : [])
                : (parsed && parsed.indexComparator && parsed.indexComparator.items ? parsed.indexComparator.items : []);
            items.forEach(item => {
                if (item.page !== undefined && item.page !== null) {
                    const pageNum = typeof item.page === 'number' ? item.page : parseInt(item.page);
                    if (!isNaN(pageNum)) maxPage = Math.max(maxPage, pageNum);
                }
            });
        } catch (e) {}
        data.push({
            contractNumber: (values[contractIndex] || '').trim(),
            email: (emailIndex >= 0 ? (values[emailIndex] || '') : '').trim(),
            agency: ((agencyIndex >= 0 ? values[agencyIndex] : '') || '').trim(),
            direction: ((managementIndex >= 0 ? values[managementIndex] : '') || '').trim(),
            createdAt: (createdAtIndex >= 0 ? (values[createdAtIndex] || '') : '').trim(),
            maxPage: maxPage
        });
    }
    return data;
}

// Géotech (Card 139) — 1 op IA = 2 events (Notice+Report) même DeliverableId → dédup.
function parseGeotechCSV(csvString) {
    if (!csvString || typeof csvString !== 'string') return [];
    let csvText = csvString.trim();
    while (csvText.startsWith('[') || csvText.startsWith('{')) csvText = csvText.substring(1).trim();
    while (csvText.endsWith(']') || csvText.endsWith('}')) csvText = csvText.substring(0, csvText.length - 1).trim();
    const rows = parseCSVFull(csvText);
    if (rows.length === 0) return [];
    const headers = rows[0];
    const idx = (name) => { for (let i = 0; i < headers.length; i++) if (headers[i].trim().toLowerCase() === name.toLowerCase()) return i; return -1; };
    const eventNameIdx = idx('EventName'), eventDateIdx = idx('EventDate'), deliverableIdx = idx('DeliverableId');
    const contractIdx = idx('ContractNumber'), emailIdx = idx('UserEmail'), agenceIdx = idx('Agence'), drIdx = idx('DR');
    const data = [];
    const seenDeliverables = new Set();
    for (let i = 1; i < rows.length; i++) {
        const values = rows[i];
        if (values.length < headers.length / 2) continue;
        const deliverableId = (deliverableIdx >= 0 ? values[deliverableIdx] : '').trim();
        if (deliverableId) { if (seenDeliverables.has(deliverableId)) continue; seenDeliverables.add(deliverableId); }
        data.push({
            eventName: (eventNameIdx >= 0 ? values[eventNameIdx] : '').trim(),
            deliverableId: deliverableId,
            createdAt: (eventDateIdx >= 0 ? values[eventDateIdx] : '').trim(),
            contractNumber: (contractIdx >= 0 ? values[contractIdx] : '').trim(),
            email: (emailIdx >= 0 ? values[emailIdx] : '').trim(),
            agency: ((agenceIdx >= 0 ? values[agenceIdx] : '') || '').trim(),
            direction: ((drIdx >= 0 ? values[drIdx] : '') || '').trim()
        });
    }
    return data;
}

// Population / annuaire — SPS exclu du calcul de l'effectif.
function parsePopulationData(rawData) {
    if (!rawData || typeof rawData !== 'string') return;
    let csvText = rawData.trim();
    try {
        const json = JSON.parse(csvText);
        if (Array.isArray(json) && json.length > 0 && json[0].data) csvText = json[0].data;
        else if (Array.isArray(json) && json.length > 0 && typeof json[0] === 'object') { _parseUserObjects(json); return; }
    } catch (e) {
        csvText = fixEncoding(csvText);
        csvText = extractCSVFromDataField(csvText);
    }
    const rows = parseCSVFull(csvText);
    if (rows.length < 2) return;
    const headers = rows[0].map(h => h.toLowerCase().trim());
    const emailIdx = headers.findIndex(h => h.includes('email') && !h.includes('management'));
    const productionServiceIdx = headers.findIndex(h => h.includes('productionservice'));

    if (emailIdx !== -1 && productionServiceIdx !== -1) {
        const isEnabledIdx = headers.findIndex(h => h.includes('enabled'));
        const isMainIdx = headers.findIndex(h => h.includes('ismain') || (h.includes('is') && h.includes('main')));
        const managementIdx = headers.findIndex(h => h.includes('management'));
        const userAssignments = {};
        for (let i = 1; i < rows.length; i++) {
            const values = rows[i];
            const email = (values[emailIdx] || '').toLowerCase().trim();
            const isEnabled = isEnabledIdx === -1 || (values[isEnabledIdx] || '').toLowerCase() === 'true';
            const isMain = isMainIdx === -1 || (values[isMainIdx] || '').toLowerCase() === 'true';
            const agencyCode = (values[productionServiceIdx] || '').trim().toUpperCase();
            const dr = managementIdx >= 0 ? (values[managementIdx] || '').trim() : '';
            if (!email || !agencyCode || !isEnabled) continue;
            if (!userAssignments[email]) userAssignments[email] = [];
            userAssignments[email].push({ agencyCode, isMain, dr });
            if (dr) { agencyToDR[agencyCode] = dr; agencyToDirection[agencyCode] = dr; }
        }
        emailToAgency = {};
        agencyPopulation = {};
        spsExcludedFromEffectif = 0;
        Object.entries(userAssignments).forEach(([email, assignments]) => {
            const normalizedEmail = email.toLowerCase().trim();
            // EXCLUSION SPS : le collaborateur n'entre ni dans l'effectif ni dans emailToAgency
            if (spsEmails.has(normalizedEmail)) { spsExcludedFromEffectif++; return; }
            const primary = assignments.find(a => a.isMain) || assignments[0];
            emailToAgency[normalizedEmail] = primary.agencyCode;
            agencyPopulation[primary.agencyCode] = (agencyPopulation[primary.agencyCode] || 0) + 1;
        });
        console.log('Annuaire chargé:', Object.keys(emailToAgency).length, 'users,', Object.keys(agencyPopulation).length, 'agences ; SPS exclus de l\'effectif:', spsExcludedFromEffectif);
    } else {
        // Format legacy : DR, AgencyCode, Effectif (pas d'email → exclusion SPS impossible)
        agencyPopulation = {}; agencyToDR = {}; agencyToDirection = {};
        for (let i = 1; i < rows.length; i++) {
            if (rows[i].length >= 3) {
                const dr = rows[i][0].trim();
                const agencyCode = rows[i][1].trim().toUpperCase();
                const effectif = parseInt(rows[i][2].trim());
                if (agencyCode && !isNaN(effectif)) { agencyPopulation[agencyCode] = effectif; agencyToDR[agencyCode] = dr; agencyToDirection[agencyCode] = dr; }
            }
        }
        console.log('Population legacy chargée:', Object.keys(agencyPopulation).length, 'agences (exclusion SPS non applicable au format effectif)');
    }
}

function _parseUserObjects(jsonArray) {
    const userAssignments = {};
    emailToAgency = {}; agencyPopulation = {}; agencyToDR = {}; agencyToDirection = {}; spsExcludedFromEffectif = 0;
    jsonArray.forEach(user => {
        const email = (user.Email || user.email || '').toLowerCase().trim();
        const isEnabled = String(user.IsEnabled || user.isEnabled || 'true').toLowerCase() === 'true';
        const isMain = String(user['AgencyToUser → IsMain'] || user.IsMain || user.isMain || 'true').toLowerCase() === 'true';
        const agencyCode = (user['Agency → AgencyId → ProductionService'] || user.ProductionService || user.agencyCode || '').trim().toUpperCase();
        const dr = (user['Agency → AgencyId → Management'] || user.Management || user.dr || '').trim();
        if (!email || !agencyCode || !isEnabled) return;
        if (!userAssignments[email]) userAssignments[email] = [];
        userAssignments[email].push({ agencyCode, isMain, dr });
        if (dr) { agencyToDR[agencyCode] = dr; agencyToDirection[agencyCode] = dr; }
    });
    Object.entries(userAssignments).forEach(([email, assignments]) => {
        const normalizedEmail = email.toLowerCase().trim();
        if (spsEmails.has(normalizedEmail)) { spsExcludedFromEffectif++; return; }
        const primary = assignments.find(a => a.isMain) || assignments[0];
        emailToAgency[normalizedEmail] = primary.agencyCode;
        agencyPopulation[primary.agencyCode] = (agencyPopulation[primary.agencyCode] || 0) + 1;
    });
}

// ==================== FILTERS ====================

function getFilteredData(data) {
    return data.filter(item => {
        if (dateFilter.startDate || dateFilter.endDate) {
            const itemDate = parseFrenchDate(item.createdAt);
            if (!itemDate) return false;
            if (dateFilter.startDate) { const start = new Date(dateFilter.startDate); start.setHours(0, 0, 0, 0); if (itemDate < start) return false; }
            if (dateFilter.endDate) { const end = new Date(dateFilter.endDate); end.setHours(23, 59, 59, 999); if (itemDate > end) return false; }
        }
        const direction = directionFilterEl.value;
        if (direction && item.direction !== direction) return false;
        const agency = agencyFilterEl.value;
        if (agency && item.agency !== agency) return false;
        return true;
    });
}

function extractDirectionsAndAgencies() {
    const directions = new Set(), agencies = new Set();
    const processItems = (items) => {
        items.forEach(item => {
            const dir = item.direction, ag = item.agency;
            if (ag) agencies.add(ag);
            let finalDirection = dir;
            if (!finalDirection && ag) {
                const agencyCode = ag.trim().toUpperCase();
                if (agencyToDR[agencyCode]) finalDirection = agencyToDR[agencyCode];
                else if (agencyToDirection[agencyCode]) finalDirection = agencyToDirection[agencyCode];
                else if (agencyToDirection[ag]) finalDirection = agencyToDirection[ag];
            }
            if (finalDirection) {
                directions.add(finalDirection);
                if (ag) {
                    agencyToDirection[ag] = finalDirection;
                    const agencyCode = ag.trim().toUpperCase();
                    if (agencyCode !== ag) agencyToDirection[agencyCode] = finalDirection;
                }
            }
        });
    };
    processItems(allRictData); processItems(descriptifData); processItems(autocontactData);
    processItems(comparateurData); processItems(expertBTPData); processItems(chatBTPData); processItems(geotechData);
    availableDirections = Array.from(directions).sort();
    availableAgencies = Array.from(agencies).sort();
}

function populateFilters() {
    directionFilterEl.innerHTML = '<option value="">Toutes les directions</option>';
    availableDirections.forEach(dir => {
        const option = document.createElement('option');
        option.value = dir; option.textContent = dir;
        directionFilterEl.appendChild(option);
    });
    populateAgencyFilter();
}

function populateAgencyFilter() {
    const selectedDirection = directionFilterEl.value;
    const currentAgency = agencyFilterEl.value;
    agencyFilterEl.innerHTML = '<option value="">Toutes les agences</option>';
    const filteredAgencies = availableAgencies.filter(agency => !selectedDirection || agencyToDirection[agency] === selectedDirection);
    filteredAgencies.forEach(agency => {
        const option = document.createElement('option');
        option.value = agency; option.textContent = agency;
        agencyFilterEl.appendChild(option);
    });
    if (currentAgency && filteredAgencies.includes(currentAgency)) agencyFilterEl.value = currentAgency;
}

// ==================== CALCULATE STATISTICS ====================
// Une seule passe produit, par agence :
//  - adoption (par personne, home agency, dénominateur=effectif) pour les 6 outils + globale
//  - pertinence du descriptif (par affaire, agence du projet) : éligibles / couvertes / couverture

function calculateAgencyStatistics() {
    const statsMap = {};
    const hasDirectory = Object.keys(emailToAgency).length > 0;

    // Un email "compte" dans l'adoption seulement s'il est dans l'annuaire (donc dans l'effectif),
    // et n'est pas un email SPS. Numérateur ⊆ dénominateur garanti.
    const isKnownUser = (email) => {
        if (!email) return false;
        const e = email.toLowerCase().trim();
        if (spsEmails.has(e)) return false;
        if (hasDirectory) return !!emailToAgency[e];
        return e.includes('@btp-consultants.fr') || e.includes('@citae.fr');
    };

    // Agence "de rattachement" du collaborateur (annuaire), sinon agence portée par la donnée.
    const homeAgency = (item) => {
        const email = (item.email || '').toLowerCase().trim();
        return (email && emailToAgency[email]) ? emailToAgency[email] : (item.agency || '');
    };

    const getOrCreate = (agencyRaw) => {
        const key = (agencyRaw || '').trim().toUpperCase() || '__NONE__';
        if (!statsMap[key]) {
            statsMap[key] = {
                agencyKey: key, agency: agencyRaw || '',
                contractsEligibles: new Set(),       // affaires RICT ≥100 mots (gisement)
                contractsCouverts: new Set(),        // affaires éligibles couvertes par l'IA
                usersDescriptif: new Set(), usersAutocontact: new Set(), usersComparateur: new Set(),
                usersExpertBTP: new Set(), usersChatBTP: new Set(), usersGeotech: new Set(),
                usersAny: new Set(),                 // union → adoption globale
                descriptifCount: 0, autocontactCount: 0, comparateurCount: 0,
                expertBTPCount: 0, chatBTPCount: 0, geotechCount: 0
            };
        }
        return statsMap[key];
    };

    const addUser = (stats, tool, email) => {
        const e = email.toLowerCase().trim();
        stats['users' + tool].add(e);
        stats.usersAny.add(e);
    };

    // --- Dénominateur pertinence : affaires RICT ≥100 mots, par agence du projet ---
    getFilteredData(allRictData).forEach(item => {
        if (!isAfterDescriptifAIStart(item)) return;
        const projectAgency = (item.agency || '').trim().toUpperCase();
        if (!projectAgency) return;
        const stats = getOrCreate(projectAgency);
        if (item.contractNumber && item.contractNumber.trim() !== '' && getDescWordCount(item) >= 100) {
            stats.contractsEligibles.add(item.contractNumber);
        }
    });

    // --- Descriptif : adoption (personne) + couverture (affaire) ---
    getFilteredData(descriptifData).forEach(item => {
        if (!isAfterDescriptifAIStart(item)) return;
        const homeStats = getOrCreate(homeAgency(item));
        const projectAgency = (item.agency || '').trim().toUpperCase();
        const contractStats = projectAgency ? getOrCreate(projectAgency) : homeStats;
        // Couverture : affaire IA parmi les éligibles (≥100 mots déjà garanti par contractsEligibles)
        if (item.contractNumber && item.contractNumber.trim() !== '' && contractStats.contractsEligibles.has(item.contractNumber)) {
            contractStats.contractsCouverts.add(item.contractNumber);
        }
        // Adoption : user ayant utilisé le descriptif IA sur une source ≥100 mots
        if (!item.type || item.type === DESCRIPTIF_TYPE) {
            if (getDescWordCount(item) >= 100) {
                homeStats.descriptifCount++;
                if (isKnownUser(item.email)) addUser(homeStats, 'Descriptif', item.email);
            }
        }
    });

    // --- Auto Contact ---
    getFilteredData(autocontactData).forEach(item => {
        if (!item.contractNumber.toUpperCase().includes('YIELD') && item.fromAI) {
            const stats = getOrCreate(homeAgency(item));
            stats.autocontactCount++;
            if (isKnownUser(item.email)) addUser(stats, 'Autocontact', item.email);
        }
    });

    // --- Comparateur ---
    getFilteredData(comparateurData).forEach(item => {
        const stats = getOrCreate(homeAgency(item));
        stats.comparateurCount++;
        if (isKnownUser(item.email)) addUser(stats, 'Comparateur', item.email);
    });

    // --- Expert BTP ---
    getFilteredData(expertBTPData).forEach(item => {
        const stats = getOrCreate(homeAgency(item));
        stats.expertBTPCount++;
        if (isKnownUser(item.email)) addUser(stats, 'ExpertBTP', item.email);
    });

    // --- Chat BTP ---
    getFilteredData(chatBTPData).forEach(item => {
        const stats = getOrCreate(homeAgency(item));
        stats.chatBTPCount++;
        if (isKnownUser(item.email)) addUser(stats, 'ChatBTP', item.email);
    });

    // --- Géotech (déjà dédupliqué) ---
    getFilteredData(geotechData).forEach(item => {
        const stats = getOrCreate(homeAgency(item));
        stats.geotechCount++;
        if (isKnownUser(item.email)) addUser(stats, 'Geotech', item.email);
    });

    // --- Conversion + taux ---
    return Object.values(statsMap).map(stats => {
        const agencyCode = stats.agencyKey;
        const finalDirection = agencyToDR[agencyCode] || agencyToDirection[agencyCode] || 'Non spécifiée';
        const effectif = (agencyCode && agencyCode !== '__NONE__') ? (agencyPopulation[agencyCode] || 0) : 0;

        const pct = (num, den) => den > 0 ? Math.min(100, (num / den) * 100) : null;
        const eligibles = stats.contractsEligibles.size;
        const couvertes = stats.contractsCouverts.size;

        return {
            direction: finalDirection,
            agency: stats.agency,
            agencyCode: agencyCode,
            effectif: effectif,
            // Adoption (par personne)
            adoptionDescriptif: pct(stats.usersDescriptif.size, effectif),
            adoptionAutocontact: pct(stats.usersAutocontact.size, effectif),
            adoptionComparateur: pct(stats.usersComparateur.size, effectif),
            adoptionExpertBTP: pct(stats.usersExpertBTP.size, effectif),
            adoptionChatBTP: pct(stats.usersChatBTP.size, effectif),
            adoptionGeotech: pct(stats.usersGeotech.size, effectif),
            adoptionGlobale: pct(stats.usersAny.size, effectif),
            usersAny: stats.usersAny.size,
            usersDescriptif: stats.usersDescriptif.size,
            // Pertinence (par affaire)
            eligibles: eligibles,
            couvertes: couvertes,
            couverture: eligibles > 0 ? (couvertes / eligibles) * 100 : null,
            total: stats.descriptifCount + stats.autocontactCount + stats.comparateurCount + stats.expertBTPCount + stats.chatBTPCount + stats.geotechCount
        };
    });
}

// ==================== BADGES ====================

// Échelle indicative commune (adoption & couverture). Vert ≥50, jaune ≥30, orange ≥20, sinon rouge.
function badgeHtml(rate) {
    if (rate === null || rate === undefined || isNaN(rate)) return '<span class="text-gray-400">—</span>';
    let bg = 'bg-red-500';
    if (rate >= 50) bg = 'bg-green-500';
    else if (rate >= 30) bg = 'bg-yellow-500';
    else if (rate >= 20) bg = 'bg-orange-500';
    return `<span class="px-3 py-1 rounded-full text-white font-bold ${bg}">${rate.toFixed(1)}%</span>`;
}

// ==================== SYNTHÈSE KPIs ====================

function updateSynthese(stats) {
    // Dénominateur = effectif des agences dans le périmètre courant (respecte direction/agence).
    const selectedDirection = directionFilterEl.value;
    const selectedAgency = agencyFilterEl.value;
    let totalEffectif = 0;
    Object.keys(agencyPopulation).forEach(code => {
        if (selectedAgency) { if (code === selectedAgency.trim().toUpperCase()) totalEffectif += agencyPopulation[code]; }
        else if (selectedDirection) { const dir = agencyToDR[code] || agencyToDirection[code] || ''; if (dir === selectedDirection) totalEffectif += agencyPopulation[code]; }
        else totalEffectif += agencyPopulation[code];
    });
    // Numérateurs : utilisateurs uniques par agence de rattachement (chaque user = 1 seule agence).
    const sumUsersAny = stats.reduce((s, a) => s + (a.usersAny || 0), 0);
    const sumUsersDescriptif = stats.reduce((s, a) => s + (a.usersDescriptif || 0), 0);
    const totalEligibles = stats.reduce((s, a) => s + (a.eligibles || 0), 0);
    const totalCouvertes = stats.reduce((s, a) => s + (a.couvertes || 0), 0);

    const cap = (v) => Math.min(100, v).toFixed(1) + '%';
    document.getElementById('kpi-effectif').textContent = totalEffectif > 0 ? formatNumber(totalEffectif) : '—';
    document.getElementById('kpi-adoption-globale').textContent = totalEffectif > 0 ? cap(sumUsersAny / totalEffectif * 100) : '—';
    document.getElementById('kpi-adoption-descriptif').textContent = totalEffectif > 0 ? cap(sumUsersDescriptif / totalEffectif * 100) : '—';
    document.getElementById('kpi-couverture-descriptif').textContent = totalEligibles > 0 ? cap(totalCouvertes / totalEligibles * 100) : '—';
}

// ==================== TABLES ====================

function sortStats(stats, sortState) {
    const arr = stats.slice();
    arr.sort((a, b) => {
        let valA = a[sortState.column], valB = b[sortState.column];
        if (valA === undefined || valA === null || (typeof valA === 'number' && (isNaN(valA) || !isFinite(valA)))) valA = (typeof valA === 'string') ? '' : -1;
        if (valB === undefined || valB === null || (typeof valB === 'number' && (isNaN(valB) || !isFinite(valB)))) valB = (typeof valB === 'string') ? '' : -1;
        if (typeof valA === 'string' && typeof valB === 'string') {
            return sortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        const numA = typeof valA === 'number' ? valA : parseFloat(valA) || 0;
        const numB = typeof valB === 'number' ? valB : parseFloat(valB) || 0;
        return sortState.ascending ? numA - numB : numB - numA;
    });
    return arr;
}

function renderAdoptionTable() {
    // On n'affiche dans l'adoption que les agences à effectif connu (sinon taux = —, non pertinent)
    const stats = sortStats(currentStats.filter(s => s.effectif > 0), adoptionSort);
    adoptionTableBodyEl.innerHTML = '';
    if (stats.length === 0) {
        adoptionTableBodyEl.innerHTML = `<tr><td colspan="10" class="px-6 py-4 text-center text-gray-500">Aucune donnée disponible</td></tr>`;
    } else {
        stats.forEach((s, index) => {
            const tr = document.createElement('tr');
            tr.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
            tr.innerHTML = `
                <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-600">${escapeHtml(s.direction)}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${escapeHtml(s.agency)}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-600">${s.effectif > 0 ? formatNumber(s.effectif) : '—'}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-center font-semibold">${badgeHtml(s.adoptionGlobale)}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-center">${badgeHtml(s.adoptionDescriptif)}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-center">${badgeHtml(s.adoptionAutocontact)}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-center">${badgeHtml(s.adoptionComparateur)}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-center">${badgeHtml(s.adoptionExpertBTP)}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-center">${badgeHtml(s.adoptionChatBTP)}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-center">${badgeHtml(s.adoptionGeotech)}</td>`;
            adoptionTableBodyEl.appendChild(tr);
        });
    }
    document.getElementById('adoption-legend').innerHTML =
        'Échelle indicative : <span class="px-2 py-0.5 rounded-full bg-green-500 text-white">≥ 50%</span> ' +
        '<span class="px-2 py-0.5 rounded-full bg-yellow-500 text-white">30–49%</span> ' +
        '<span class="px-2 py-0.5 rounded-full bg-orange-500 text-white">20–29%</span> ' +
        '<span class="px-2 py-0.5 rounded-full bg-red-500 text-white">&lt; 20%</span> · « — » = effectif inconnu.';
    updateSortIcons('ad-sort-', adoptionSort, ['direction', 'agency', 'effectif', 'adoptionGlobale', 'adoptionDescriptif', 'adoptionAutocontact', 'adoptionComparateur', 'adoptionExpertBTP', 'adoptionChatBTP', 'adoptionGeotech']);
}

function renderPertinenceTable() {
    // On n'affiche que les agences avec un gisement éligible (sinon couverture non définie)
    const stats = sortStats(currentStats.filter(s => s.eligibles > 0), pertinenceSort);
    pertinenceTableBodyEl.innerHTML = '';
    if (stats.length === 0) {
        pertinenceTableBodyEl.innerHTML = `<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">Aucune affaire éligible sur la période</td></tr>`;
    } else {
        stats.forEach((s, index) => {
            const tr = document.createElement('tr');
            tr.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
            tr.innerHTML = `
                <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-600">${escapeHtml(s.direction)}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${escapeHtml(s.agency)}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-700">${formatNumber(s.eligibles)}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-700">${formatNumber(s.couvertes)}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-center bg-violet-50/40">${badgeHtml(s.couverture)}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-center bg-emerald-50/40">${badgeHtml(s.adoptionDescriptif)}</td>`;
            pertinenceTableBodyEl.appendChild(tr);
        });
    }
    updateSortIcons('pe-sort-', pertinenceSort, ['direction', 'agency', 'eligibles', 'couvertes', 'couverture', 'adoptionDescriptif']);
}

function updateSortIcons(prefix, sortState, columns) {
    columns.forEach(col => {
        const icon = document.getElementById(prefix + col);
        if (!icon) return;
        if (sortState.column === col) { icon.textContent = sortState.ascending ? '↑' : '↓'; icon.className = 'ml-1 text-blue-600'; }
        else { icon.textContent = '↕'; icon.className = 'ml-1 text-gray-400'; }
    });
}

function sortAdoption(column) {
    if (adoptionSort.column === column) adoptionSort.ascending = !adoptionSort.ascending;
    else { adoptionSort.column = column; adoptionSort.ascending = false; }
    renderAdoptionTable();
}
function sortPertinence(column) {
    if (pertinenceSort.column === column) pertinenceSort.ascending = !pertinenceSort.ascending;
    else { pertinenceSort.column = column; pertinenceSort.ascending = false; }
    renderPertinenceTable();
}
window.sortAdoption = sortAdoption;
window.sortPertinence = sortPertinence;

// ==================== REFRESH (recalcule tout) ====================

function refreshAll() {
    currentStats = calculateAgencyStatistics();
    updatePeriodBadge();
    updateSynthese(currentStats);
    renderAdoptionTable();
    renderPertinenceTable();
    updateAdoptionTimeChart();
    updateAdoptionRankChart();
    updateDescriptifCompareChart();
    updateQuadrantChart();
}

function updatePeriodBadge() {
    const badge = document.getElementById('period-badge');
    const fmt = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : null;
    let txt = 'Période : tout l\'historique';
    if (dateFilter.startDate && dateFilter.endDate) txt = `Période : ${fmt(dateFilter.startDate)} → ${fmt(dateFilter.endDate)}`;
    else if (dateFilter.startDate) txt = `Période : depuis le ${fmt(dateFilter.startDate)}`;
    else if (dateFilter.endDate) txt = `Période : jusqu'au ${fmt(dateFilter.endDate)}`;
    badge.textContent = txt;
    const spsBadge = document.getElementById('sps-excluded-badge');
    if (spsBadge) spsBadge.textContent = spsExcludedFromEffectif > 0
        ? `· ${spsExcludedFromEffectif} collaborateur${spsExcludedFromEffectif > 1 ? 's' : ''} retiré${spsExcludedFromEffectif > 1 ? 's' : ''} de l'effectif`
        : (spsEmails.size ? `· ${spsEmails.size} email${spsEmails.size > 1 ? 's' : ''} SPS exclus des usages` : '');
}

// ==================== CHART 1 : ADOPTION DANS LE TEMPS ====================
// (courbe multi-outils, taux d'adoption cumulé = users / effectif filtré)

function updateAdoptionTimeChart() {
    if (!adoptionChartEl) return;

    const allSources = [
        { data: descriptifData, tool: 'descriptif', filter: (item) => (!item.type || item.type === DESCRIPTIF_TYPE) && getDescWordCount(item) >= 100 },
        { data: autocontactData, tool: 'autocontact', filter: (item) => item.fromAI && !item.contractNumber.toUpperCase().includes('YIELD') },
        { data: comparateurData, tool: 'comparateur', filter: () => true },
        { data: expertBTPData, tool: 'expertBTP', filter: () => true },
        { data: chatBTPData, tool: 'chatBTP', filter: () => true },
        { data: geotechData, tool: 'geotech', filter: () => true }
    ];

    const isCountable = (email) => {
        if (!email) return false;
        const e = email.toLowerCase().trim();
        if (spsEmails.has(e)) return false;
        if (Object.keys(emailToAgency).length > 0) return !!emailToAgency[e];
        return e.includes('@btp-consultants.fr') || e.includes('@citae.fr');
    };

    const allDates = [];
    allSources.forEach(source => {
        getFilteredData(source.data).forEach(item => {
            if (!source.filter(item) || !item.createdAt) return;
            const date = parseFrenchDate(item.createdAt);
            if (date) allDates.push(date);
        });
    });
    d3.select(adoptionChartEl).selectAll('*').remove();
    if (allDates.length === 0) return;

    const monthlyGroups = {};
    let minDate = null, maxDate = null;
    allDates.forEach(date => {
        const y = date.getFullYear(), m = date.getMonth();
        const key = `${y}-${String(m + 1).padStart(2, '0')}`;
        if (!monthlyGroups[key]) monthlyGroups[key] = new Date(y, m, 1);
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
    });
    if (minDate && maxDate) {
        const current = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
        const end = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
        while (current <= end) {
            const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlyGroups[key]) monthlyGroups[key] = new Date(current.getFullYear(), current.getMonth(), 1);
            current.setMonth(current.getMonth() + 1);
        }
    }

    const sortedMonths = Object.keys(monthlyGroups).sort();
    const chartData = [];
    const cumulativeUsers = { descriptif: new Set(), autocontact: new Set(), comparateur: new Set(), expertBTP: new Set(), chatBTP: new Set(), geotech: new Set() };

    // Effectif filtré (selon direction/agence sélectionnée)
    let filteredEffectif = 0;
    const selectedDirection = directionFilterEl.value;
    const selectedAgency = agencyFilterEl.value;
    if (selectedAgency) {
        const agencyCode = (selectedAgency || '').trim().toUpperCase();
        filteredEffectif = agencyPopulation[agencyCode] || 0;
    } else if (selectedDirection) {
        Object.keys(agencyPopulation).forEach(code => {
            const dir = agencyToDR[code] || agencyToDirection[code] || '';
            if (dir === selectedDirection) filteredEffectif += agencyPopulation[code] || 0;
        });
    } else {
        filteredEffectif = Object.values(agencyPopulation).reduce((s, e) => s + e, 0);
    }

    const tools = ['descriptif', 'autocontact', 'comparateur', 'expertBTP', 'chatBTP', 'geotech'];
    sortedMonths.forEach(monthKey => {
        const monthDate = monthlyGroups[monthKey];
        const [year, month] = monthKey.split('-').map(Number);
        allSources.forEach(source => {
            getFilteredData(source.data).forEach(item => {
                if (!source.filter(item) || !item.createdAt) return;
                const date = parseFrenchDate(item.createdAt);
                if (date && date.getFullYear() === year && date.getMonth() === month - 1 && isCountable(item.email)) {
                    cumulativeUsers[source.tool].add(item.email.toLowerCase().trim());
                }
            });
        });
        const rates = {};
        tools.forEach(tool => { rates[tool] = filteredEffectif > 0 ? (cumulativeUsers[tool].size / filteredEffectif) * 100 : 0; });
        chartData.push({ date: monthDate, ...rates });
    });

    adoptionChartEl.style.width = '100%';
    void adoptionChartEl.offsetHeight;
    let containerWidth = adoptionChartEl.offsetWidth || adoptionChartEl.clientWidth || 800;
    const margin = { top: 20, right: 150, bottom: 60, left: 60 };
    const width = Math.max(400, containerWidth - margin.left - margin.right);
    const height = 320;
    const svg = d3.select(adoptionChartEl).append('svg').attr('width', width + margin.left + margin.right).attr('height', height + margin.top + margin.bottom);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleTime().domain(d3.extent(chartData, d => d.date)).range([0, width]);
    let maxValue = 0;
    tools.forEach(tool => { const tm = d3.max(chartData, d => d[tool] || 0); if (tm > maxValue) maxValue = tm; });
    const y = d3.scaleLinear().domain([0, Math.max(10, Math.ceil(maxValue * 1.1))]).nice().range([height, 0]);

    const colors = { descriptif: '#3B82F6', autocontact: '#10B981', comparateur: '#F59E0B', expertBTP: '#EF4444', chatBTP: '#8B5CF6', geotech: '#0EA5E9' };
    const toolLabels = { descriptif: 'Descriptif', autocontact: 'Auto Contact', comparateur: 'Comparateur', expertBTP: 'Expert BTP', chatBTP: 'Chat BTP', geotech: 'Géotech' };
    const visibility = {}; tools.forEach(t => visibility[t] = true);

    // grid
    g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(8).tickSize(-width).tickFormat('')).selectAll('line').style('stroke', '#e5e7eb').style('stroke-dasharray', '3,3');

    // axes
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${height})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%m/%Y')));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(8).tickFormat(d => d + '%'));
    g.append('text').attr('transform', 'rotate(-90)').attr('y', -margin.left).attr('x', -(height / 2)).attr('dy', '1em').style('text-anchor', 'middle').style('font-size', '12px').text("Taux d'adoption (%)");

    const tooltip = g.append('g').style('opacity', 0).style('pointer-events', 'none');
    const tooltipText = tooltip.append('text').style('font-size', '13px').style('font-weight', 'bold').style('text-anchor', 'middle');
    const highlight = g.append('circle').attr('r', 6).attr('fill', 'none').attr('stroke-width', 2).style('opacity', 0);

    tools.forEach(tool => {
        const line = d3.line().x(d => x(d.date)).y(d => y(d[tool] || 0)).curve(d3.curveMonotoneX);
        g.append('path').datum(chartData).attr('class', `line line-${tool}`).attr('d', line).attr('stroke', colors[tool]).attr('stroke-width', 2).attr('fill', 'none').style('pointer-events', 'none');
        g.selectAll(`.dot-${tool}`).data(chartData).enter().append('circle').attr('class', `dot-${tool}`).attr('cx', d => x(d.date)).attr('cy', d => y(d[tool] || 0)).attr('r', 3.5).attr('fill', colors[tool]).style('pointer-events', 'none');
    });

    const findClosest = (mx, my) => {
        let best = null, bestDist = Infinity;
        tools.forEach(tool => {
            if (!visibility[tool]) return;
            chartData.forEach(d => {
                const dx = mx - x(d.date), dy = my - y(d[tool] || 0);
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < bestDist) { bestDist = dist; best = { tool, point: d }; }
            });
        });
        return (best && bestDist < 30) ? best : null;
    };
    g.append('rect').attr('width', width).attr('height', height).attr('fill', 'transparent').style('cursor', 'crosshair')
        .on('mousemove', function (event) {
            const [mx, my] = d3.pointer(event, g.node());
            const c = findClosest(mx, my);
            if (!c) { tooltip.style('opacity', 0); highlight.style('opacity', 0); return; }
            const px = x(c.point.date), py = y(c.point[c.tool] || 0);
            tooltipText.selectAll('tspan').remove();
            tooltipText.append('tspan').attr('x', 0).attr('dy', '-1.2em').style('font-size', '11px').style('font-weight', 'normal').style('fill', '#6b7280').text(d3.timeFormat('%m/%Y')(c.point.date));
            tooltipText.append('tspan').attr('x', 0).attr('dy', '1.2em').style('fill', colors[c.tool]).text(`${toolLabels[c.tool]}: ${(c.point[c.tool] || 0).toFixed(1)}%`);
            tooltip.attr('transform', `translate(${Math.max(50, Math.min(px, width - 50))}, ${py < 30 ? py + 25 : py - 25})`).style('opacity', 1);
            highlight.attr('cx', px).attr('cy', py).attr('stroke', colors[c.tool]).style('opacity', 1);
        })
        .on('mouseleave', () => { tooltip.style('opacity', 0); highlight.style('opacity', 0); });

    const legend = g.append('g').attr('transform', `translate(${width + 20}, 0)`);
    tools.forEach((tool, i) => {
        const row = legend.append('g').attr('transform', `translate(0, ${i * 24})`).style('cursor', 'pointer')
            .on('click', () => {
                visibility[tool] = !visibility[tool];
                const op = visibility[tool] ? 1 : 0.15;
                g.selectAll(`.line-${tool}`).style('opacity', op);
                g.selectAll(`.dot-${tool}`).style('opacity', op);
                row.style('opacity', visibility[tool] ? 1 : 0.4);
            });
        row.append('line').attr('x1', 0).attr('x2', 18).attr('y1', 9).attr('y2', 9).attr('stroke', colors[tool]).attr('stroke-width', 2);
        row.append('circle').attr('cx', 9).attr('cy', 9).attr('r', 3.5).attr('fill', colors[tool]);
        row.append('text').attr('x', 24).attr('y', 9).attr('dy', '.35em').style('font-size', '12px').text(toolLabels[tool]);
    });
}

// ==================== CHART 2 : CLASSEMENT ADOPTION GLOBALE ====================

function updateAdoptionRankChart() {
    const el = document.getElementById('adoption-rank-chart');
    if (!el) return;
    d3.select(el).selectAll('*').remove();

    const data = currentStats.filter(s => s.effectif > 0 && s.adoptionGlobale != null && s.agencyCode !== '__NONE__')
        .sort((a, b) => b.adoptionGlobale - a.adoptionGlobale);
    if (data.length === 0) { el.innerHTML = '<p class="text-sm text-gray-400 text-center py-8">Aucune agence à effectif connu.</p>'; return; }

    const rowH = 26;
    const margin = { top: 10, right: 60, bottom: 30, left: 150 };
    let containerWidth = el.offsetWidth || el.clientWidth || 800;
    const width = Math.max(400, containerWidth - margin.left - margin.right);
    const height = data.length * rowH;
    const svg = d3.select(el).append('svg').attr('width', width + margin.left + margin.right).attr('height', height + margin.top + margin.bottom);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([0, Math.max(10, d3.max(data, d => d.adoptionGlobale) * 1.1)]).range([0, width]);
    const yb = d3.scaleBand().domain(data.map(d => d.agency)).range([0, height]).padding(0.18);

    g.append('g').attr('transform', `translate(0,${height})`).attr('class', 'axis').call(d3.axisBottom(x).ticks(6).tickFormat(d => d + '%'));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(yb)).selectAll('text').style('font-size', '11px');

    const color = (r) => r >= 50 ? '#22c55e' : r >= 30 ? '#eab308' : r >= 20 ? '#f97316' : '#ef4444';
    g.selectAll('.bar').data(data).enter().append('rect')
        .attr('x', 0).attr('y', d => yb(d.agency)).attr('height', yb.bandwidth()).attr('width', d => x(d.adoptionGlobale))
        .attr('fill', d => color(d.adoptionGlobale)).attr('rx', 3)
        .append('title').text(d => `${d.agency} — ${d.adoptionGlobale.toFixed(1)}% (effectif ${d.effectif})`);
    g.selectAll('.lbl').data(data).enter().append('text')
        .attr('x', d => x(d.adoptionGlobale) + 6).attr('y', d => yb(d.agency) + yb.bandwidth() / 2).attr('dy', '.35em')
        .style('font-size', '11px').style('fill', '#374151').text(d => d.adoptionGlobale.toFixed(0) + '%');
}

// ==================== CHART 3 : ADOPTION vs COUVERTURE (DESCRIPTIF) ====================

function updateDescriptifCompareChart() {
    const el = document.getElementById('descriptif-compare-chart');
    if (!el) return;
    d3.select(el).selectAll('*').remove();

    // Agences avec gisement éligible ET effectif connu (les deux mesures définies)
    const data = currentStats.filter(s => s.eligibles > 0 && s.effectif > 0)
        .map(s => ({ agency: s.agency, adoption: s.adoptionDescriptif || 0, couverture: s.couverture || 0 }))
        .sort((a, b) => b.couverture - a.couverture);
    if (data.length === 0) { el.innerHTML = '<p class="text-sm text-gray-400 text-center py-8">Aucune agence avec affaires éligibles et effectif connu.</p>'; return; }

    const margin = { top: 20, right: 20, bottom: 90, left: 50 };
    let containerWidth = el.offsetWidth || el.clientWidth || 800;
    const width = Math.max(400, containerWidth - margin.left - margin.right);
    const height = 300;
    const svg = d3.select(el).append('svg').attr('width', width + margin.left + margin.right).attr('height', height + margin.top + margin.bottom);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x0 = d3.scaleBand().domain(data.map(d => d.agency)).range([0, width]).padding(0.25);
    const x1 = d3.scaleBand().domain(['adoption', 'couverture']).range([0, x0.bandwidth()]).padding(0.08);
    const y = d3.scaleLinear().domain([0, Math.max(10, d3.max(data, d => Math.max(d.adoption, d.couverture)) * 1.1)]).nice().range([height, 0]);

    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(6).tickFormat(d => d + '%'));
    g.append('g').attr('transform', `translate(0,${height})`).attr('class', 'axis').call(d3.axisBottom(x0))
        .selectAll('text').attr('transform', 'rotate(-40)').style('text-anchor', 'end').style('font-size', '10px');

    const colors = { adoption: '#10B981', couverture: '#8B5CF6' };
    const groups = g.selectAll('.grp').data(data).enter().append('g').attr('transform', d => `translate(${x0(d.agency)},0)`);
    ['adoption', 'couverture'].forEach(key => {
        groups.append('rect')
            .attr('x', x1(key)).attr('y', d => y(d[key])).attr('width', x1.bandwidth()).attr('height', d => height - y(d[key]))
            .attr('fill', colors[key]).attr('rx', 2)
            .append('title').text(d => `${d.agency} — ${key === 'adoption' ? 'Adoption' : 'Couverture'} ${d[key].toFixed(1)}%`);
    });
}

// ==================== CHART 4 : QUADRANT ADOPTION × COUVERTURE ====================

function updateQuadrantChart() {
    const el = document.getElementById('descriptif-quadrant-chart');
    if (!el) return;
    d3.select(el).selectAll('*').remove();

    const data = currentStats.filter(s => s.eligibles > 0 && s.effectif > 0 && s.adoptionDescriptif != null && s.couverture != null)
        .map(s => ({ agency: s.agency, x: s.adoptionDescriptif, y: s.couverture, effectif: s.effectif }));
    if (data.length === 0) { el.innerHTML = '<p class="text-sm text-gray-400 text-center py-8">Données insuffisantes pour la cartographie.</p>'; return; }

    const margin = { top: 20, right: 20, bottom: 50, left: 55 };
    let containerWidth = el.offsetWidth || el.clientWidth || 800;
    const width = Math.max(400, containerWidth - margin.left - margin.right);
    const height = 360;
    const svg = d3.select(el).append('svg').attr('width', width + margin.left + margin.right).attr('height', height + margin.top + margin.bottom);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xMax = Math.max(10, d3.max(data, d => d.x) * 1.15);
    const yMax = Math.max(10, d3.max(data, d => d.y) * 1.15);
    const x = d3.scaleLinear().domain([0, xMax]).range([0, width]);
    const y = d3.scaleLinear().domain([0, yMax]).range([height, 0]);
    const r = d3.scaleSqrt().domain([0, d3.max(data, d => d.effectif) || 1]).range([4, 22]);
    const meanX = d3.mean(data, d => d.x), meanY = d3.mean(data, d => d.y);

    // Quadrant guides (moyennes)
    g.append('line').attr('x1', x(meanX)).attr('x2', x(meanX)).attr('y1', 0).attr('y2', height).attr('stroke', '#cbd5e1').attr('stroke-dasharray', '4,4');
    g.append('line').attr('x1', 0).attr('x2', width).attr('y1', y(meanY)).attr('y2', y(meanY)).attr('stroke', '#cbd5e1').attr('stroke-dasharray', '4,4');

    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${height})`).call(d3.axisBottom(x).ticks(6).tickFormat(d => d + '%'));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(6).tickFormat(d => d + '%'));
    g.append('text').attr('x', width / 2).attr('y', height + 40).style('text-anchor', 'middle').style('font-size', '12px').style('fill', '#10B981').text("Adoption Descriptif (% collaborateurs) →");
    g.append('text').attr('transform', 'rotate(-90)').attr('x', -height / 2).attr('y', -42).style('text-anchor', 'middle').style('font-size', '12px').style('fill', '#8B5CF6').text("Couverture (% affaires éligibles) →");

    g.selectAll('.bubble').data(data).enter().append('circle')
        .attr('cx', d => x(d.x)).attr('cy', d => y(d.y)).attr('r', d => r(d.effectif))
        .attr('fill', '#6366f1').attr('fill-opacity', 0.35).attr('stroke', '#4f46e5').attr('stroke-width', 1)
        .append('title').text(d => `${d.agency}\nAdoption ${d.x.toFixed(1)}% · Couverture ${d.y.toFixed(1)}%\nEffectif ${d.effectif}`);
    g.selectAll('.blabel').data(data).enter().append('text')
        .attr('x', d => x(d.x)).attr('y', d => y(d.y) - r(d.effectif) - 3).attr('text-anchor', 'middle')
        .style('font-size', '9px').style('fill', '#475569').text(d => d.agency);
}

// ==================== EVENT LISTENERS ====================

startDateEl.addEventListener('change', () => { dateFilter.startDate = startDateEl.value; refreshAll(); });
endDateEl.addEventListener('change', () => { dateFilter.endDate = endDateEl.value; refreshAll(); });
directionFilterEl.addEventListener('change', () => { populateAgencyFilter(); refreshAll(); });
agencyFilterEl.addEventListener('change', () => { refreshAll(); });
resetFiltersBtn.addEventListener('click', () => {
    startDateEl.value = ''; endDateEl.value = ''; directionFilterEl.value = ''; agencyFilterEl.value = '';
    dateFilter.startDate = null; dateFilter.endDate = null;
    populateAgencyFilter(); refreshAll();
});
logoutBtn.addEventListener('click', () => { localStorage.removeItem('roi_password'); window.location.reload(); });

let resizeTimeout;
window.addEventListener('resize', () => { clearTimeout(resizeTimeout); resizeTimeout = setTimeout(refreshAll, 250); });

// ==================== AUTHENTICATION ====================

async function authenticateWithPassword(password) {
    try {
        const response = await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: password });
        if (!response.ok) return false;
        const result = await response.text();
        const descriptifMatch = result.match(/DESCRIPTIF_URL = '([^']+)'/);
        const autocontactMatch = result.match(/AUTOCONTACT_URL = '([^']+)'/);
        const comparateurMatch = result.match(/COMPARATEUR_URL = '([^']+)'/);
        if (descriptifMatch && autocontactMatch && comparateurMatch) {
            DESCRIPTIF_URL = descriptifMatch[1];
            AUTOCONTACT_URL = autocontactMatch[1];
            COMPARATEUR_URL = comparateurMatch[1];
            return true;
        }
        return false;
    } catch (error) {
        console.error('Authentication error:', error);
        return false;
    }
}

async function checkAuthentication() {
    const storedPassword = localStorage.getItem('roi_password');
    if (storedPassword) {
        const success = await authenticateWithPassword(storedPassword);
        if (success) { loginModal.classList.add('hidden'); await loadData(); return; }
        else localStorage.removeItem('roi_password');
    }
    loginModal.classList.remove('hidden');
    passwordInput.focus();
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = passwordInput.value.trim();
    if (!password) return;
    loginButton.disabled = true; loginText.textContent = 'Connexion...'; loginError.classList.add('hidden');
    const success = await authenticateWithPassword(password);
    if (success) { localStorage.setItem('roi_password', password); loginModal.classList.add('hidden'); await loadData(); }
    else { loginError.classList.remove('hidden'); loginButton.disabled = false; loginText.textContent = 'Se connecter'; passwordInput.value = ''; passwordInput.focus(); }
});

// ==================== DATA LOADING ====================

async function loadData() {
    try {
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');
        mainContentEl.classList.add('hidden');

        // 1) Emails SPS D'ABORD (nécessaire pour exclure SPS de l'effectif au chargement annuaire)
        await loadSpsEmails();

        // 2) Population / annuaire (SPS exclu)
        try {
            const popResponse = await fetch(POPULATION_URL);
            if (popResponse.ok) parsePopulationData(await popResponse.text());
        } catch (e) { console.warn('Erreur chargement population:', e); }

        // 3) Descriptif (+ RICT pour le gisement éligible)
        const descriptifResponse = await fetch(DESCRIPTIF_URL);
        if (!descriptifResponse.ok) throw new Error(`Failed descriptif: ${descriptifResponse.status}`);
        const descriptifRaw = await descriptifResponse.text();
        let descriptifCSV = null;
        try { const j = JSON.parse(descriptifRaw); if (Array.isArray(j) && j[0] && j[0].data) descriptifCSV = j[0].data; } catch (e) {}
        if (descriptifCSV) {
            allRictData = parseDescriptifCSV(descriptifCSV);
            const anyHasType = allRictData.some(item => item.type && item.type.trim() !== '');
            descriptifData = anyHasType ? allRictData.filter(item => item.type === DESCRIPTIF_TYPE) : allRictData;
            const enrich = (item) => { if (!item.direction || item.direction.trim() === '') { const c = item.agency ? item.agency.trim().toUpperCase() : ''; if (c && agencyToDR[c]) item.direction = agencyToDR[c]; } };
            allRictData.forEach(enrich); descriptifData.forEach(enrich);
        }

        // 4) Auto Contact
        const autocontactResponse = await fetch(AUTOCONTACT_URL);
        if (!autocontactResponse.ok) throw new Error(`Failed autocontact: ${autocontactResponse.status}`);
        let autocontactCSV = null;
        try { const j = JSON.parse(await autocontactResponse.text()); if (Array.isArray(j) && j[0] && j[0].data) autocontactCSV = j[0].data; } catch (e) {}
        if (autocontactCSV) {
            autocontactData = parseAutocontactCSV(autocontactCSV);
            autocontactData.forEach(item => { if (!item.direction || item.direction.trim() === '') { const c = item.agency ? item.agency.trim().toUpperCase() : ''; if (c && agencyToDR[c]) item.direction = agencyToDR[c]; } });
        }

        // 5) Comparateur
        const comparateurResponse = await fetch(COMPARATEUR_URL);
        if (!comparateurResponse.ok) throw new Error(`Failed comparateur: ${comparateurResponse.status}`);
        let comparateurCSV = null;
        try { const j = JSON.parse(await comparateurResponse.text()); if (Array.isArray(j) && j[0] && j[0].data) comparateurCSV = j[0].data; } catch (e) {}
        if (comparateurCSV) {
            comparateurData = parseComparateurCSV(comparateurCSV);
            comparateurData.forEach(item => { if (!item.direction || item.direction.trim() === '') { const c = item.agency ? item.agency.trim().toUpperCase() : ''; if (c && agencyToDR[c]) item.direction = agencyToDR[c]; } });
        }

        // 6) Expert BTP (CT)
        try {
            const r = await fetch(EXPERT_BTP_URL);
            if (r.ok) {
                const j = await r.json();
                expertBTPData = j.map(item => {
                    const m = item.metadata || {};
                    const ps = m.productionService || '';
                    const c = ps.trim().toUpperCase();
                    return { id: item.id, email: item.email || '', createdAt: item.createdAt || '', agency: ps, direction: m.management || (c && agencyToDR[c] ? agencyToDR[c] : '') };
                });
            }
        } catch (e) { console.warn('Erreur Expert BTP:', e); }

        // 7) Chat BTP (CT)
        try {
            const r = await fetch(CHAT_BTP_URL);
            if (r.ok) {
                const j = await r.json();
                chatBTPData = j.map(item => {
                    const m = item.metadata || {};
                    const ps = m.productionService || '';
                    const c = ps.trim().toUpperCase();
                    return { id: item.id, email: item.email || '', createdAt: item.createdAt || '', agency: ps, direction: m.management || (c && agencyToDR[c] ? agencyToDR[c] : '') };
                });
            }
        } catch (e) { console.warn('Erreur Chat BTP:', e); }

        // 8) Géotech
        try {
            const r = await fetch(GEOTECH_URL);
            if (r.ok) {
                let geotechCSV = null;
                try { const j = JSON.parse(await r.text()); if (Array.isArray(j) && j[0] && j[0].data) geotechCSV = j[0].data; } catch (e) {}
                if (geotechCSV) {
                    geotechData = parseGeotechCSV(geotechCSV);
                    geotechData.forEach(item => { if (!item.direction || item.direction.trim() === '') { const c = item.agency ? item.agency.trim().toUpperCase() : ''; if (c && agencyToDR[c]) item.direction = agencyToDR[c]; } });
                }
            }
        } catch (e) { console.warn('Erreur Géotech:', e); }

        extractDirectionsAndAgencies();
        populateFilters();

        loadingEl.classList.add('hidden');
        mainContentEl.classList.remove('hidden');

        refreshAll();
        setTimeout(refreshAll, 200); // re-render charts après layout (largeur conteneur)
    } catch (error) {
        console.error('Error loading data:', error);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }
}

// Initialize
checkAuthentication();
