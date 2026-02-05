// Configuration
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordadoption';

// URLs will be fetched from webhook after authentication
let DESCRIPTIF_URL = '';
let AUTOCONTACT_URL = '';
let COMPARATEUR_URL = '';
// Expert BTP Consultants URL (public)
const EXPERT_BTP_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_btpconsultants_ct.json';
// Chat BTP Consultants URL (public)
const CHAT_BTP_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_btpconsultants_ct.json';
// Default Population URL (public)
const POPULATION_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/population_cible.csv';

// Constants
const DESCRIPTIF_TYPE = 'DESCRIPTIF_SOMMAIRE_DES_TRAVAUX';

// State
let allRictData = []; // All RICT data for calculating relevance rate
let descriptifData = [];
let autocontactData = [];
let comparateurData = [];
let expertBTPData = [];
let chatBTPData = [];
let agencyPopulation = {}; // {agencyCode: effectif}
let agencyToDR = {}; // {agencyCode: DR}
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
const directionFilterEl = document.getElementById('direction-filter');
const agencyFilterEl = document.getElementById('agency-filter');
const resetFiltersBtn = document.getElementById('reset-filters');
const agencyTableBodyEl = document.getElementById('agency-table-body');
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
    return str.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
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
                if (timeMatch) {
                    const hours = parseInt(timeMatch[1]);
                    const minutes = parseInt(timeMatch[2]);
                    date.setHours(hours, minutes, 0, 0);
                }
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
    text = text
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/[*_`]/g, '');
    return text.replace(/\s+/g, ' ').trim();
}

function countWords(text) {
    if (!text || typeof text !== 'string') return 0;
    const words = text.match(/[a-zA-ZÀ-ÿ]+/g);
    return words ? words.length : 0;
}

function parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
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

function parseCSVLineWithCommas(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
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

function extractCSVFromDataField(csvText) {
    const lines = csvText.split('\n');
    if (lines.length > 0 && lines[0].trim() === 'data') {
        const csvLines = lines.slice(1);
        if (csvLines.length > 0 && csvLines[0].startsWith('"')) {
            csvLines[0] = csvLines[0].substring(1);
        }
        if (csvLines.length > 0 && csvLines[csvLines.length - 1].trim() === '"') {
            csvLines.pop();
        } else if (csvLines.length > 0 && csvLines[csvLines.length - 1].endsWith('"')) {
            csvLines[csvLines.length - 1] = csvLines[csvLines.length - 1].slice(0, -1);
        }
        return csvLines.join('\n').trim();
    }
    return csvText;
}

function fixEncoding(text) {
    const replacements = {
        'Ã©': 'é', 'Ã¨': 'è', 'Ãª': 'ê', 'Ã ': 'à', 'Ã¢': 'â', 'Ã´': 'ô', 'Ã»': 'û',
        'Ã§': 'ç', 'Ã«': 'ë', 'Ã¯': 'ï', 'Ã¼': 'ü', 'Ã': 'É', 'Ã': 'È', 'Ã': 'À', 'Ã': 'Ç', '�': 'é'
    };
    let fixed = text;
    for (const [bad, good] of Object.entries(replacements)) {
        fixed = fixed.replace(new RegExp(bad, 'g'), good);
    }
    return fixed;
}

// ==================== DATA PARSING ====================

function parseDescriptifCSV(csvString) {
    if (!csvString || typeof csvString !== 'string') return [];
    let csvText = csvString.trim();
    while (csvText.startsWith('[') || csvText.startsWith('{')) {
        csvText = csvText.substring(1).trim();
    }
    while (csvText.endsWith(']') || csvText.endsWith('}')) {
        csvText = csvText.substring(0, csvText.length - 1).trim();
    }
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) return [];
    const headers = parseCSVLine(lines[0]);
    let typeIndex = -1, contractIndex = -1, diffusedAtIndex = -1, emailIndex = -1;
    let agencyIndex = -1, managementIndex = -1, descriptionIndex = -1, aiResultIndex = -1;
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toLowerCase();
        if (typeIndex === -1 && header.includes('aideliver') && header.includes('type')) typeIndex = i;
        if (contractIndex === -1 && header.includes('contractnumber')) contractIndex = i;
        if (diffusedAtIndex === -1 && header.includes('report') && header.includes('diffusedat')) diffusedAtIndex = i;
        if (emailIndex === -1 && header.includes('user') && header.includes('email')) emailIndex = i;
        if (agencyIndex === -1 && header.includes('productionservice')) agencyIndex = i;
        if (managementIndex === -1 && header.includes('management')) managementIndex = i;
        if (descriptionIndex === -1 && header.includes('description') && !header.includes('complement')) descriptionIndex = i;
        if (aiResultIndex === -1 && (header.includes('longresult') || header.includes('result'))) aiResultIndex = i;
    }
    if (typeIndex === -1 || contractIndex === -1) return [];
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < headers.length / 2) continue;
        data.push({
            type: (values[typeIndex] || '').trim(),
            contractNumber: (values[contractIndex] || '').trim(),
            createdAt: (diffusedAtIndex >= 0 ? values[diffusedAtIndex] : '').trim(),
            email: (emailIndex >= 0 ? values[emailIndex] : '').trim(),
            agency: ((agencyIndex >= 0 ? values[agencyIndex] : '') || '').trim(),
            direction: ((managementIndex >= 0 ? values[managementIndex] : '') || '').trim(),
            description: descriptionIndex >= 0 ? values[descriptionIndex] : '',
            aiResult: aiResultIndex >= 0 ? values[aiResultIndex] : ''
        });
    }
    return data;
}

function parseAutocontactCSV(csvString) {
    if (!csvString || typeof csvString !== 'string') return [];
    let csvText = csvString.trim();
    while (csvText.startsWith('[') || csvText.startsWith('{')) {
        csvText = csvText.substring(1).trim();
    }
    while (csvText.endsWith(']') || csvText.endsWith('}')) {
        csvText = csvText.substring(0, csvText.length - 1).trim();
    }
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) return [];
    const headers = parseCSVLine(lines[0]);
    let contractIndex = -1, fromAIIndex = -1, emailIndex = -1, createdAtIndex = -1;
    let agencyIndex = -1, managementIndex = -1;
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toLowerCase();
        if (contractIndex === -1 && header.includes('contractnumber')) contractIndex = i;
        if (fromAIIndex === -1 && (header.includes('fromai') || header.includes('from_ai'))) fromAIIndex = i;
        if (emailIndex === -1 && header.includes('user') && header.includes('email')) emailIndex = i;
        if (createdAtIndex === -1 && (header.includes('createdat') || header.includes('created_at'))) createdAtIndex = i;
        if (agencyIndex === -1 && header.includes('productionservice')) agencyIndex = i;
        if (managementIndex === -1 && header.includes('management')) managementIndex = i;
    }
    if (contractIndex === -1) return [];
    if (emailIndex === -1) {
        for (let rowIdx = 1; rowIdx < Math.min(10, lines.length); rowIdx++) {
            const values = parseCSVLine(lines[rowIdx]);
            for (let colIdx = 0; colIdx < values.length; colIdx++) {
                if (values[colIdx] && values[colIdx].includes('@btp-consultants.fr')) {
                    emailIndex = colIdx;
                    break;
                }
            }
            if (emailIndex !== -1) break;
        }
    }
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < headers.length / 2) continue;
        data.push({
            contractNumber: (values[contractIndex] || '').trim(),
            fromAI: fromAIIndex >= 0 ? (values[fromAIIndex] || '').toLowerCase() === 'true' : false,
            email: (emailIndex >= 0 ? values[emailIndex] : '').trim(),
            createdAt: (createdAtIndex >= 0 ? values[createdAtIndex] : '').trim(),
            agency: ((agencyIndex >= 0 ? values[agencyIndex] : '') || '').trim(),
            direction: ((managementIndex >= 0 ? values[managementIndex] : '') || '').trim()
        });
    }
    return data;
}

function parseComparateurCSV(csvString) {
    if (!csvString || typeof csvString !== 'string') return [];
    let csvText = csvString.trim();
    while (csvText.startsWith('[') || csvText.startsWith('{')) {
        csvText = csvText.substring(1).trim();
    }
    while (csvText.endsWith(']') || csvText.endsWith('}')) {
        csvText = csvText.substring(0, csvText.length - 1).trim();
    }
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) return [];
    const headers = parseCSVLine(lines[0]);
    let contractIndex = -1, emailIndex = -1, longResultIndex = -1, agencyIndex = -1, managementIndex = -1;
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        const headerLower = header.toLowerCase();
        if (contractIndex === -1 && (headerLower.includes('contractnumber') || header.includes('SubAffairDetailId'))) contractIndex = i;
        if (emailIndex === -1 && header.includes('User') && header.includes('Email')) emailIndex = i;
        if (longResultIndex === -1 && headerLower === 'longresult') longResultIndex = i;
        if (agencyIndex === -1 && headerLower.includes('productionservice')) agencyIndex = i;
        if (managementIndex === -1 && headerLower.includes('management')) managementIndex = i;
    }
    if (contractIndex === -1 || longResultIndex === -1) return [];
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < headers.length / 2) continue;
        let maxPage = 0;
        try {
            const longResult = JSON.parse(values[longResultIndex] || '{}');
            if (longResult && longResult.indexComparator && longResult.indexComparator.items) {
                longResult.indexComparator.items.forEach(item => {
                    if (item.page !== undefined && item.page !== null) {
                        const pageNum = typeof item.page === 'number' ? item.page : parseInt(item.page);
                        if (!isNaN(pageNum)) maxPage = Math.max(maxPage, pageNum);
                    }
                });
            }
        } catch (e) {}
        data.push({
            contractNumber: (values[contractIndex] || '').trim(),
            email: (emailIndex >= 0 ? values[emailIndex] : '').trim(),
            agency: ((agencyIndex >= 0 ? values[agencyIndex] : '') || '').trim(),
            direction: ((managementIndex >= 0 ? values[managementIndex] : '') || '').trim(),
            maxPage: maxPage
        });
    }
    return data;
}

function parsePopulationData(csvString) {
    if (!csvString || typeof csvString !== 'string') return;
    let csvText = fixEncoding(csvString);
    csvText = extractCSVFromDataField(csvText);
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) return;
    agencyPopulation = {};
    agencyToDR = {};
    for (let i = 1; i < lines.length; i++) {
        const parts = parseCSVLineWithCommas(lines[i]);
        if (parts.length >= 3) {
            const dr = parts[0].trim();
            const agencyCode = parts[1].trim().toUpperCase();
            const effectif = parseInt(parts[2].trim());
            if (agencyCode && !isNaN(effectif)) {
                agencyPopulation[agencyCode] = effectif;
                agencyToDR[agencyCode] = dr;
                // Also map agency code to direction for lookup
                agencyToDirection[agencyCode] = dr;
            }
        }
    }
}

// ==================== FILTERS ====================

function getFilteredData(data) {
    return data.filter(item => {
        if (dateFilter.startDate || dateFilter.endDate) {
            const itemDate = parseFrenchDate(item.createdAt);
            if (!itemDate) return false;
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
        const direction = directionFilterEl.value;
        if (direction && item.direction !== direction) return false;
        const agency = agencyFilterEl.value;
        if (agency && item.agency !== agency) return false;
        return true;
    });
}

function extractDirectionsAndAgencies() {
    const directions = new Set();
    const agencies = new Set();
    // agencyToDirection is already populated from population data
    // Now enrich it with data from items
    const processItems = (items) => {
        items.forEach(item => {
            const dir = item.direction;
            const ag = item.agency;
            if (ag) agencies.add(ag);
            
            // Try to get direction from multiple sources
            let finalDirection = dir;
            if (!finalDirection && ag) {
                // Try to get from agencyToDR (from population)
                const agencyCode = ag.trim().toUpperCase();
                if (agencyToDR[agencyCode]) {
                    finalDirection = agencyToDR[agencyCode];
                } else if (agencyToDirection[agencyCode]) {
                    finalDirection = agencyToDirection[agencyCode];
                } else if (agencyToDirection[ag]) {
                    finalDirection = agencyToDirection[ag];
                }
            }
            
            if (finalDirection) {
                directions.add(finalDirection);
                if (ag) {
                    // Map agency to direction
                    agencyToDirection[ag] = finalDirection;
                    // Also map by agency code if we can extract it
                    const agencyCode = ag.trim().toUpperCase();
                    if (agencyCode !== ag) {
                        agencyToDirection[agencyCode] = finalDirection;
                    }
                }
            }
        });
    };
    processItems(allRictData);
    processItems(descriptifData);
    processItems(autocontactData);
    processItems(comparateurData);
    processItems(expertBTPData);
    processItems(chatBTPData);
    availableDirections = Array.from(directions).sort();
    availableAgencies = Array.from(agencies).sort();
}

function populateFilters() {
    directionFilterEl.innerHTML = '<option value="">Toutes les directions</option>';
    availableDirections.forEach(dir => {
        const option = document.createElement('option');
        option.value = dir;
        option.textContent = dir;
        directionFilterEl.appendChild(option);
    });
    populateAgencyFilter();
}

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
    if (currentAgency && filteredAgencies.includes(currentAgency)) {
        agencyFilterEl.value = currentAgency;
    }
}

// ==================== CALCULATE STATISTICS ====================

function calculateAgencyStatistics() {
    const statsMap = {};
    
    // Helper to get direction for an item
    const getDirectionForItem = (item) => {
        if (item.direction && item.direction.trim() !== '') {
            return item.direction.trim();
        }
        // Try to get from agency code mapping
        const agencyCode = item.agency ? item.agency.trim().toUpperCase() : '';
        if (agencyCode && agencyToDR[agencyCode]) {
            return agencyToDR[agencyCode];
        }
        if (agencyCode && agencyToDirection[agencyCode]) {
            return agencyToDirection[agencyCode];
        }
        if (item.agency && agencyToDirection[item.agency]) {
            return agencyToDirection[item.agency];
        }
        return 'Non spécifiée';
    };
    
    // Calculate relevance rate for descriptif (like sup 100 mots)
    const allRictFiltered = getFilteredData(allRictData);
    allRictFiltered.forEach(item => {
        const direction = getDirectionForItem(item);
        const agency = item.agency || 'Non spécifiée';
        const key = `${direction}|${agency}`;
        if (!statsMap[key]) {
            statsMap[key] = {
                direction: direction,
                agency: agency,
                contractsWithRICT100Plus: new Set(),
                contractsWithAIOrRICT100Plus: new Set(),
                usersDescriptif: new Set(),
                usersAutocontact: new Set(),
                usersComparateur: new Set(),
                usersExpertBTP: new Set(),
                usersChatBTP: new Set(),
                descriptifCount: 0,
                autocontactCount: 0,
                comparateurCount: 0,
                expertBTPCount: 0,
                chatBTPCount: 0
            };
        }
        const stats = statsMap[key];
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            const processedDesc = extractText(item.description || '');
            const descWordCount = countWords(processedDesc);
            if (descWordCount > 100) {
                stats.contractsWithRICT100Plus.add(item.contractNumber);
            }
        }
    });
    
    // Process descriptif data for relevance rate
    const descriptifFiltered = getFilteredData(descriptifData);
    descriptifFiltered.forEach(item => {
        const direction = getDirectionForItem(item);
        const agency = item.agency || 'Non spécifiée';
        const key = `${direction}|${agency}`;
        if (!statsMap[key]) {
            statsMap[key] = {
                direction: direction,
                agency: agency,
                contractsWithRICT100Plus: new Set(),
                contractsWithAIOrRICT100Plus: new Set(),
                usersDescriptif: new Set(),
                usersAutocontact: new Set(),
                usersComparateur: new Set(),
                usersExpertBTP: new Set(),
                usersChatBTP: new Set(),
                descriptifCount: 0,
                autocontactCount: 0,
                comparateurCount: 0,
                expertBTPCount: 0,
                chatBTPCount: 0
            };
        }
        const stats = statsMap[key];
        const processedDesc = extractText(item.description || '');
        const descWordCount = countWords(processedDesc);
        if (item.contractNumber && item.contractNumber.trim() !== '' && descWordCount > 100) {
            stats.contractsWithAIOrRICT100Plus.add(item.contractNumber);
        }
        if (item.type === DESCRIPTIF_TYPE) {
            stats.descriptifCount++;
            if (item.email && (item.email.includes('@btp-consultants.fr') || item.email.includes('@citae.fr'))) {
                stats.usersDescriptif.add(item.email);
            }
        }
    });
    
    // Process autocontact data
    const autocontactFiltered = getFilteredData(autocontactData);
    autocontactFiltered.forEach(item => {
        if (!item.contractNumber.toUpperCase().includes('YIELD') && item.fromAI) {
            const direction = getDirectionForItem(item);
            const agency = item.agency || 'Non spécifiée';
            const key = `${direction}|${agency}`;
            if (!statsMap[key]) {
                statsMap[key] = {
                    direction: direction,
                    agency: agency,
                    contractsWithRICT100Plus: new Set(),
                    contractsWithAIOrRICT100Plus: new Set(),
                    usersDescriptif: new Set(),
                    usersAutocontact: new Set(),
                    usersComparateur: new Set(),
                    usersExpertBTP: new Set(),
                    usersChatBTP: new Set(),
                    descriptifCount: 0,
                    autocontactCount: 0,
                    comparateurCount: 0,
                    expertBTPCount: 0,
                    chatBTPCount: 0
                };
            }
            const stats = statsMap[key];
            stats.autocontactCount++;
            if (item.email && (item.email.includes('@btp-consultants.fr') || item.email.includes('@citae.fr'))) {
                stats.usersAutocontact.add(item.email);
            }
        }
    });
    
    // Process comparateur data
    const comparateurFiltered = getFilteredData(comparateurData);
    comparateurFiltered.forEach(item => {
        const direction = getDirectionForItem(item);
        const agency = item.agency || 'Non spécifiée';
        const key = `${direction}|${agency}`;
        if (!statsMap[key]) {
            statsMap[key] = {
                direction: direction,
                agency: agency,
                contractsWithRICT100Plus: new Set(),
                contractsWithAIOrRICT100Plus: new Set(),
                usersDescriptif: new Set(),
                usersAutocontact: new Set(),
                usersComparateur: new Set(),
                usersExpertBTP: new Set(),
                usersChatBTP: new Set(),
                descriptifCount: 0,
                autocontactCount: 0,
                comparateurCount: 0,
                expertBTPCount: 0,
                chatBTPCount: 0
            };
        }
        const stats = statsMap[key];
        stats.comparateurCount++;
        if (item.email && (item.email.includes('@btp-consultants.fr') || item.email.includes('@citae.fr'))) {
            stats.usersComparateur.add(item.email);
        }
    });
    
    // Process Expert BTP data
    const expertBTPFiltered = getFilteredData(expertBTPData);
    expertBTPFiltered.forEach(item => {
        const direction = getDirectionForItem(item);
        const agency = item.agency || 'Non spécifiée';
        const key = `${direction}|${agency}`;
        if (!statsMap[key]) {
            statsMap[key] = {
                direction: direction,
                agency: agency,
                contractsWithRICT100Plus: new Set(),
                contractsWithAIOrRICT100Plus: new Set(),
                usersDescriptif: new Set(),
                usersAutocontact: new Set(),
                usersComparateur: new Set(),
                usersExpertBTP: new Set(),
                usersChatBTP: new Set(),
                descriptifCount: 0,
                autocontactCount: 0,
                comparateurCount: 0,
                expertBTPCount: 0,
                chatBTPCount: 0
            };
        }
        const stats = statsMap[key];
        stats.expertBTPCount++; // Count sessions, not messages
        if (item.email && item.email.includes('@btp-consultants.fr')) {
            stats.usersExpertBTP.add(item.email);
        }
    });
    
    // Process Chat BTP data
    const chatBTPFiltered = getFilteredData(chatBTPData);
    chatBTPFiltered.forEach(item => {
        const direction = getDirectionForItem(item);
        const agency = item.agency || 'Non spécifiée';
        const key = `${direction}|${agency}`;
        if (!statsMap[key]) {
            statsMap[key] = {
                direction: direction,
                agency: agency,
                contractsWithRICT100Plus: new Set(),
                contractsWithAIOrRICT100Plus: new Set(),
                usersDescriptif: new Set(),
                usersAutocontact: new Set(),
                usersComparateur: new Set(),
                usersExpertBTP: new Set(),
                usersChatBTP: new Set(),
                descriptifCount: 0,
                autocontactCount: 0,
                comparateurCount: 0,
                expertBTPCount: 0,
                chatBTPCount: 0
            };
        }
        const stats = statsMap[key];
        stats.chatBTPCount++; // Count sessions, not messages
        if (item.email && item.email.includes('@btp-consultants.fr')) {
            stats.usersChatBTP.add(item.email);
        }
    });
    
    // Convert to array and calculate rates
    const statsArray = Object.values(statsMap).map(stats => {
        // Get agency code
        let agencyCode = null;
        const sampleDescriptif = descriptifData.find(item => item.agency === stats.agency);
        const sampleAutocontact = autocontactData.find(item => item.agency === stats.agency);
        const sampleComparateur = comparateurData.find(item => item.agency === stats.agency);
        const sampleItem = sampleDescriptif || sampleAutocontact || sampleComparateur;
        if (sampleItem) {
            if (sampleItem.agencyCode) {
                agencyCode = sampleItem.agencyCode.trim().toUpperCase();
            } else if (sampleItem.contractNumber) {
                const extracted = extractAgency(sampleItem.contractNumber);
                if (extracted) agencyCode = extracted.trim().toUpperCase();
            } else {
                agencyCode = (stats.agency || '').trim().toUpperCase();
            }
        } else {
            agencyCode = (stats.agency || '').trim().toUpperCase();
        }
        
        // Get direction from mapping if not already set
        let finalDirection = stats.direction;
        if (!finalDirection || finalDirection === 'Non spécifiée') {
            if (agencyCode && agencyToDR[agencyCode]) {
                finalDirection = agencyToDR[agencyCode];
            } else if (stats.agency && agencyToDirection[stats.agency]) {
                finalDirection = agencyToDirection[stats.agency];
            } else if (agencyCode && agencyToDirection[agencyCode]) {
                finalDirection = agencyToDirection[agencyCode];
            } else {
                finalDirection = 'Non spécifiée';
            }
        }
        
        const effectif = agencyCode ? (agencyPopulation[agencyCode] || 0) : 0;
        
        // Relevance rate for descriptif (like sup 100 mots)
        const relevanceRate = stats.contractsWithRICT100Plus.size > 0
            ? (stats.contractsWithAIOrRICT100Plus.size / stats.contractsWithRICT100Plus.size) * 100
            : 0;
        
        // Adoption rates
        const adoptionDescriptif = effectif > 0 ? (stats.usersDescriptif.size / effectif) * 100 : 0;
        const adoptionAutocontact = effectif > 0 ? (stats.usersAutocontact.size / effectif) * 100 : 0;
        const adoptionComparateur = effectif > 0 ? (stats.usersComparateur.size / effectif) * 100 : 0;
        const adoptionExpertBTP = effectif > 0 ? (stats.usersExpertBTP.size / effectif) * 100 : 0;
        const adoptionChatBTP = effectif > 0 ? (stats.usersChatBTP.size / effectif) * 100 : 0;
        
        const total = stats.descriptifCount + stats.autocontactCount + stats.comparateurCount + stats.expertBTPCount + stats.chatBTPCount;
        
        return {
            direction: finalDirection,
            agency: stats.agency,
            relevanceRate: relevanceRate,
            adoptionDescriptif: adoptionDescriptif,
            adoptionAutocontact: adoptionAutocontact,
            adoptionComparateur: adoptionComparateur,
            adoptionExpertBTP: adoptionExpertBTP,
            adoptionChatBTP: adoptionChatBTP,
            total: total
        };
    });
    
    return statsArray;
}

// ==================== UPDATE TABLE ====================

function updateAgencyTable() {
    const stats = calculateAgencyStatistics();
    
    // Sort
    const columnMapping = {
        'direction': 'direction',
        'agency': 'agency',
        'descriptif': 'relevanceRate',
        'autocontact': 'adoptionAutocontact',
        'comparateur': 'adoptionComparateur',
        'expert-btp': 'adoptionExpertBTP',
        'chat-btp': 'adoptionChatBTP',
        'total': 'total'
    };
    
    stats.sort((a, b) => {
        const propertyName = columnMapping[tableSortState.column] || tableSortState.column;
        let valA = a[propertyName];
        let valB = b[propertyName];
        if (valA === undefined || valA === null || isNaN(valA) || !isFinite(valA)) {
            valA = typeof valA === 'string' ? '' : 0;
        }
        if (valB === undefined || valB === null || isNaN(valB) || !isFinite(valB)) {
            valB = typeof valB === 'string' ? '' : 0;
        }
        if (typeof valA === 'string' && typeof valB === 'string') {
            return tableSortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        const numA = typeof valA === 'number' ? valA : parseFloat(valA) || 0;
        const numB = typeof valB === 'number' ? valB : parseFloat(valB) || 0;
        return tableSortState.ascending ? numA - numB : numB - numA;
    });
    
    // Render
    agencyTableBodyEl.innerHTML = '';
    if (stats.length === 0) {
        agencyTableBodyEl.innerHTML = `
            <tr>
                <td colspan="8" class="px-6 py-4 text-center text-gray-500">
                    Aucune donnée disponible
                </td>
            </tr>
        `;
        return;
    }
    
    stats.forEach((stat, index) => {
        const tr = document.createElement('tr');
        tr.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        
        // Helper function to get badge style for any rate
        const getBadgeStyle = (rate) => {
            if (rate === 0 || rate === null || rate === undefined) {
                return { bg: '', text: 'text-gray-500', content: '-' };
            }
            let bg = '';
            let text = 'text-white font-bold';
            if (rate >= 50) {
                bg = 'bg-green-500';
            } else if (rate >= 30) {
                bg = 'bg-yellow-500';
            } else if (rate >= 20) {
                bg = 'bg-orange-500';
            } else {
                bg = 'bg-red-500';
            }
            return { bg, text, content: `${rate.toFixed(1)}%` };
        };
        
        const descriptifBadge = getBadgeStyle(stat.relevanceRate);
        const autocontactBadge = getBadgeStyle(stat.adoptionAutocontact);
        const comparateurBadge = getBadgeStyle(stat.adoptionComparateur);
        const expertBTPBadge = getBadgeStyle(stat.adoptionExpertBTP);
        const chatBTPBadge = getBadgeStyle(stat.adoptionChatBTP);
        
        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${escapeHtml(stat.direction)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${escapeHtml(stat.agency)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-center">
                ${descriptifBadge.content !== '-' ? `<span class="px-3 py-1 rounded-full ${descriptifBadge.bg} ${descriptifBadge.text}">${descriptifBadge.content}</span>` : '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-center">
                ${autocontactBadge.content !== '-' ? `<span class="px-3 py-1 rounded-full ${autocontactBadge.bg} ${autocontactBadge.text}">${autocontactBadge.content}</span>` : '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-center">
                ${comparateurBadge.content !== '-' ? `<span class="px-3 py-1 rounded-full ${comparateurBadge.bg} ${comparateurBadge.text}">${comparateurBadge.content}</span>` : '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-center">
                ${expertBTPBadge.content !== '-' ? `<span class="px-3 py-1 rounded-full ${expertBTPBadge.bg} ${expertBTPBadge.text}">${expertBTPBadge.content}</span>` : '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-center">
                ${chatBTPBadge.content !== '-' ? `<span class="px-3 py-1 rounded-full ${chatBTPBadge.bg} ${chatBTPBadge.text}">${chatBTPBadge.content}</span>` : '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-blue-600 text-center">${formatNumber(stat.total)}</td>
        `;
        agencyTableBodyEl.appendChild(tr);
    });
    
    updateSortIcons();
    updateChart();
}

function updateSortIcons() {
    ['direction', 'agency', 'descriptif', 'autocontact', 'comparateur', 'expert-btp', 'chat-btp', 'total'].forEach(col => {
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

function sortTable(column) {
    if (tableSortState.column === column) {
        tableSortState.ascending = !tableSortState.ascending;
    } else {
        tableSortState.column = column;
        tableSortState.ascending = false;
    }
    updateAgencyTable();
}

window.sortTable = sortTable;

// ==================== CHART ====================

function updateChart() {
    if (!adoptionChartEl) return;
    
    // Calculate adoption rates over time (monthly)
    // We need to calculate rates for each month based on cumulative data
    
    // Collect all data with dates and group by month
    const monthlyStats = {};
    
    // Helper to get agency code
    const getAgencyCode = (item) => {
        if (item.agencyCode) return item.agencyCode.trim().toUpperCase();
        if (item.contractNumber) {
            const extracted = extractAgency(item.contractNumber);
            if (extracted) return extracted.trim().toUpperCase();
        }
        return (item.agency || '').trim().toUpperCase();
    };
    
    // Process all data sources and group by month (cumulative)
    const allSources = [
        { data: descriptifData, tool: 'descriptif', filter: (item) => item.type === DESCRIPTIF_TYPE },
        { data: autocontactData, tool: 'autocontact', filter: (item) => item.fromAI && !item.contractNumber.toUpperCase().includes('YIELD') },
        { data: comparateurData, tool: 'comparateur', filter: () => true },
        { data: expertBTPData, tool: 'expertBTP', filter: () => true },
        { data: chatBTPData, tool: 'chatBTP', filter: () => true }
    ];
    
    // Get all dates and sort them
    const allDates = [];
    allSources.forEach(source => {
        const filtered = getFilteredData(source.data);
        filtered.forEach(item => {
            if (!source.filter(item)) return;
            if (!item.createdAt) return;
            const date = parseFrenchDate(item.createdAt);
            if (date) {
                allDates.push(date);
            }
        });
    });
    
    if (allDates.length === 0) return;
    
    // Group by month
    const monthlyGroups = {};
    allDates.forEach(date => {
        const year = date.getFullYear();
        const month = date.getMonth();
        const key = `${year}-${String(month + 1).padStart(2, '0')}`;
        if (!monthlyGroups[key]) {
            monthlyGroups[key] = new Date(year, month, 1);
        }
    });
    
    // Calculate cumulative adoption rates month by month
    const sortedMonths = Object.keys(monthlyGroups).sort();
    const chartData = [];
    const cumulativeUsers = {
        descriptif: new Set(),
        autocontact: new Set(),
        comparateur: new Set(),
        expertBTP: new Set(),
        chatBTP: new Set()
    };
    
    // Calculate filtered effectif based on current filters
    let filteredEffectif = 0;
    const selectedDirection = directionFilterEl.value;
    const selectedAgency = agencyFilterEl.value;
    
    if (selectedAgency) {
        // If a specific agency is selected, use only that agency's effectif
        // Find the agency code using the same logic as calculateAgencyStatistics
        let agencyCode = null;
        const sampleDescriptif = descriptifData.find(item => item.agency === selectedAgency);
        const sampleAutocontact = autocontactData.find(item => item.agency === selectedAgency);
        const sampleComparateur = comparateurData.find(item => item.agency === selectedAgency);
        const sampleItem = sampleDescriptif || sampleAutocontact || sampleComparateur;
        
        if (sampleItem) {
            if (sampleItem.agencyCode) {
                agencyCode = sampleItem.agencyCode.trim().toUpperCase();
            } else if (sampleItem.contractNumber) {
                const extracted = extractAgency(sampleItem.contractNumber);
                if (extracted) agencyCode = extracted.trim().toUpperCase();
            } else {
                agencyCode = (selectedAgency || '').trim().toUpperCase();
            }
        } else {
            // Try direct match with agency name as code
            agencyCode = (selectedAgency || '').trim().toUpperCase();
        }
        filteredEffectif = agencyCode ? (agencyPopulation[agencyCode] || 0) : 0;
    } else if (selectedDirection) {
        // If a direction is selected, sum effectif for all agencies in that direction
        Object.keys(agencyPopulation).forEach(code => {
            const direction = agencyToDR[code] || agencyToDirection[code] || '';
            if (direction === selectedDirection) {
                filteredEffectif += agencyPopulation[code] || 0;
            }
        });
    } else {
        // No filter: use total effectif
        filteredEffectif = Object.values(agencyPopulation).reduce((sum, eff) => sum + eff, 0);
    }
    
    const tools = ['descriptif', 'autocontact', 'comparateur', 'expertBTP', 'chatBTP'];
    
    sortedMonths.forEach(monthKey => {
        const monthDate = monthlyGroups[monthKey];
        const [year, month] = monthKey.split('-').map(Number);
        
        // Add users from this month
        allSources.forEach(source => {
            const filtered = getFilteredData(source.data);
            filtered.forEach(item => {
                if (!source.filter(item)) return;
                if (!item.createdAt) return;
                const date = parseFrenchDate(item.createdAt);
                if (date && date.getFullYear() === year && date.getMonth() === month - 1) {
                    if (item.email && (item.email.includes('@btp-consultants.fr') || item.email.includes('@citae.fr'))) {
                        cumulativeUsers[source.tool].add(item.email);
                    }
                }
            });
        });
        
        // Calculate rates for this month (cumulative) using filtered effectif
        const rates = {};
        tools.forEach(tool => {
            rates[tool] = filteredEffectif > 0 ? (cumulativeUsers[tool].size / filteredEffectif) * 100 : 0;
        });
        
        chartData.push({
            date: monthDate,
            ...rates
        });
    });
    
    if (chartData.length === 0) return;
    
    // Clear previous chart
    d3.select(adoptionChartEl).selectAll('*').remove();
    
    // Ensure container has dimensions - use the actual container width
    // Force a reflow to get accurate dimensions
    adoptionChartEl.style.width = '100%';
    
    // Force a reflow by accessing offsetHeight
    void adoptionChartEl.offsetHeight;
    
    // Use offsetWidth for more accurate measurement (includes padding/border)
    let containerWidth = adoptionChartEl.offsetWidth;
    
    // If still no width, try clientWidth
    if (!containerWidth || containerWidth === 0) {
        containerWidth = adoptionChartEl.clientWidth;
    }
    
    // If still no width, try parent with padding calculation
    if (!containerWidth || containerWidth === 0) {
        const parentContainer = adoptionChartEl.parentElement;
        if (parentContainer) {
            // Get computed style to account for padding
            const parentStyle = window.getComputedStyle(parentContainer);
            const parentPadding = parseFloat(parentStyle.paddingLeft) + parseFloat(parentStyle.paddingRight);
            containerWidth = parentContainer.clientWidth - parentPadding;
        }
    }
    
    // Final fallback: use window width minus approximate page margins
    if (!containerWidth || containerWidth === 0) {
        containerWidth = Math.max(800, window.innerWidth - 200);
    }
    
    const containerHeight = 400;
    
    const margin = { top: 20, right: 150, bottom: 60, left: 60 };
    const width = Math.max(400, containerWidth - margin.left - margin.right);
    const height = containerHeight - margin.top - margin.bottom;
    
    if (width <= 0 || height <= 0) {
        console.warn('Chart container has invalid dimensions', { containerWidth, width, height });
        // Set a minimum width
        const minWidth = 400;
        const minHeight = 300;
        const svg = d3.select(adoptionChartEl)
            .append('svg')
            .attr('width', minWidth + margin.left + margin.right)
            .attr('height', minHeight + margin.top + margin.bottom);
        svg.append('text')
            .attr('x', (minWidth + margin.left + margin.right) / 2)
            .attr('y', (minHeight + margin.top + margin.bottom) / 2)
            .attr('text-anchor', 'middle')
            .text('Graphique non disponible');
        return;
    }
    
    // Use the full calculated width including margins for the SVG
    const svgWidth = width + margin.left + margin.right;
    const svgHeight = height + margin.top + margin.bottom;
    
    const svg = d3.select(adoptionChartEl)
        .append('svg')
        .attr('width', svgWidth)
        .attr('height', svgHeight);
    
    const g = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);
    
    const x = d3.scaleTime()
        .domain(d3.extent(chartData, d => d.date))
        .range([0, width]);
    
    // Calculate max value across all tools for dynamic Y scale
    let maxValue = 0;
    tools.forEach(tool => {
        const toolMax = d3.max(chartData, d => d[tool] || 0);
        if (toolMax > maxValue) {
            maxValue = toolMax;
        }
    });
    
    // Set Y domain dynamically, with a minimum of 10% and add some padding
    const yMax = Math.max(10, Math.ceil(maxValue * 1.1)); // Add 10% padding, minimum 10%
    const y = d3.scaleLinear()
        .domain([0, yMax])
        .nice()
        .range([height, 0]);
    
    const colors = {
        descriptif: '#3B82F6',
        autocontact: '#10B981',
        comparateur: '#F59E0B',
        expertBTP: '#EF4444',
        chatBTP: '#8B5CF6'
    };
    
    const toolLabels = {
        descriptif: 'Descriptif',
        autocontact: 'Auto Contact',
        comparateur: 'Comparateur',
        expertBTP: 'Expert BTP',
        chatBTP: 'Chat BTP'
    };
    
    // Track visibility state for each tool
    const visibility = {};
    tools.forEach(tool => {
        visibility[tool] = true;
    });
    
    // Function to toggle visibility
    const toggleVisibility = (tool) => {
        visibility[tool] = !visibility[tool];
        const opacity = visibility[tool] ? 1 : 0.2;
        
        // Toggle line
        g.selectAll(`.line-${tool}`)
            .style('opacity', opacity)
            .style('pointer-events', visibility[tool] ? 'all' : 'none');
        
        // Toggle dots
        g.selectAll(`.dot-${tool}`)
            .style('opacity', opacity)
            .style('pointer-events', visibility[tool] ? 'all' : 'none');
        
        // Update legend appearance
        g.selectAll(`.legend-${tool}`)
            .style('opacity', opacity)
            .style('cursor', 'pointer');
    };
    
    // Create tooltip element (without background)
    const tooltip = g.append('g')
        .attr('class', 'tooltip')
        .style('opacity', 0)
        .style('pointer-events', 'none');
    
    const tooltipText = tooltip.append('text')
        .attr('x', 0)
        .attr('y', 0)
        .style('font-size', '13px')
        .style('font-weight', 'bold')
        .style('font-family', 'system-ui, -apple-system, sans-serif')
        .style('text-anchor', 'middle')
        .style('pointer-events', 'none');
    
    // Helper function to find closest point on a line
    const findClosestPointOnLine = (mouseX, mouseY, tool) => {
        if (visibility[tool] === false) return null;
        
        let closestPoint = null;
        let minDistance = Infinity;
        
        // Check each segment of the line
        for (let i = 0; i < chartData.length - 1; i++) {
            const p1 = chartData[i];
            const p2 = chartData[i + 1];
            
            const x1 = x(p1.date);
            const y1 = y(p1[tool] || 0);
            const x2 = x(p2.date);
            const y2 = y(p2[tool] || 0);
            
            // Calculate distance from point to line segment
            const A = mouseX - x1;
            const B = mouseY - y1;
            const C = x2 - x1;
            const D = y2 - y1;
            
            const dot = A * C + B * D;
            const lenSq = C * C + D * D;
            let param = -1;
            
            if (lenSq !== 0) param = dot / lenSq;
            
            let xx, yy;
            if (param < 0) {
                xx = x1;
                yy = y1;
            } else if (param > 1) {
                xx = x2;
                yy = y2;
            } else {
                xx = x1 + param * C;
                yy = y1 + param * D;
            }
            
            const dx = mouseX - xx;
            const dy = mouseY - yy;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < minDistance) {
                minDistance = distance;
                // Use the point that's closer to the mouse
                closestPoint = (param < 0.5) ? p1 : p2;
            }
        }
        
        return { point: closestPoint, distance: minDistance };
    };
    
    // Helper function to find which tool's line is closest
    const findClosestTool = (mouseX, mouseY) => {
        let closestTool = null;
        let minDistance = Infinity;
        
        tools.forEach(tool => {
            if (visibility[tool] === false) return;
            
            const result = findClosestPointOnLine(mouseX, mouseY, tool);
            if (result && result.distance < minDistance) {
                minDistance = result.distance;
                closestTool = { tool: tool, point: result.point, distance: result.distance };
            }
        });
        
        // Only show tooltip if we're close enough (within 30 pixels)
        if (closestTool && closestTool.distance < 30) {
            return closestTool;
        }
        
        return null;
    };
    
    // Highlight circle for the hovered point
    const highlightCircle = g.append('circle')
        .attr('r', 6)
        .attr('fill', 'none')
        .attr('stroke-width', 2)
        .style('opacity', 0)
        .style('pointer-events', 'none');
    
    // Helper function to show tooltip
    const showTooltip = (event, closestTool) => {
        if (!closestTool) {
            hideTooltip();
            return;
        }
        
        const { tool, point } = closestTool;
        
        const value = point[tool] || 0;
        const color = colors[tool];
        const dateStr = d3.timeFormat('%m/%Y')(point.date);
        
        // Get the point position on the chart
        const pointX = x(point.date);
        const pointY = y(point[tool] || 0);
        
        // Update tooltip text
        tooltipText.selectAll('tspan').remove();
        
        // Date line (smaller, lighter)
        tooltipText.append('tspan')
            .attr('x', 0)
            .attr('dy', '-1.2em')
            .style('font-size', '11px')
            .style('font-weight', 'normal')
            .style('fill', '#6b7280')
            .text(dateStr);
        
        // Value line with color (bold, larger)
        tooltipText.append('tspan')
            .attr('x', 0)
            .attr('dy', '1.2em')
            .style('fill', color)
            .style('font-weight', 'bold')
            .style('font-size', '13px')
            .text(`${toolLabels[tool]}: ${value.toFixed(2)}%`);
        
        // Position tooltip above the point
        let tooltipX = pointX;
        let tooltipY = pointY - 25;
        
        // If tooltip would go above chart, show it below instead
        if (tooltipY < 20) {
            tooltipY = pointY + 25;
        }
        
        // Keep tooltip within chart bounds
        tooltipX = Math.max(50, Math.min(tooltipX, width - 50));
        
        tooltip
            .attr('transform', `translate(${tooltipX}, ${tooltipY})`)
            .style('opacity', 1);
        
        // Show highlight circle on the point
        highlightCircle
            .attr('cx', pointX)
            .attr('cy', pointY)
            .attr('stroke', color)
            .style('opacity', 1);
    };
    
    // Helper function to hide tooltip
    const hideTooltip = () => {
        tooltip.style('opacity', 0);
        highlightCircle.style('opacity', 0);
    };
    
    // Create invisible overlay for mouse tracking
    const overlay = g.append('rect')
        .attr('width', width)
        .attr('height', height)
        .attr('fill', 'transparent')
        .style('cursor', 'crosshair')
        .on('mousemove', function(event) {
            const [mouseX, mouseY] = d3.pointer(event, g.node());
            const closestTool = findClosestTool(mouseX, mouseY);
            showTooltip(event, closestTool);
        })
        .on('mouseleave', hideTooltip);
    
    // Create line generator for each tool
    tools.forEach(tool => {
        const line = d3.line()
            .x(d => x(d.date))
            .y(d => y(d[tool] || 0))
            .curve(d3.curveMonotoneX);
        
        g.append('path')
            .datum(chartData)
            .attr('class', `line line-${tool}`)
            .attr('d', line)
            .attr('stroke', colors[tool])
            .attr('stroke-width', 2)
            .attr('fill', 'none')
            .style('pointer-events', 'none'); // Let overlay handle events
        
        // Add dots with hover effects
        g.selectAll(`.dot-${tool}`)
            .data(chartData)
            .enter()
            .append('circle')
            .attr('class', `dot dot-${tool}`)
            .attr('cx', d => x(d.date))
            .attr('cy', d => y(d[tool] || 0))
            .attr('r', 4)
            .attr('fill', colors[tool])
            .style('pointer-events', 'none'); // Let overlay handle events
    });
    
    // Add grid lines (before axes so they appear behind)
    // Horizontal grid lines
    g.append('g')
        .attr('class', 'grid')
        .call(d3.axisLeft(y)
            .ticks(10)
            .tickSize(-width)
            .tickFormat('')
        )
        .selectAll('line')
        .style('stroke', '#e5e7eb')
        .style('stroke-width', 1)
        .style('stroke-dasharray', '3,3');
    
    // Vertical grid lines
    g.append('g')
        .attr('class', 'grid')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(x)
            .ticks(6)
            .tickSize(-height)
            .tickFormat('')
        )
        .selectAll('line')
        .style('stroke', '#e5e7eb')
        .style('stroke-width', 1)
        .style('stroke-dasharray', '3,3');
    
    // Add axes (after grid so they appear on top)
    g.append('g')
        .attr('class', 'axis')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%m/%Y')));
    
    g.append('g')
        .attr('class', 'axis')
        .call(d3.axisLeft(y).ticks(10).tickFormat(d => d + '%'));
    
    // Add labels
    g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', 0 - margin.left)
        .attr('x', 0 - (height / 2))
        .attr('dy', '1em')
        .style('text-anchor', 'middle')
        .text('Taux d\'adoption (%)');
    
    g.append('text')
        .attr('transform', `translate(${width / 2}, ${height + margin.bottom - 10})`)
        .style('text-anchor', 'middle')
        .text('Date');
    
    // Add legend
    const legend = g.append('g')
        .attr('transform', `translate(${width + 20}, 0)`);
    
    tools.forEach((tool, index) => {
        const legendRow = legend.append('g')
            .attr('class', `legend-${tool}`)
            .attr('transform', `translate(0, ${index * 25})`)
            .style('cursor', 'pointer')
            .on('click', () => toggleVisibility(tool));
        
        legendRow.append('line')
            .attr('x1', 0)
            .attr('x2', 18)
            .attr('y1', 9)
            .attr('y2', 9)
            .attr('stroke', colors[tool])
            .attr('stroke-width', 2);
        
        legendRow.append('circle')
            .attr('cx', 9)
            .attr('cy', 9)
            .attr('r', 4)
            .attr('fill', colors[tool]);
        
        legendRow.append('text')
            .attr('x', 24)
            .attr('y', 9)
            .attr('dy', '.35em')
            .style('font-size', '12px')
            .text(toolLabels[tool]);
    });
}

// ==================== EVENT LISTENERS ====================

startDateEl.addEventListener('change', () => {
    dateFilter.startDate = startDateEl.value;
    updateAgencyTable();
    updateChart();
});

endDateEl.addEventListener('change', () => {
    dateFilter.endDate = endDateEl.value;
    updateAgencyTable();
    updateChart();
});

directionFilterEl.addEventListener('change', () => {
    populateAgencyFilter();
    updateAgencyTable();
    updateChart();
});

agencyFilterEl.addEventListener('change', () => {
    updateAgencyTable();
    updateChart();
});

resetFiltersBtn.addEventListener('click', () => {
    startDateEl.value = '';
    endDateEl.value = '';
    directionFilterEl.value = '';
    agencyFilterEl.value = '';
    dateFilter.startDate = null;
    dateFilter.endDate = null;
    populateAgencyFilter();
    updateAgencyTable();
    updateChart();
});

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('roi_password');
    window.location.reload();
});

// Handle window resize for chart
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        updateChart();
    }, 250);
});

// ==================== AUTHENTICATION ====================

async function authenticateWithPassword(password) {
    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: password
        });
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
        if (success) {
            loginModal.classList.add('hidden');
            await loadData();
            return;
        } else {
            localStorage.removeItem('roi_password');
        }
    }
    loginModal.classList.remove('hidden');
    passwordInput.focus();
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = passwordInput.value.trim();
    if (!password) return;
    loginButton.disabled = true;
    loginText.textContent = 'Connexion...';
    loginError.classList.add('hidden');
    const success = await authenticateWithPassword(password);
    if (success) {
        localStorage.setItem('roi_password', password);
        loginModal.classList.add('hidden');
        await loadData();
    } else {
        loginError.classList.remove('hidden');
        loginButton.disabled = false;
        loginText.textContent = 'Se connecter';
        passwordInput.value = '';
        passwordInput.focus();
    }
});

// ==================== DATA LOADING ====================

async function loadData() {
    try {
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');
        mainContentEl.classList.add('hidden');
        
        // Load population data FIRST (needed for direction mapping)
        try {
            const popResponse = await fetch(POPULATION_URL);
            if (popResponse.ok) {
                const popCsv = await popResponse.text();
                parsePopulationData(popCsv);
            }
        } catch (e) {
            console.warn('Error loading population data:', e);
        }
        
        // Load descriptif data
        const descriptifResponse = await fetch(DESCRIPTIF_URL);
        if (!descriptifResponse.ok) throw new Error(`Failed to load descriptif: ${descriptifResponse.status}`);
        const descriptifRaw = await descriptifResponse.text();
        let descriptifCSV = null;
        try {
            const descriptifJson = JSON.parse(descriptifRaw);
            if (Array.isArray(descriptifJson) && descriptifJson[0] && descriptifJson[0].data) {
                descriptifCSV = descriptifJson[0].data;
            }
        } catch (e) {}
        if (descriptifCSV) {
            allRictData = parseDescriptifCSV(descriptifCSV);
            descriptifData = allRictData.filter(item => item.type === DESCRIPTIF_TYPE);
            
            // Enrich with direction from population mapping
            allRictData.forEach(item => {
                if (!item.direction || item.direction.trim() === '') {
                    const agencyCode = item.agency ? item.agency.trim().toUpperCase() : '';
                    if (agencyCode && agencyToDR[agencyCode]) {
                        item.direction = agencyToDR[agencyCode];
                    }
                }
            });
            descriptifData.forEach(item => {
                if (!item.direction || item.direction.trim() === '') {
                    const agencyCode = item.agency ? item.agency.trim().toUpperCase() : '';
                    if (agencyCode && agencyToDR[agencyCode]) {
                        item.direction = agencyToDR[agencyCode];
                    }
                }
            });
        }
        
        // Load autocontact data
        const autocontactResponse = await fetch(AUTOCONTACT_URL);
        if (!autocontactResponse.ok) throw new Error(`Failed to load autocontact: ${autocontactResponse.status}`);
        const autocontactRaw = await autocontactResponse.text();
        let autocontactCSV = null;
        try {
            const autocontactJson = JSON.parse(autocontactRaw);
            if (Array.isArray(autocontactJson) && autocontactJson[0] && autocontactJson[0].data) {
                autocontactCSV = autocontactJson[0].data;
            }
        } catch (e) {}
        if (autocontactCSV) {
            autocontactData = parseAutocontactCSV(autocontactCSV);
            
            // Enrich with direction from population mapping
            autocontactData.forEach(item => {
                if (!item.direction || item.direction.trim() === '') {
                    const agencyCode = item.agency ? item.agency.trim().toUpperCase() : '';
                    if (agencyCode && agencyToDR[agencyCode]) {
                        item.direction = agencyToDR[agencyCode];
                    }
                }
            });
        }
        
        // Load comparateur data
        const comparateurResponse = await fetch(COMPARATEUR_URL);
        if (!comparateurResponse.ok) throw new Error(`Failed to load comparateur: ${comparateurResponse.status}`);
        const comparateurRaw = await comparateurResponse.text();
        let comparateurCSV = null;
        try {
            const comparateurJson = JSON.parse(comparateurRaw);
            if (Array.isArray(comparateurJson) && comparateurJson[0] && comparateurJson[0].data) {
                comparateurCSV = comparateurJson[0].data;
            }
        } catch (e) {}
        if (comparateurCSV) {
            comparateurData = parseComparateurCSV(comparateurCSV);
            
            // Enrich with direction from population mapping
            comparateurData.forEach(item => {
                if (!item.direction || item.direction.trim() === '') {
                    const agencyCode = item.agency ? item.agency.trim().toUpperCase() : '';
                    if (agencyCode && agencyToDR[agencyCode]) {
                        item.direction = agencyToDR[agencyCode];
                    }
                }
            });
        }
        
        // Load Expert BTP data
        try {
            const expertBTPResponse = await fetch(EXPERT_BTP_URL);
            if (expertBTPResponse.ok) {
                const expertBTPJson = await expertBTPResponse.json();
                expertBTPData = expertBTPJson.map(item => {
                    const metadata = item.metadata || {};
                    const productionService = metadata.productionService || '';
                    const management = metadata.management || '';
                    const agencyCode = productionService.trim().toUpperCase();
                    // Use direction from population mapping if available
                    const directionFromMapping = agencyCode && agencyToDR[agencyCode] ? agencyToDR[agencyCode] : '';
                    return {
                        id: item.id,
                        email: item.email || '',
                        createdAt: item.createdAt || '',
                        messagesLength: item.messagesLength || item._count?.messages || 0,
                        agency: productionService,
                        direction: management || directionFromMapping || ''
                    };
                });
            }
        } catch (e) {
            console.warn('Error loading Expert BTP data:', e);
        }
        
        // Load Chat BTP data
        try {
            const chatBTPResponse = await fetch(CHAT_BTP_URL);
            if (chatBTPResponse.ok) {
                const chatBTPJson = await chatBTPResponse.json();
                chatBTPData = chatBTPJson.map(item => {
                    const metadata = item.metadata || {};
                    const productionService = metadata.productionService || '';
                    const management = metadata.management || '';
                    const agencyCode = productionService.trim().toUpperCase();
                    // Use direction from population mapping if available
                    const directionFromMapping = agencyCode && agencyToDR[agencyCode] ? agencyToDR[agencyCode] : '';
                    return {
                        id: item.id,
                        email: item.email || '',
                        createdAt: item.createdAt || '',
                        messagesLength: item.messagesLength || item._count?.messages || 0,
                        agency: productionService,
                        direction: management || directionFromMapping || ''
                    };
                });
            }
        } catch (e) {
            console.warn('Error loading Chat BTP data:', e);
        }
        
        // Extract directions and agencies
        extractDirectionsAndAgencies();
        populateFilters();
        
        // Show content first to ensure DOM is rendered
        loadingEl.classList.add('hidden');
        mainContentEl.classList.remove('hidden');
        
        // Update table immediately
        updateAgencyTable();
        
        // Update chart after a delay to ensure layout is complete and container has dimensions
        setTimeout(() => {
            updateChart();
        }, 200);
        
    } catch (error) {
        console.error('Error loading data:', error);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }
}

// Initialize
checkAuthentication();
