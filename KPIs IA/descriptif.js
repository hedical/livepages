// Configuration
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordROI';
const POPULATION_CSV_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/population_cible.csv';
const DESCRIPTIF_TYPE = 'DESCRIPTIF_SOMMAIRE_DES_TRAVAUX';

// Data URL will be fetched from webhook after authentication
let DATA_URL = '';

// State
let allData = [];
let availableAgencies = [];
let availableDRs = [];
let agencyPopulation = {}; // {agencyCode: effectif}
let agencyToDR = {}; // {agencyCode: DR}
let emailToAgency = {}; // {email (lowercase): agencyCode (uppercase)} — home agency from user directory
let dateChart = null;
let ratesChart = null;
let tableSortState = {
    column: 'users', // Default sort by users
    ascending: false
};
let isCumulativeMode = false;
let agencyViewMode = 'general'; // 'general' or 'sup100'

// Parameters (stored in localStorage)
let parameters = {
    minutesPerDescriptif: 30,
    annualHours: 1607,
    totalRevenue: 44000000
};

// Filters
const filters = {
    startDate: null, // Format: YYYY-MM-DD
    endDate: null,   // Format: YYYY-MM-DD
    dr: null,
    agence: null,
};

// DOM Elements
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const mainContentEl = document.getElementById('main-content');
const startDateFilterEl = document.getElementById('start-date-filter');
const endDateFilterEl = document.getElementById('end-date-filter');
const drFilterEl = document.getElementById('dr-filter');
const agencyFilterEl = document.getElementById('agency-filter');
const resetFiltersBtn = document.getElementById('reset-filters');
const agencyTableBodyEl = document.getElementById('agency-table-body');
const firstDateTextEl = document.getElementById('first-date-text');
const agencyViewToggleEl = document.getElementById('agency-view-toggle');

// KPI Elements
const totalUsersEl = document.getElementById('total-users');
const totalRictEl = document.getElementById('total-rict');
const totalDescriptifsEl = document.getElementById('total-descriptifs');
const descriptifsPercentEl = document.getElementById('descriptifs-percent');
const totalOperationsEl = document.getElementById('total-operations');
const operationsPercentEl = document.getElementById('operations-percent');

// Gains Elements
const gainTimeEl = document.getElementById('gain-time');
const gainTimeFormulaEl = document.getElementById('gain-time-formula');
const gainTimeMaxEl = document.getElementById('gain-time-max');
const gainTimeProjectionEl = document.getElementById('gain-time-projection');
const gainTimeMaxProjectionEl = document.getElementById('gain-time-max-projection');
const gainPercentEl = document.getElementById('gain-percent');
const gainPercentFormulaEl = document.getElementById('gain-percent-formula');
const gainPercentMaxEl = document.getElementById('gain-percent-max');
const gainPercentProjectionEl = document.getElementById('gain-percent-projection');
const gainPercentMaxProjectionEl = document.getElementById('gain-percent-max-projection');
const gainEuroEl = document.getElementById('gain-euro');
const gainEuroFormulaEl = document.getElementById('gain-euro-formula');
const gainEuroMaxEl = document.getElementById('gain-euro-max');
const gainEuroProjectionEl = document.getElementById('gain-euro-projection');
const gainEuroMaxProjectionEl = document.getElementById('gain-euro-max-projection');

// Settings Modal Elements
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeModalBtn = document.getElementById('close-modal');
const saveSettingsBtn = document.getElementById('save-settings');
const cancelSettingsBtn = document.getElementById('cancel-settings');
const inputMinutesEl = document.getElementById('input-minutes');
const inputAnnualHoursEl = document.getElementById('input-annual-hours');
const inputRevenueEl = document.getElementById('input-revenue');
const cumulToggleEl = document.getElementById('cumul-toggle');

// Utility Functions
function parseNumber(value) {
    if (typeof value === 'number') {
        return isNaN(value) ? 0 : value;
    }
    if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
}

function parseDate(dateString) {
    if (!dateString || dateString.trim() === '') {
        return null;
    }
    
    // Remove backslashes that might be escaping commas
    let cleanDate = dateString.replace(/\\/g, '');
    
    // Try standard date parsing first
    let date = new Date(cleanDate);
    
    // If that fails, try to parse different formats
    if (isNaN(date.getTime())) {
        // Try format: "DD Month, YYYY, HH:MM" or "DD Month, YYYY" (e.g., "5 décembre, 2025, 15:33" or "25 octobre, 2025")
        const frenchMonths = {
            'janvier': 0, 'février': 1, 'fevrier': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5,
            'juillet': 6, 'août': 7, 'aout': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11, 'decembre': 11
        };
        
        // Match with optional time part: "DD Month, YYYY" or "DD Month, YYYY, HH:MM"
        const match = cleanDate.match(/(\d+)\s+([a-zàâäéèêëïôùûü]+)[,\s]+(\d{4})/i);
        if (match) {
            const day = parseInt(match[1]);
            const monthName = match[2].toLowerCase().trim();
            const year = parseInt(match[3]);
            
            if (frenchMonths[monthName] !== undefined) {
                date = new Date(year, frenchMonths[monthName], day);
                
                // Try to parse time if present
                const timeMatch = cleanDate.match(/(\d{1,2}):(\d{2})/);
                if (timeMatch) {
                    const hours = parseInt(timeMatch[1]);
                    const minutes = parseInt(timeMatch[2]);
                    date.setHours(hours, minutes, 0, 0);
                }
            }
        }
    }
    
    if (isNaN(date.getTime())) {
        return null;
    }
    
    return date;
}

// Returns {startDate, endDate} for the current month (YYYY-MM-DD)
function getCurrentMonthRange() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
    return {
        startDate: `${year}-${month}-01`,
        endDate: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
    };
}

// Format date for display (e.g., "Depuis le 15 janvier 2024")
function formatFirstDate(dateString) {
    if (!dateString) return '-';
    
    const date = parseDate(dateString);
    if (!date) return '-';
    
    const months = [
        'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
        'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
    ];
    
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    return `Depuis le ${day} ${month} ${year}`;
}

// Find the earliest date in the data
function getFirstDate(data) {
    if (!data || data.length === 0) return null;
    
    let earliestDate = null;
    
    data.forEach(item => {
        const date = parseDate(item.createdAt);
        if (date) {
            if (!earliestDate || date < earliestDate) {
                earliestDate = date;
            }
        }
    });
    
    return earliestDate;
}

// Format number with thousands separator
function formatNumber(num) {
    return new Intl.NumberFormat('fr-FR').format(Math.round(num));
}

// Extract plain text from HTML string
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

// Count words in text (only words, not numbers)
function countWords(text) {
    if (!text || typeof text !== 'string') return 0;
    // Match only sequences of letters (including accented characters)
    const words = text.match(/[a-zA-ZÀ-ÿ]+/g);
    return words ? words.length : 0;
}

// Load parameters from localStorage
function loadParameters() {
    const saved = localStorage.getItem('descriptif_parameters');
    if (saved) {
        try {
            parameters = JSON.parse(saved);
        } catch (e) {
            console.warn('Failed to parse saved parameters');
        }
    }
}

// Save parameters to localStorage
function saveParameters() {
    localStorage.setItem('descriptif_parameters', JSON.stringify(parameters));
}

// Calculate total effectif from agency population
function getTotalEffectif() {
    return Object.values(agencyPopulation).reduce((sum, val) => sum + val, 0);
}

// Format hours nicely
function formatHours(hours) {
    if (hours < 1) {
        const minutes = Math.round(hours * 60);
        return `${minutes}min`;
    }
    return `${formatNumber(hours)}h`;
}

// Calculate gains based on current data and mode
// usersCount: unique active users for current period (denominator for %)
//             pass getTotalEffectif() for max atteignable
function calculateGains(descriptifsCount, usersCount) {
    // 1. Gain en temps (minutes → heures)
    const timeGainMinutes = descriptifsCount * parameters.minutesPerDescriptif;
    const timeGainHours = timeGainMinutes / 60;

    // 2. Gain en % volume d'affaire — based on active users, not total effectif
    let percentGain = 0;
    if (usersCount > 0 && parameters.annualHours > 0) {
        percentGain = (timeGainHours / (usersCount * parameters.annualHours)) * 100;
    }

    // 3. Gain en €
    const euroGain = (percentGain / 100) * parameters.totalRevenue;

    return {
        timeGainHours,
        percentGain,
        euroGain,
        usersCount
    };
}

// Calculate number of months in current period
function calculatePeriodMonths() {
    if (isCumulativeMode) {
        const firstDate = getFirstDate(allData);
        if (!firstDate) return 1;
        const now = new Date();
        const totalMonths = (now.getFullYear() - firstDate.getFullYear()) * 12
            + (now.getMonth() - firstDate.getMonth()) + 1;
        return Math.max(1, totalMonths);
    }
    // Date range mode: count months between start and end
    if (filters.startDate && filters.endDate) {
        const s = new Date(filters.startDate);
        const e = new Date(filters.endDate);
        const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
        return Math.max(1, months);
    }
    return 1;
}

// Update gains display
// uniqueUsers: unique active users in the current period (denominator for current gain %)
// Max atteignable always uses getTotalEffectif() as denominator
function updateGains(descriptifsCount, totalRictCount, uniqueUsers) {
    const totalEffectif = getTotalEffectif();
    const activeUsers = (uniqueUsers > 0) ? uniqueUsers : totalEffectif;

    const gains = calculateGains(descriptifsCount, activeUsers);
    const maxGains = calculateGains(totalRictCount, activeUsers);

    // Calculate projection for the year
    const periodMonths = calculatePeriodMonths();
    const projectionMultiplier = 12 / periodMonths;
    const projectedDescriptifs = descriptifsCount * projectionMultiplier;
    const projectionGains = calculateGains(projectedDescriptifs, activeUsers);

    // Calculate max projection for the year
    const projectedMaxDescriptifs = totalRictCount * projectionMultiplier;
    const maxProjectionGains = calculateGains(projectedMaxDescriptifs, activeUsers);

    // Update time gain
    gainTimeEl.textContent = formatHours(gains.timeGainHours);
    gainTimeFormulaEl.textContent = `${formatNumber(descriptifsCount)} descriptifs × ${parameters.minutesPerDescriptif}min`;
    gainTimeMaxEl.textContent = `Max atteignable: ${formatHours(maxGains.timeGainHours)}`;
    gainTimeProjectionEl.textContent = `Projection année: ${formatHours(projectionGains.timeGainHours)} (${periodMonths} mois)`;
    gainTimeMaxProjectionEl.textContent = `Projection max année: ${formatHours(maxProjectionGains.timeGainHours)}`;

    // Update percent gain
    gainPercentEl.textContent = `${gains.percentGain.toFixed(4)}%`;
    gainPercentFormulaEl.textContent = `${formatHours(gains.timeGainHours)} / (${activeUsers} × ${parameters.annualHours}h)`;
    gainPercentMaxEl.textContent = `Max atteignable: ${maxGains.percentGain.toFixed(4)}%`;
    gainPercentProjectionEl.textContent = `Projection année: ${projectionGains.percentGain.toFixed(4)}%`;
    gainPercentMaxProjectionEl.textContent = `Projection max année: ${maxProjectionGains.percentGain.toFixed(4)}%`;

    // Update euro gain
    gainEuroEl.textContent = `${formatNumber(gains.euroGain)} €`;
    gainEuroFormulaEl.textContent = `${gains.percentGain.toFixed(4)}% × ${formatNumber(parameters.totalRevenue)} €`;
    gainEuroMaxEl.textContent = `Max atteignable: ${formatNumber(maxGains.euroGain)} €`;
    gainEuroProjectionEl.textContent = `Projection année: ${formatNumber(projectionGains.euroGain)} €`;
    gainEuroMaxProjectionEl.textContent = `Projection max année: ${formatNumber(maxProjectionGains.euroGain)} €`;
}

// Helper function to parse a CSV line with quoted values
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

// Full CSV parser that correctly handles quoted fields containing newlines
function parseFullCSV(csvString) {
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < csvString.length; i++) {
        const char = csvString[i];
        const next = csvString[i + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                // Escaped quote ""
                currentField += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentField.trim());
            currentField = '';
        } else if (char === '\r' && next === '\n' && !inQuotes) {
            // Windows CRLF line ending
            currentRow.push(currentField.trim());
            if (currentRow.some(f => f !== '')) rows.push(currentRow);
            currentRow = [];
            currentField = '';
            i++; // skip the \n
        } else if (char === '\n' && !inQuotes) {
            currentRow.push(currentField.trim());
            if (currentRow.some(f => f !== '')) rows.push(currentRow);
            currentRow = [];
            currentField = '';
        } else if (char === '\r' && !inQuotes) {
            // Lone \r — treat as line ending
            currentRow.push(currentField.trim());
            if (currentRow.some(f => f !== '')) rows.push(currentRow);
            currentRow = [];
            currentField = '';
        } else {
            currentField += char;
        }
    }

    // Flush last field/row
    if (currentField || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        if (currentRow.some(f => f !== '')) rows.push(currentRow);
    }

    return rows;
}

// Fix encoding issues in text (convert from Latin-1/Windows-1252 to UTF-8)
function fixEncoding(text) {
    // Common character replacements for Latin-1/Windows-1252 encoded as UTF-8
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
        '�': 'é' // Unicode replacement character often appears as �
    };
    
    let fixed = text;
    for (const [wrong, correct] of Object.entries(replacements)) {
        fixed = fixed.replace(new RegExp(wrong, 'g'), correct);
    }
    
    // Specific fixes for known issues in the CSV
    fixed = fixed.replace(/Pyr.n.es/g, 'Pyrénées');
    fixed = fixed.replace(/Op.rationnelle/g, 'Opérationnelle');
    
    return fixed;
}

// Helper function to parse CSV line with quoted values (handles commas inside quotes)
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

// Extract CSV content from "data" field if present
function extractCSVFromDataField(csvText) {
    // Check if first line is "data"
    const lines = csvText.split('\n');
    if (lines.length > 0 && lines[0].trim() === 'data') {
        // Extract everything after "data" line
        // Remove the first line and join back
        const csvContent = lines.slice(1).join('\n');
        // Remove surrounding quotes if present
        return csvContent.replace(/^["']|["']$/g, '').trim();
    }
    return csvText;
}

// Parse population / user directory file
async function loadAgencyPopulation() {
    try {
        const response = await fetch(POPULATION_CSV_URL);
        if (!response.ok) {
            console.warn('Could not load population file');
            return { population: {}, drMapping: {}, emailMap: {} };
        }

        const rawData = await response.text();
        const result = _parseUserDirectory(rawData);
        console.log('Population loaded:', Object.keys(result.population).length, 'agencies,', Object.keys(result.emailMap).length, 'users');
        return result;
    } catch (error) {
        console.warn('Error loading population data:', error);
        return { population: {}, drMapping: {}, emailMap: {} };
    }
}

function _parseUserDirectory(rawData) {
    const population = {};
    const drMapping = {};
    const emailMap = {};

    let csvText = rawData.trim();

    // Try JSON formats
    try {
        const json = JSON.parse(csvText);
        if (Array.isArray(json) && json.length > 0 && json[0].data) {
            csvText = json[0].data;
        } else if (Array.isArray(json) && json.length > 0 && typeof json[0] === 'object') {
            return _parseUserObjectsDescriptif(json);
        }
    } catch(e) {
        csvText = fixEncoding(csvText);
        csvText = extractCSVFromDataField(csvText);
    }

    const rows = parseFullCSV(csvText);
    if (rows.length < 2) return { population, drMapping, emailMap };

    const headers = rows[0].map(h => h.toLowerCase().trim());
    const emailIdx = headers.findIndex(h => h.includes('email') && !h.includes('management'));
    const productionServiceIdx = headers.findIndex(h => h.includes('productionservice'));

    if (emailIdx !== -1 && productionServiceIdx !== -1) {
        // New user-directory format
        const isEnabledIdx = headers.findIndex(h => h.includes('enabled'));
        const isMainIdx = headers.findIndex(h => h.includes('ismain') || (h.includes('is') && h.includes('main')));
        const managementIdx = headers.findIndex(h => h.includes('management'));

        const userAssignments = {};
        for (let i = 1; i < rows.length; i++) {
            const v = rows[i];
            const email = (v[emailIdx] || '').toLowerCase().trim();
            const isEnabled = isEnabledIdx === -1 || (v[isEnabledIdx] || '').toLowerCase() === 'true';
            const isMain = isMainIdx === -1 || (v[isMainIdx] || '').toLowerCase() === 'true';
            const agencyCode = (v[productionServiceIdx] || '').trim().toUpperCase();
            const dr = managementIdx >= 0 ? (v[managementIdx] || '').trim() : '';
            if (!email || !agencyCode || !isEnabled) continue;
            if (!userAssignments[email]) userAssignments[email] = [];
            userAssignments[email].push({ agencyCode, isMain, dr });
            if (dr) drMapping[agencyCode] = dr;
        }
        Object.entries(userAssignments).forEach(([email, assignments]) => {
            const primary = assignments.find(a => a.isMain) || assignments[0];
            emailMap[email] = primary.agencyCode;
            population[primary.agencyCode] = (population[primary.agencyCode] || 0) + 1;
        });
    } else {
        // Legacy format: DR, AgencyCode, Effectif
        for (let i = 1; i < rows.length; i++) {
            if (rows[i].length >= 3) {
                const dr = rows[i][0].trim();
                const agencyCode = rows[i][1].trim().toUpperCase();
                const effectif = parseInt(rows[i][2].trim());
                if (agencyCode && !isNaN(effectif)) {
                    population[agencyCode] = effectif;
                    drMapping[agencyCode] = dr;
                }
            }
        }
    }
    return { population, drMapping, emailMap };
}

function _parseUserObjectsDescriptif(jsonArray) {
    const population = {}, drMapping = {}, emailMap = {};
    const userAssignments = {};
    jsonArray.forEach(user => {
        const email = (user.Email || user.email || '').toLowerCase().trim();
        const isEnabled = String(user.IsEnabled || user.isEnabled || 'true').toLowerCase() === 'true';
        const isMain = String(user['AgencyToUser → IsMain'] || user.IsMain || user.isMain || 'true').toLowerCase() === 'true';
        const agencyCode = (user['Agency → AgencyId → ProductionService'] || user.ProductionService || '').trim().toUpperCase();
        const dr = (user['Agency → AgencyId → Management'] || user.Management || '').trim();
        if (!email || !agencyCode || !isEnabled) return;
        if (!userAssignments[email]) userAssignments[email] = [];
        userAssignments[email].push({ agencyCode, isMain, dr });
        if (dr) drMapping[agencyCode] = dr;
    });
    Object.entries(userAssignments).forEach(([email, assignments]) => {
        const primary = assignments.find(a => a.isMain) || assignments[0];
        emailMap[email] = primary.agencyCode;
        population[primary.agencyCode] = (population[primary.agencyCode] || 0) + 1;
    });
    return { population, drMapping, emailMap };
}

// Parse CSV data from string
function parseCSVData(csvString) {
    if (!csvString || typeof csvString !== 'string') {
        console.warn('Invalid CSV string');
        return [];
    }
    
    // Cleanup CSV string
    csvString = csvString.trim();
    while (csvString.startsWith('[') || csvString.startsWith('{')) {
        csvString = csvString.substring(1).trim();
    }
    while (csvString.endsWith(']') || csvString.endsWith('}')) {
        csvString = csvString.substring(0, csvString.length - 1).trim();
    }
    if (csvString.startsWith('data:')) {
        csvString = csvString.substring(5).trim();
    }
    
    const rows = parseFullCSV(csvString);

    if (rows.length === 0) {
        console.warn('No valid rows after CSV parsing');
        return [];
    }

    const headers = rows[0];
    
    console.log('CSV headers:', headers.slice(0, 10));
    
    // Find column indices
    let typeIndex = -1;
    let contractIndex = -1;
    let diffusedAtIndex = -1;
    let emailIndex = -1;
    let agencyIndex = -1;
    let descriptionIndex = -1;
    let aiResultIndex = -1;
    let directionIndex = -1;
    
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toLowerCase();
        if (typeIndex === -1 && (
            (header.includes('aideliver') && header.includes('type')) ||
            header.includes('reporttype') ||
            (header.includes('report') && header.includes('type') && !header.includes('diffusedat'))
        )) {
            typeIndex = i;
        }
        if (contractIndex === -1 && header.includes('contractnumber')) {
            contractIndex = i;
        }
        if (diffusedAtIndex === -1 && header.includes('report') && header.includes('diffusedat')) {
            diffusedAtIndex = i;
        }
        if (emailIndex === -1 && header.includes('user') && header.includes('email')) {
            emailIndex = i;
        }
        if (agencyIndex === -1 && header.includes('productionservice')) {
            agencyIndex = i;
        }
        if (descriptionIndex === -1 && header.includes('description') && !header.includes('complement')) {
            descriptionIndex = i;
        }
        if (aiResultIndex === -1 && (header.includes('longresult') || header.includes('result'))) {
            aiResultIndex = i;
        }
        if (directionIndex === -1 && (header.includes('management') || header.includes('direction'))) {
            directionIndex = i;
        }
    }
    
    console.log('Column indices:', {
        type: typeIndex,
        contract: contractIndex,
        diffusedAt: diffusedAtIndex,
        email: emailIndex,
        agency: agencyIndex,
        direction: directionIndex
    });
    
    if (typeIndex === -1 || contractIndex === -1) {
        console.warn('Missing required columns');
        return [];
    }
    
    // Parse data rows
    const data = [];
    for (let i = 1; i < rows.length; i++) {
        const values = rows[i];
        if (values.length < headers.length / 2) {
            continue; // Skip malformed rows
        }
        
        const type = values[typeIndex] || '';
        const contractNumber = values[contractIndex] || '';
        const diffusedAt = diffusedAtIndex >= 0 ? values[diffusedAtIndex] : '';
        const email = emailIndex >= 0 ? values[emailIndex] : '';
        const agency = (agencyIndex >= 0 ? values[agencyIndex] : '') || '';
        const direction = (directionIndex >= 0 ? values[directionIndex] : '') || '';
        const description = descriptionIndex >= 0 ? values[descriptionIndex] : '';
        const aiResult = aiResultIndex >= 0 ? values[aiResultIndex] : '';
        
        // ProductionService already contains the agency code (CT95, LYCT, etc.)
        // Use it directly as agencyCode for mapping with population_cible
        const agencyCode = (agency || '').trim();
        
        data.push({
            type: (type || '').trim(),
            contractNumber: (contractNumber || '').trim(),
            createdAt: (diffusedAt || '').trim(), // Using Report → DiffusedAt as date
            email: (email || '').trim(),
            agency: (agency || '').trim(),
            direction: (direction || '').trim(),
            agencyCode: agencyCode, // Same as agency - ProductionService is the code
            description: description,
            aiResult: aiResult
        });
    }
    
    console.log('Parsed', data.length, 'rows from CSV');
    
    // Debug: Check date parsing
    const samplesWithDates = data.filter(item => item.createdAt).slice(0, 5);
    console.log('Sample rows with dates:', samplesWithDates.map(item => ({
        createdAt: item.createdAt,
        parsed: parseDate(item.createdAt)
    })));
    
    return data;
}

// Extract agency code from contract number (e.g., "C-CT78-2022-20-157875" → "CT78")
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

// Transform data from JSON array format
function transformData(jsonArray) {
    const allRows = [];
    
    jsonArray.forEach((item, index) => {
        if (item.data && typeof item.data === 'string') {
            const rows = parseCSVData(item.data);
            allRows.push(...rows);
        }
    });
    
    console.log('Transformed data, total rows:', allRows.length);
    return allRows;
}

// Filter functions
function filterYieldAffairs(data) {
    return data.filter((item) => {
        if (!item.contractNumber) return true;
        return !item.contractNumber.includes('YIELD');
    });
}

function filterByType(data, type) {
    // Si aucun item n'a de type (query Metabase déjà filtrée), on passe tout
    const anyHasType = data.some(item => item.type && item.type.trim() !== '');
    if (!anyHasType) return data;
    return data.filter((item) => !item.type || item.type === type);
}

function filterByDateRange(data, startDate, endDate) {
    if (!startDate && !endDate) return data;
    const start = startDate ? new Date(startDate) : null;
    const end   = endDate   ? new Date(endDate)   : null;
    if (end) end.setHours(23, 59, 59, 999);
    return data.filter((item) => {
        const date = parseDate(item.createdAt);
        if (!date) return false;
        if (start && date < start) return false;
        if (end   && date > end)   return false;
        return true;
    });
}

function filterByAgence(data, agence) {
    if (!agence || agence === 'all') return data;
    return data.filter((item) => item.agency === agence);
}

function filterByDR(data, dr) {
    if (!dr || dr === 'all') return data;
    return data.filter((item) => {
        if (!item.agencyCode) return false;
        const itemDR = agencyToDR[item.agencyCode];
        return itemDR === dr;
    });
}

// Process data and calculate KPIs
function processData(data, filters, skipMonthFilter = false) {
    // Filter out YIELD affairs
    let allFiltered = filterYieldAffairs(data);
    
    // Apply date range filter (skip if in cumulative mode)
    if (!skipMonthFilter) {
        allFiltered = filterByDateRange(allFiltered, filters.startDate, filters.endDate);
    }

    // Apply DR filter
    allFiltered = filterByDR(allFiltered, filters.dr);

    // Apply agence filter
    allFiltered = filterByAgence(allFiltered, filters.agence);
    
    // Total RICT = nombre unique d'affaires (contractNumber uniques)
    const uniqueContracts = new Set();
    allFiltered.forEach(item => {
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            uniqueContracts.add(item.contractNumber);
        }
    });
    const totalRict = uniqueContracts.size;
    
    // Now filter by type for descriptifs
    let descriptifFiltered = filterByType(allFiltered, DESCRIPTIF_TYPE);

    // Calculate KPIs
    const uniqueUsers = new Set();
    const uniqueOperations = new Set();
    
    descriptifFiltered.forEach(item => {
        if (item.email && (item.email.includes('@btp-consultants.fr') || item.email.includes('@citae.fr'))) {
            uniqueUsers.add(item.email);
        }
        // Exclure les RICT avec moins de 100 mots dans le résultat de l'IA
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            // Compter les mots dans le résultat de l'IA
            const processedAI = extractText(item.aiResult || item.description || '');
            const wordCount = countWords(processedAI);
            
            // Ne compter que les RICT avec au moins 100 mots
            if (wordCount >= 100) {
                uniqueOperations.add(item.contractNumber);
            }
        }
    });

    return {
        totalUsers: uniqueUsers.size,
        totalRict: totalRict, // Nombre unique d'affaires (contractNumber uniques)
        totalDescriptifs: descriptifFiltered.length, // Filtered by type
        totalOperations: uniqueOperations.size,
        filteredData: descriptifFiltered // For table and chart
    };
}

// Get available agencies
function getAvailableAgencies(data) {
    const agencies = new Set();
    data.forEach((item) => {
        if (item.agency) {
            agencies.add(item.agency);
        }
    });
    return Array.from(agencies).sort();
}

// Get available DRs
function getAvailableDRs(data) {
    const drs = new Set();
    data.forEach((item) => {
        if (item.agencyCode && agencyToDR[item.agencyCode]) {
            drs.add(agencyToDR[item.agencyCode]);
        }
    });
    return Array.from(drs).sort();
}

// Populate DR filter dropdown
function populateDRFilter() {
    drFilterEl.innerHTML = '<option value="all">Toutes les directions</option>';
    availableDRs.forEach((dr) => {
        const option = document.createElement('option');
        option.value = dr;
        option.textContent = dr;
        drFilterEl.appendChild(option);
    });
}

// Populate agency filter dropdown
function populateAgencyFilter() {
    agencyFilterEl.innerHTML = '<option value="all">Toutes les agences</option>';
    availableAgencies.forEach((agency) => {
        const option = document.createElement('option');
        option.value = agency;
        option.textContent = agency;
        agencyFilterEl.appendChild(option);
    });
}

// Sort table function (called from HTML onclick)
function sortTable(column) {
    // Toggle sort direction if clicking same column
    if (tableSortState.column === column) {
        tableSortState.ascending = !tableSortState.ascending;
    } else {
        tableSortState.column = column;
        tableSortState.ascending = false; // Default to descending for new column
    }
    
    // Update sort icons
    updateSortIcons();
    
    // Re-render table with new sort
    updateKPIs();
}

// Make sortTable accessible globally for onclick
window.sortTable = sortTable;

// Update sort icons in table headers
function updateSortIcons() {
    const columns = ['dr', 'agency', 'rict', 'operations', 'users', 'rateDescriptifs', 'rateUsers'];
    columns.forEach(col => {
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

/**
 * Calculate statistics for "Sup 100 mots" view
 * Basé sur la logique de explorer-descriptifs.js
 */
function calculateAgencyStatisticsSup100(allRictData, descriptifData) {
    const statsMap = {};
    
    // D'abord, initialiser avec toutes les affaires (pour calculer le nombre total de RICT)
    allRictData.forEach(item => {
        const direction = item.direction || 'Non spécifiée';
        const agency = item.agency || 'Non spécifiée';
        const key = `${direction}|${agency}`;
        
        if (!statsMap[key]) {
            statsMap[key] = {
                direction: direction,
                agency: agency,
                uniqueContracts: new Set(), // Colonne 3 : Nombre d'affaires uniques (TOUTES les affaires)
                contractsWithRICT100Plus: new Set(), // Colonne 4 : RICT > 100 mots (toutes les données)
                contractsWithAIOrRICT100Plus: new Set() // Colonne 5 : Parmi colonne 4, celles qui ont utilisé l'IA
            };
        }
        
        const stats = statsMap[key];
        
        // Colonne 3 : Nombre d'affaires uniques (toutes les affaires, pas seulement descriptifs)
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            stats.uniqueContracts.add(item.contractNumber);
            
            // Colonne 4 : Nombre d'affaires uniques avec un RICT de plus de 100 mots
            // Calculer le nombre de mots dans la description originale pour TOUTES les données
            const processedDesc = extractText(item.description || '');
            const descWordCount = countWords(processedDesc);
            
            if (descWordCount > 100) {
                stats.contractsWithRICT100Plus.add(item.contractNumber);
            }
        }
    });
    
    // Ensuite, traiter les descriptifs pour la colonne 5
    // Colonne 5 : Parmi les affaires avec RICT > 100 mots (colonne 4), compter celles qui ont utilisé l'IA
    descriptifData.forEach(item => {
        const direction = item.direction || 'Non spécifiée';
        const agency = item.agency || 'Non spécifiée';
        const key = `${direction}|${agency}`;
        
        // S'assurer que la clé existe (devrait déjà exister)
        if (!statsMap[key]) {
            statsMap[key] = {
                direction: direction,
                agency: agency,
                uniqueContracts: new Set(),
                contractsWithRICT100Plus: new Set(),
                contractsWithAIOrRICT100Plus: new Set()
            };
        }
        
        const stats = statsMap[key];
        
        // Colonne 5 : Nombre d'affaires uniques qui ont utilisé l'IA parmi celles avec RICT > 100 mots
        // Calculer le nombre de mots dans la description originale
        const processedDesc = extractText(item.description || '');
        const descWordCount = countWords(processedDesc);
        
        if (item.contractNumber && item.contractNumber.trim() !== '' && descWordCount > 100) {
            stats.contractsWithAIOrRICT100Plus.add(item.contractNumber);
        }
    });
    
    // Convert to array and calculate rates
    const statsArray = Object.values(statsMap).map(stats => ({
        direction: stats.direction,
        agency: stats.agency,
        uniqueContracts: stats.uniqueContracts.size, // Colonne 3
        contractsWithRICT100Plus: stats.contractsWithRICT100Plus.size, // Colonne 4
        contractsWithAIOrRICT100Plus: stats.contractsWithAIOrRICT100Plus.size, // Colonne 5
        aiRelevanceRate: stats.contractsWithRICT100Plus.size > 0 
            ? (stats.contractsWithAIOrRICT100Plus.size / stats.contractsWithRICT100Plus.size) * 100 // Colonne 6 : colonne 5 / colonne 4
            : 0
    }));
    
    // Sort by direction, then by agency
    statsArray.sort((a, b) => {
        if (a.direction !== b.direction) {
            return a.direction.localeCompare(b.direction);
        }
        return a.agency.localeCompare(b.agency);
    });
    
    return statsArray;
}

// Update agency stats table
function updateAgencyTable(allRictData, descriptifData) {
    console.log('updateAgencyTable appelée, mode:', agencyViewMode);
    // Check if we're in "Sup 100 mots" mode
    if (agencyViewMode === 'sup100') {
        console.log('Mode Sup 100 mots détecté, appel de updateAgencyTableSup100');
        updateAgencyTableSup100(allRictData, descriptifData);
        return;
    }
    
    console.log('Mode Général, affichage du tableau standard');
    // Original "Général" mode
    // Calculate stats by agency
    const agencyStats = {};
    
    // Initialize structure for all agencies
    const initAgency = (agency, agencyCode) => {
        if (!agencyStats[agency]) {
            agencyStats[agency] = {
                totalRict: 0,
                operations: new Set(),
                users: new Set(),
                agencyCode: agencyCode
            };
        }
    };
    
    // Count total RICT per agency (use home agency from user directory)
    allRictData.forEach(item => {
        const email = (item.email || '').toLowerCase();
        const agencyKey = (email && emailToAgency[email]) ? emailToAgency[email] : item.agency;
        if (!agencyKey) return;
        initAgency(agencyKey, agencyKey);
        if (!agencyStats[agencyKey].uniqueContracts) agencyStats[agencyKey].uniqueContracts = new Set();
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            agencyStats[agencyKey].uniqueContracts.add(item.contractNumber);
        }
    });
    
    // Calculer le totalRict à partir des contractNumber uniques
    Object.keys(agencyStats).forEach(agency => {
        agencyStats[agency].totalRict = agencyStats[agency].uniqueContracts ? agencyStats[agency].uniqueContracts.size : 0;
    });
    
    // Count descriptifs effectifs and users per agency (use home agency from user directory)
    descriptifData.forEach(item => {
        const email = (item.email || '').toLowerCase();
        const agencyKey = (email && emailToAgency[email]) ? emailToAgency[email] : item.agency;
        if (!agencyKey) return;
        initAgency(agencyKey, agencyKey);

        if (item.email && (item.email.includes('@btp-consultants.fr') || item.email.includes('@citae.fr'))) {
            agencyStats[agencyKey].users.add(item.email);
        }
        
        // Exclure les RICT avec moins de 100 mots dans le résultat de l'IA
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            // Compter les mots dans le résultat de l'IA
            const processedAI = extractText(item.aiResult || item.description || '');
            const wordCount = countWords(processedAI);
            
            // Ne compter que les RICT avec au moins 100 mots
            if (wordCount >= 100) {
                agencyStats[agencyKey].operations.add(item.contractNumber);
            }
        }
    });
    
    // Get list of agencies
    const agencies = Object.keys(agencyStats);
    
    // Sort agencies based on current sort state
    const sortedAgencies = agencies.sort((a, b) => {
        let compareResult = 0;
        
        switch (tableSortState.column) {
            case 'dr':
                const codeA = agencyStats[a].agencyCode;
                const codeB = agencyStats[b].agencyCode;
                const drA = codeA ? agencyToDR[codeA] || '' : '';
                const drB = codeB ? agencyToDR[codeB] || '' : '';
                compareResult = drA.localeCompare(drB);
                break;
            case 'agency':
                compareResult = a.localeCompare(b);
                break;
            case 'rict':
                compareResult = agencyStats[a].totalRict - agencyStats[b].totalRict;
                break;
            case 'operations':
                compareResult = agencyStats[a].operations.size - agencyStats[b].operations.size;
                break;
            case 'users':
                compareResult = agencyStats[a].users.size - agencyStats[b].users.size;
                break;
            case 'rateDescriptifs':
                const rictA = agencyStats[a].totalRict || 0;
                const rictB = agencyStats[b].totalRict || 0;
                const rateDescA = rictA > 0 ? (agencyStats[a].operations.size / rictA) : 0;
                const rateDescB = rictB > 0 ? (agencyStats[b].operations.size / rictB) : 0;
                compareResult = rateDescA - rateDescB;
                break;
            case 'rateUsers':
                const agencyCodeA = agencyStats[a].agencyCode;
                const agencyCodeB = agencyStats[b].agencyCode;
                const effectifA = agencyCodeA ? agencyPopulation[agencyCodeA] || 0 : 0;
                const effectifB = agencyCodeB ? agencyPopulation[agencyCodeB] || 0 : 0;
                const rateUsersA = effectifA > 0 ? (agencyStats[a].users.size / effectifA) : 0;
                const rateUsersB = effectifB > 0 ? (agencyStats[b].users.size / effectifB) : 0;
                compareResult = rateUsersA - rateUsersB;
                break;
            default:
                compareResult = agencyStats[a].users.size - agencyStats[b].users.size;
        }
        
        // Apply ascending/descending
        return tableSortState.ascending ? compareResult : -compareResult;
    });
    
    // Render table
    agencyTableBodyEl.innerHTML = '';
    
    if (sortedAgencies.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="7" class="px-6 py-4 text-center text-gray-500">
                Aucune donnée disponible pour cette période
            </td>
        `;
        agencyTableBodyEl.appendChild(row);
        return;
    }
    
    sortedAgencies.forEach((agency, index) => {
        const stats = agencyStats[agency];
        const agencyCode = stats.agencyCode;
        const totalRict = stats.totalRict || 0;
        const operations = stats.operations.size;
        const users = stats.users.size;
        const effectif = agencyCode ? agencyPopulation[agencyCode] || 0 : 0;
        const dr = agencyCode ? agencyToDR[agencyCode] || '-' : '-';
        
        // Taux d'utilisation descriptifs: operations / totalRict
        const tauxDescriptifs = totalRict > 0 ? ((operations / totalRict) * 100).toFixed(1) : '-';
        
        // Taux d'adoption: users / effectif
        const tauxUsers = effectif > 0 ? ((users / effectif) * 100).toFixed(1) : '-';
        
        const row = document.createElement('tr');
        row.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        
        // Color coding for taux descriptifs
        let tauxDescriptifsClass = 'text-gray-500';
        let tauxDescriptifsBg = '';
        if (totalRict > 0) {
            const rate = parseFloat(tauxDescriptifs);
            if (rate >= 70) {
                tauxDescriptifsClass = 'text-white font-bold';
                tauxDescriptifsBg = 'bg-green-500';
            } else if (rate >= 40) {
                tauxDescriptifsClass = 'text-white font-bold';
                tauxDescriptifsBg = 'bg-yellow-500';
            } else {
                tauxDescriptifsClass = 'text-white font-bold';
                tauxDescriptifsBg = 'bg-red-500';
            }
        }
        
        // Color coding for taux users
        let tauxUsersClass = 'text-gray-500';
        let tauxUsersBg = '';
        if (effectif > 0) {
            const rate = parseFloat(tauxUsers);
            if (rate >= 70) {
                tauxUsersClass = 'text-white font-bold';
                tauxUsersBg = 'bg-green-500';
            } else if (rate >= 40) {
                tauxUsersClass = 'text-white font-bold';
                tauxUsersBg = 'bg-yellow-500';
            } else {
                tauxUsersClass = 'text-white font-bold';
                tauxUsersBg = 'bg-red-500';
            }
        }
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${dr}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${agency}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${totalRict}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${operations}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${users}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${tauxDescriptifsClass}">
                ${totalRict > 0 ? `<span class="px-3 py-1 rounded-full ${tauxDescriptifsBg}">${tauxDescriptifs}%</span>` : '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${tauxUsersClass}">
                ${effectif > 0 ? `<span class="px-3 py-1 rounded-full ${tauxUsersBg}">${tauxUsers}%</span>` : '-'}
            </td>
        `;
        
        agencyTableBodyEl.appendChild(row);
    });
}

/**
 * Update agency table for "Sup 100 mots" view
 */
function updateAgencyTableSup100(allRictData, descriptifData) {
    console.log('updateAgencyTableSup100 appelée');
    const stats = calculateAgencyStatisticsSup100(allRictData, descriptifData);
    console.log('Statistiques calculées:', stats.length, 'agences');
    
    // Update table headers
    updateAgencyTableHeaders();
    
    // Render table
    agencyTableBodyEl.innerHTML = '';
    
    if (stats.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="7" class="px-6 py-4 text-center text-gray-500">
                Aucune donnée disponible pour cette période
            </td>
        `;
        agencyTableBodyEl.appendChild(row);
        return;
    }
    
    stats.forEach((stat, index) => {
        const row = document.createElement('tr');
        row.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        
        // Color coding for taux de pertinence
        let tauxClass = 'text-gray-500';
        let tauxBg = '';
        if (stat.contractsWithRICT100Plus > 0) {
            const rate = stat.aiRelevanceRate;
            if (rate >= 50) {
                tauxClass = 'text-white font-bold';
                tauxBg = 'bg-green-500';
            } else if (rate >= 30) {
                tauxClass = 'text-white font-bold';
                tauxBg = 'bg-yellow-500';
            } else {
                tauxClass = 'text-white font-bold';
                tauxBg = 'bg-red-500';
            }
        }
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${escapeHtml(stat.direction)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${escapeHtml(stat.agency)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${stat.uniqueContracts}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${stat.contractsWithRICT100Plus}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${stat.contractsWithAIOrRICT100Plus}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${tauxClass}">
                ${stat.contractsWithRICT100Plus > 0 ? `<span class="px-3 py-1 rounded-full ${tauxBg}">${stat.aiRelevanceRate.toFixed(1)}%</span>` : '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500" style="display: none;">-</td>
        `;
        
        agencyTableBodyEl.appendChild(row);
    });
}

// Update KPIs
function updateKPIs() {
    // Get data for KPIs (respects cumulative mode)
    const kpis = processData(allData, filters, isCumulativeMode);
    
    totalUsersEl.textContent = kpis.totalUsers;
    totalRictEl.textContent = kpis.totalRict;
    totalDescriptifsEl.textContent = kpis.totalDescriptifs;
    totalOperationsEl.textContent = kpis.totalOperations;
    
    // Calculate and display descriptifs percentage
    if (kpis.totalRict > 0) {
        const percentage = ((kpis.totalDescriptifs / kpis.totalRict) * 100).toFixed(1);
        descriptifsPercentEl.textContent = `(${percentage}%)`;
    } else {
        descriptifsPercentEl.textContent = '(-)';
    }
    
    // Calculate and display operations percentage
    if (kpis.totalRict > 0) {
        const percentage = ((kpis.totalOperations / kpis.totalRict) * 100).toFixed(1);
        operationsPercentEl.textContent = `(${percentage}%)`;
    } else {
        operationsPercentEl.textContent = '(-)';
    }
    
    // Update gains
    updateGains(kpis.totalOperations, kpis.totalRict, kpis.totalUsers);
    
    // Update first date display (only once with all data)
    const firstDate = getFirstDate(allData);
    if (firstDate) {
        firstDateTextEl.textContent = formatFirstDate(firstDate.toISOString());
    }
    
    // For agency table, we need both all RICT and descriptif-filtered data
    const allRictFiltered = filterYieldAffairs(allData);
    const allRictWithFilters = filterByAgence(filterByDR(
        isCumulativeMode ? allRictFiltered : filterByDateRange(allRictFiltered, filters.startDate, filters.endDate),
        filters.dr
    ), filters.agence);
    
    // Update table headers if needed
    updateAgencyTableHeaders();
    updateAgencyTable(allRictWithFilters, kpis.filteredData);
    updateSortIcons();
    
    // For chart: apply all filters except month (always show all months)
    const chartData = getChartData();
    updateChart(chartData);
    updateRatesChart(chartData);
}

// Get data for chart (filtered by DR and Agency, but not by month or type)
function getChartData() {
    let allFiltered = filterYieldAffairs(allData);
    
    // Apply DR filter
    allFiltered = filterByDR(allFiltered, filters.dr);
    
    // Apply agence filter
    allFiltered = filterByAgence(allFiltered, filters.agence);
    
    // Also get descriptif-filtered data
    let descriptifFiltered = filterByType(allFiltered, DESCRIPTIF_TYPE);
    
    return {
        all: allFiltered, // All RICT
        descriptifs: descriptifFiltered // Only descriptifs
    };
}

// Update chart
function updateChart(data) {
    const monthGroups = {
        rict: {},
        operations: {}
    };
    
    // Count unique RICT (affaires uniques) by month
    data.all.forEach((item) => {
        const date = parseDate(item.createdAt);
        if (!date) {
            console.log('Invalid date found:', item.createdAt);
            return;
        }
        
        // Group by month (YYYY-MM)
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const monthKey = `${year}-${month}`;
        
        if (!monthGroups.rict[monthKey]) {
            monthGroups.rict[monthKey] = new Set();
        }
        
        // Ajouter le contractNumber au Set pour compter les affaires uniques
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            monthGroups.rict[monthKey].add(item.contractNumber);
        }
    });
    
    // Count unique operations (descriptifs effectifs) by month
    data.descriptifs.forEach((item) => {
        const date = parseDate(item.createdAt);
        if (!date) return;
        
        // Exclure les RICT avec moins de 100 mots dans le résultat de l'IA
        const processedAI = extractText(item.aiResult || item.description || '');
        const wordCount = countWords(processedAI);
        if (wordCount < 100) return;
        
        // Group by month (YYYY-MM)
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const monthKey = `${year}-${month}`;
        
        if (!monthGroups.operations[monthKey]) {
            monthGroups.operations[monthKey] = new Set();
        }
        
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            monthGroups.operations[monthKey].add(item.contractNumber);
        }
    });
    
    // Get all unique months from both datasets
    const allMonths = new Set([
        ...Object.keys(monthGroups.rict),
        ...Object.keys(monthGroups.operations)
    ]);
    
    // Sort months
    const sortedMonths = Array.from(allMonths).sort();
    
    console.log('Chart months found:', sortedMonths);
    console.log('First month data:', sortedMonths[0], {
        rict: monthGroups.rict[sortedMonths[0]],
        operations: monthGroups.operations[sortedMonths[0]]?.size
    });
    
    // Format month labels (e.g., "Jan 2024")
    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const formattedLabels = sortedMonths.map(monthKey => {
        const [year, month] = monthKey.split('-');
        const monthIndex = parseInt(month) - 1;
        return `${monthNames[monthIndex]} ${year}`;
    });
    
    const rictData = sortedMonths.map((month) => {
        const ricts = monthGroups.rict[month];
        return ricts ? ricts.size : 0;
    });
    const operationsData = sortedMonths.map((month) => {
        const ops = monthGroups.operations[month];
        return ops ? ops.size : 0;
    });
    
    // Create or update chart
    const canvas = document.getElementById('dateChart');
    
    if (!canvas) {
        console.error('Canvas element "dateChart" not found');
        return;
    }
    
    if (dateChart) {
        dateChart.destroy();
    }
    
    const ctx = canvas.getContext('2d');
    
    dateChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: formattedLabels,
            datasets: [
                {
                    label: 'Nombre total de RICT',
                    data: rictData,
                    backgroundColor: 'rgba(156, 163, 175, 0.6)',
                    borderColor: 'rgba(107, 114, 128, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverBackgroundColor: 'rgba(156, 163, 175, 0.8)',
                    hoverBorderColor: 'rgba(75, 85, 99, 1)',
                    hoverBorderWidth: 3
                },
                {
                    label: 'Descriptifs effectifs générés',
                    data: operationsData,
                    backgroundColor: 'rgba(59, 130, 246, 0.75)',
                    borderColor: 'rgba(37, 99, 235, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverBackgroundColor: 'rgba(59, 130, 246, 0.9)',
                    hoverBorderColor: 'rgba(29, 78, 216, 1)',
                    hoverBorderWidth: 3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2.5,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        font: {
                            size: 13,
                            weight: '500'
                        },
                        color: '#1F2937',
                        padding: 15,
                        usePointStyle: true,
                        pointStyle: 'rectRounded'
                    }
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    titleColor: '#F9FAFB',
                    bodyColor: '#E5E7EB',
                    borderColor: 'rgba(75, 85, 99, 0.5)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    titleFont: {
                        size: 14,
                        weight: 'bold'
                    },
                    bodyFont: {
                        size: 13
                    },
                    displayColors: true,
                    callbacks: {
                        title: function(context) {
                            return context[0].label || '';
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ' : ';
                            }
                            label += formatNumber(context.parsed.y);
                            return label;
                        },
                        afterBody: function(context) {
                            if (context.length >= 2) {
                                const rictCount = context[0].parsed.y;
                                const descriptifCount = context[1].parsed.y;
                                const percentage = rictCount > 0 ? ((descriptifCount / rictCount) * 100).toFixed(1) : 0;
                                return [
                                    '',
                                    'Taux de génération : ' + percentage + '%'
                                ];
                            }
                            return [];
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: false,
                    grid: {
                        display: false
                    },
                    title: {
                        display: true,
                        text: 'Période',
                        font: {
                            size: 14,
                            weight: 'bold'
                        },
                        color: '#374151'
                    },
                    ticks: {
                        font: {
                            size: 12
                        },
                        color: '#6B7280'
                    }
                },
                y: {
                    stacked: false,
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(229, 231, 235, 0.8)',
                        lineWidth: 1
                    },
                    title: {
                        display: true,
                        text: 'Nombre',
                        font: {
                            size: 14,
                            weight: 'bold'
                        },
                        color: '#374151'
                    },
                    ticks: {
                        font: {
                            size: 12
                        },
                        color: '#6B7280',
                        precision: 0
                    }
                }
            }
        }
    });
}

// Update rates chart (taux d'utilisation descriptifs et taux d'adoption)
function updateRatesChart(data) {
    const monthGroups = {
        rict: {},
        operations: {},
        users: {}
    };
    
    // Count unique RICT (affaires uniques) by month
    data.all.forEach((item) => {
        const date = parseDate(item.createdAt);
        if (!date) return;
        
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const monthKey = `${year}-${month}`;
        
        if (!monthGroups.rict[monthKey]) {
            monthGroups.rict[monthKey] = new Set();
        }
        
        // Ajouter le contractNumber au Set pour compter les affaires uniques
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            monthGroups.rict[monthKey].add(item.contractNumber);
        }
    });
    
    // Count unique operations (descriptifs effectifs) and users by month
    data.descriptifs.forEach((item) => {
        const date = parseDate(item.createdAt);
        if (!date) return;
        
        // Exclure les RICT avec moins de 100 mots dans le résultat de l'IA
        const processedAI = extractText(item.aiResult || item.description || '');
        const wordCount = countWords(processedAI);
        if (wordCount < 100) return;
        
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const monthKey = `${year}-${month}`;
        
        if (!monthGroups.operations[monthKey]) {
            monthGroups.operations[monthKey] = new Set();
        }
        if (!monthGroups.users[monthKey]) {
            monthGroups.users[monthKey] = new Set();
        }
        
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            monthGroups.operations[monthKey].add(item.contractNumber);
        }
        if (item.email && item.email.trim() !== '') {
            monthGroups.users[monthKey].add(item.email);
        }
    });
    
    // Get all unique months
    const allMonths = new Set([
        ...Object.keys(monthGroups.rict),
        ...Object.keys(monthGroups.operations)
    ]);
    
    // Sort months
    const sortedMonths = Array.from(allMonths).sort();
    
    // Format month labels
    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const formattedLabels = sortedMonths.map(monthKey => {
        const [year, month] = monthKey.split('-');
        const monthIndex = parseInt(month) - 1;
        return `${monthNames[monthIndex]} ${year}`;
    });
    
    // Calculate rates
    const tauxDescriptifs = sortedMonths.map((month) => {
        const ricts = monthGroups.rict[month];
        const rict = ricts ? ricts.size : 0;
        const ops = monthGroups.operations[month] ? monthGroups.operations[month].size : 0;
        return rict > 0 ? (ops / rict) * 100 : 0;
    });
    
    // Get effectif for agencies present in the filtered data
    const agenciesInData = new Set();
    data.all.forEach(item => {
        if (item.agencyCode) {
            agenciesInData.add(item.agencyCode);
        }
    });
    
    // Calculate total effectif only for agencies in filtered data
    let totalEffectif = 0;
    agenciesInData.forEach(agencyCode => {
        totalEffectif += agencyPopulation[agencyCode] || 0;
    });
    
    console.log('Chart - Agencies in data:', Array.from(agenciesInData));
    console.log('Chart - Total effectif for filtered agencies:', totalEffectif);
    
    const tauxUtilisateurs = sortedMonths.map((month) => {
        const users = monthGroups.users[month] ? monthGroups.users[month].size : 0;
        const rate = totalEffectif > 0 ? (users / totalEffectif) * 100 : 0;
        console.log(`Chart - Month ${month}: ${users} users / ${totalEffectif} effectif = ${rate.toFixed(1)}%`);
        return rate;
    });
    
    // Create or update chart
    const canvas = document.getElementById('ratesChart');
    
    if (!canvas) {
        console.error('Canvas element "ratesChart" not found');
        return;
    }
    
    if (ratesChart) {
        ratesChart.destroy();
    }
    
    const ctx = canvas.getContext('2d');
    
    ratesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: formattedLabels,
            datasets: [
                {
                    label: 'Taux d\'utilisation descriptifs (%)',
                    data: tauxDescriptifs,
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBackgroundColor: 'rgba(59, 130, 246, 1)',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                },
                {
                    label: 'Taux d\'adoption (%)',
                    data: tauxUtilisateurs,
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderColor: 'rgba(16, 185, 129, 1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBackgroundColor: 'rgba(16, 185, 129, 1)',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2.5,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        font: {
                            size: 13,
                            weight: '500'
                        },
                        color: '#1F2937',
                        padding: 15,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    titleColor: '#F9FAFB',
                    bodyColor: '#E5E7EB',
                    borderColor: 'rgba(75, 85, 99, 0.5)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    titleFont: {
                        size: 14,
                        weight: 'bold'
                    },
                    bodyFont: {
                        size: 13
                    },
                    displayColors: true,
                    callbacks: {
                        title: function(context) {
                            return context[0].label || '';
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ' : ';
                            }
                            label += context.parsed.y.toFixed(1) + '%';
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    title: {
                        display: true,
                        text: 'Période',
                        font: {
                            size: 14,
                            weight: 'bold'
                        },
                        color: '#374151'
                    },
                    ticks: {
                        font: {
                            size: 12
                        },
                        color: '#6B7280'
                    }
                },
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: {
                        color: 'rgba(229, 231, 235, 0.8)',
                        lineWidth: 1
                    },
                    title: {
                        display: true,
                        text: 'Taux (%)',
                        font: {
                            size: 14,
                            weight: 'bold'
                        },
                        color: '#374151'
                    },
                    ticks: {
                        font: {
                            size: 12
                        },
                        color: '#6B7280',
                        callback: function(value) {
                            return value + '%';
                        }
                    }
                }
            }
        }
    });
}

// Event Listeners
// Agency view toggle event listener
let toggleSetupDone = false;
function setupAgencyViewToggle() {
    if (toggleSetupDone) {
        console.log('Toggle déjà configuré, ignoré');
        return;
    }
    
    const toggleEl = document.getElementById('agency-view-toggle');
    if (!toggleEl) {
        console.warn('Toggle agency-view-toggle non trouvé, réessai dans 100ms...');
        setTimeout(setupAgencyViewToggle, 100);
        return;
    }
    
    console.log('Toggle trouvé, ajout de l\'event listener');
    toggleSetupDone = true;
    
    toggleEl.addEventListener('change', (e) => {
        console.log('Toggle changé:', e.target.checked);
        agencyViewMode = e.target.checked ? 'sup100' : 'general';
        console.log('Mode changé à:', agencyViewMode);
        
        // Update table headers
        updateAgencyTableHeaders();
        
        // Refresh table
        const allRictFiltered = filterYieldAffairs(allData);
        const allRictWithFilters = filterByAgence(filterByDR(
            isCumulativeMode ? allRictFiltered : filterByDateRange(allRictFiltered, filters.startDate, filters.endDate),
            filters.dr
        ), filters.agence);
        const kpis = processData(allData, filters, isCumulativeMode);
        updateAgencyTable(allRictWithFilters, kpis.filteredData);
        updateSortIcons();
    });
}

/**
 * Update table headers based on current view mode
 */
function updateAgencyTableHeaders() {
    console.log('updateAgencyTableHeaders appelée, mode:', agencyViewMode);
    const tableBody = document.getElementById('agency-table-body');
    if (!tableBody) {
        console.warn('Table body non trouvé');
        return;
    }
    
    const table = tableBody.closest('table');
    if (!table) {
        console.warn('Table non trouvée');
        return;
    }
    
    const tableHeaders = table.querySelectorAll('thead th');
    console.log('Nombre d\'en-têtes trouvés:', tableHeaders.length);
    if (tableHeaders.length >= 7) {
        if (agencyViewMode === 'sup100') {
            console.log('Mise à jour des en-têtes pour mode Sup 100 mots');
            // Colonne 3 : Nombre d'affaires uniques
            const div3 = tableHeaders[2].querySelector('div');
            if (div3) div3.innerHTML = 'Nombre d\'affaires uniques <span id="sort-icon-rict" class="ml-1 text-gray-400">↕</span>';
            // Colonne 4 : Nombre d'affaires uniques avec un RICT de plus de 100 mots
            const div4 = tableHeaders[3].querySelector('div');
            if (div4) div4.innerHTML = 'Nombre d\'affaires uniques avec un RICT de plus de 100 mots <span id="sort-icon-operations" class="ml-1 text-gray-400">↕</span>';
            // Colonne 5 : Nombre d'affaires uniques avec Descriptif sommaire travaux et/ou RICT > 100 mots
            const div5 = tableHeaders[4].querySelector('div');
            if (div5) div5.innerHTML = 'Nombre d\'affaires uniques avec Descriptif sommaire travaux et/ou RICT > 100 mots <span id="sort-icon-users" class="ml-1 text-gray-400">↕</span>';
            // Colonne 6 : Taux de pertinence d'utilisation de l'IA (%)
            const div6 = tableHeaders[5].querySelector('div');
            if (div6) div6.innerHTML = 'Taux de pertinence d\'utilisation de l\'IA (%) <span id="sort-icon-rateDescriptifs" class="ml-1 text-gray-400">↕</span>';
            // Masquer la dernière colonne (Taux d'adoption)
            tableHeaders[6].style.display = 'none';
        } else {
            console.log('Mise à jour des en-têtes pour mode Général');
            // Mode Général - restaurer les en-têtes originaux
            const div3 = tableHeaders[2].querySelector('div');
            if (div3) div3.innerHTML = 'Nombre total de RICT <span id="sort-icon-rict" class="ml-1 text-gray-400">↕</span>';
            const div4 = tableHeaders[3].querySelector('div');
            if (div4) div4.innerHTML = 'Descriptifs effectifs générés <span id="sort-icon-operations" class="ml-1 text-gray-400">↕</span>';
            const div5 = tableHeaders[4].querySelector('div');
            if (div5) div5.innerHTML = 'Nombre d\'utilisateurs <span id="sort-icon-users" class="ml-1 text-gray-400">↕</span>';
            const div6 = tableHeaders[5].querySelector('div');
            if (div6) div6.innerHTML = 'Taux utilisation descriptifs <span id="sort-icon-rateDescriptifs" class="ml-1 text-gray-400">↕</span>';
            // Afficher la dernière colonne
            tableHeaders[6].style.display = '';
        }
    } else {
        console.warn('Pas assez d\'en-têtes trouvés:', tableHeaders.length);
    }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

startDateFilterEl.addEventListener('change', (e) => {
    filters.startDate = e.target.value || null;
    updateKPIs();
});

endDateFilterEl.addEventListener('change', (e) => {
    filters.endDate = e.target.value || null;
    updateKPIs();
});

drFilterEl.addEventListener('change', (e) => {
    filters.dr = e.target.value === 'all' ? null : e.target.value;
    updateKPIs();
});

agencyFilterEl.addEventListener('change', (e) => {
    filters.agence = e.target.value === 'all' ? null : e.target.value;
    updateKPIs();
});

resetFiltersBtn.addEventListener('click', () => {
    const range = getCurrentMonthRange();
    startDateFilterEl.value = range.startDate;
    endDateFilterEl.value   = range.endDate;
    drFilterEl.value = 'all';
    agencyFilterEl.value = 'all';
    filters.startDate = range.startDate;
    filters.endDate   = range.endDate;
    filters.dr = null;
    filters.agence = null;
    cumulToggleEl.checked = false;
    isCumulativeMode = false;
    updateKPIs();
});

// Cumulative toggle event listener
cumulToggleEl.addEventListener('change', (e) => {
    isCumulativeMode = e.target.checked;
    updateKPIs();
});

// Settings modal event listeners
settingsBtn.addEventListener('click', () => {
    // Populate current values
    inputMinutesEl.value = parameters.minutesPerDescriptif;
    inputAnnualHoursEl.value = parameters.annualHours;
    inputRevenueEl.value = parameters.totalRevenue;
    settingsModal.classList.remove('hidden');
});

closeModalBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

saveSettingsBtn.addEventListener('click', () => {
    // Update parameters
    parameters.minutesPerDescriptif = parseFloat(inputMinutesEl.value) || 30;
    parameters.annualHours = parseFloat(inputAnnualHoursEl.value) || 1607;
    parameters.totalRevenue = parseFloat(inputRevenueEl.value) || 44000000;
    
    // Save to localStorage
    saveParameters();
    
    // Close modal
    settingsModal.classList.add('hidden');
    
    // Recalculate gains
    updateKPIs();
});

cancelSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

// Close modal on background click
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.classList.add('hidden');
    }
});

// Records Modal Elements
const viewRecordsBtn = document.getElementById('view-records-btn');
const recordsModal = document.getElementById('records-modal');
const closeRecordsModalBtn = document.getElementById('close-records-modal');
const closeRecordsModalBtn2 = document.getElementById('close-records-modal-btn');
const recordsTableBodyEl = document.getElementById('records-table-body');
const recordsCountEl = document.getElementById('records-count');
const exportRecordsBtn = document.getElementById('export-records-btn');

// Store current records for export
let currentRecords = [];

// Format date for display
function formatDateForDisplay(dateString) {
    if (!dateString) return '-';
    const date = parseDate(dateString);
    if (!date) return dateString; // Return original if can't parse
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${day}/${month}/${year} ${hours}:${minutes}`;
}

// Show records modal with current filtered data
function showRecordsModal() {
    // Get the current filtered data (descriptifs only)
    let filteredData = filterYieldAffairs(allData);
    
    // Apply filters
    if (!isCumulativeMode) {
        filteredData = filterByDateRange(filteredData, filters.startDate, filters.endDate);
    }
    filteredData = filterByDR(filteredData, filters.dr);
    filteredData = filterByAgence(filteredData, filters.agence);
    filteredData = filterByType(filteredData, DESCRIPTIF_TYPE);
    
    // Sort by date (most recent first)
    filteredData.sort((a, b) => {
        const dateA = parseDate(a.createdAt);
        const dateB = parseDate(b.createdAt);
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateB - dateA;
    });
    
    // Store for export
    currentRecords = filteredData;
    
    // Update count
    recordsCountEl.textContent = filteredData.length;
    
    // Clear table
    recordsTableBodyEl.innerHTML = '';
    
    // Populate table
    if (filteredData.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="4" class="px-6 py-4 text-center text-gray-500">
                Aucun enregistrement disponible pour cette période
            </td>
        `;
        recordsTableBodyEl.appendChild(row);
    } else {
        filteredData.forEach((record, index) => {
            const row = document.createElement('tr');
            row.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
            
            row.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">
                    ${record.contractNumber || '-'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${formatDateForDisplay(record.createdAt)}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${record.email || '-'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-blue-600">
                    ${record.agency || '-'}
                </td>
            `;
            
            recordsTableBodyEl.appendChild(row);
        });
    }
    
    // Show modal
    recordsModal.classList.remove('hidden');
}

// Export records to CSV
function exportRecordsToCSV() {
    if (currentRecords.length === 0) {
        alert('Aucun enregistrement à exporter');
        return;
    }
    
    // Create CSV content
    const headers = ['Contract Number', 'Date de diffusion', 'User Email', 'ProductionService (Agence)'];
    const csvRows = [headers.join(',')];
    
    currentRecords.forEach(record => {
        const row = [
            `"${record.contractNumber || ''}"`,
            `"${record.createdAt || ''}"`,
            `"${record.email || ''}"`,
            `"${record.agency || ''}"`
        ];
        csvRows.push(row.join(','));
    });
    
    const csvContent = csvRows.join('\n');
    
    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `enregistrements_descriptifs_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Records modal event listeners
viewRecordsBtn.addEventListener('click', showRecordsModal);

closeRecordsModalBtn.addEventListener('click', () => {
    recordsModal.classList.add('hidden');
});

closeRecordsModalBtn2.addEventListener('click', () => {
    recordsModal.classList.add('hidden');
});

recordsModal.addEventListener('click', (e) => {
    if (e.target === recordsModal) {
        recordsModal.classList.add('hidden');
    }
});

exportRecordsBtn.addEventListener('click', exportRecordsToCSV);

// Authenticate and get data URL
async function authenticateAndGetURL() {
    const storedPassword = localStorage.getItem('roi_password');
    
    if (!storedPassword) {
        window.location.href = 'index.html';
        return null;
    }
    
    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: storedPassword
        });
        
        if (!response.ok) {
            localStorage.removeItem('roi_password');
            window.location.href = 'index.html';
            return null;
        }
        
        const result = await response.text();
        const descriptifMatch = result.match(/DESCRIPTIF_URL = '([^']+)'/);
        
        if (descriptifMatch) {
            return descriptifMatch[1];
        }
        
        window.location.href = 'index.html';
        return null;
    } catch (error) {
        console.error('Authentication error:', error);
        window.location.href = 'index.html';
        return null;
    }
}

// Initialize
async function init() {
    try {
        // Load saved parameters
        loadParameters();
        
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');
        mainContentEl.classList.add('hidden');
        
        // Authenticate and get data URL
        DATA_URL = await authenticateAndGetURL();
        if (!DATA_URL) {
            return;
        }

        console.log('Fetching data from:', DATA_URL);
        
        // Load both data sources in parallel
        const [dataResponse, populationDataResult] = await Promise.all([
            fetch(DATA_URL),
            loadAgencyPopulation()
        ]);
        
        if (!dataResponse.ok) {
            throw new Error(`HTTP error! Status: ${dataResponse.status}`);
        }
        
        agencyPopulation = populationDataResult.population;
        agencyToDR = populationDataResult.drMapping;
        emailToAgency = populationDataResult.emailMap || {};
        
        const rawText = await dataResponse.text();
        console.log('Response received, length:', rawText.length);
        console.log('First 200 chars:', rawText.substring(0, 200));
        
        let csvData = null;
        
        try {
            const jsonData = JSON.parse(rawText);
            
            if (Array.isArray(jsonData) && jsonData.length > 0 && jsonData[0].data) {
                console.log('Found JSON array with data field in first element');
                csvData = jsonData[0].data;
            }
            else if (jsonData.data && typeof jsonData.data === 'string') {
                console.log('Found JSON object with data field');
                csvData = jsonData.data;
            }
        } catch (jsonError) {
            console.log('Standard JSON parsing failed:', jsonError.message);
        }
        
        if (!csvData && rawText.includes('{data:')) {
            console.log('Detected malformed JSON format, extracting CSV manually');
            const dataStart = rawText.indexOf('{data:') + 6;
            const dataEnd = rawText.lastIndexOf('}');
            if (dataStart < dataEnd) {
                csvData = rawText.substring(dataStart, dataEnd).trim();
                console.log('Extracted CSV from malformed JSON, length:', csvData.length);
            }
        }
        
        if (!csvData) {
            console.log('No CSV data found, trying raw text as CSV');
            csvData = rawText;
        }
        
        console.log('CSV data length:', csvData.length);
        console.log('First 200 chars of CSV:', csvData.substring(0, 200));
        
        allData = parseCSVData(csvData);
        
        if (allData.length === 0) {
            throw new Error('No data parsed from CSV');
        }

        // Debug: Check how many dates are valid
        const validDates = allData.filter(item => parseDate(item.createdAt) !== null);
        console.log('Total rows:', allData.length);
        console.log('Rows with valid dates:', validDates.length);
        if (validDates.length > 0) {
            const dates = validDates.map(item => parseDate(item.createdAt)).sort((a, b) => a - b);
            console.log('First date:', dates[0]);
            console.log('Last date:', dates[dates.length - 1]);
        }
        
        // Get available agencies and DRs
        availableAgencies = getAvailableAgencies(allData);
        availableDRs = getAvailableDRs(allData);
        populateAgencyFilter();
        populateDRFilter();

        // Set default filter to current month range
        const range = getCurrentMonthRange();
        startDateFilterEl.value = range.startDate;
        endDateFilterEl.value   = range.endDate;
        filters.startDate = range.startDate;
        filters.endDate   = range.endDate;

        // Update KPIs
        updateKPIs();
        
        // Setup agency view toggle after content is loaded
        setupAgencyViewToggle();

        // Show main content
        loadingEl.classList.add('hidden');
        mainContentEl.classList.remove('hidden');
        
    } catch (error) {
        console.error('Error loading data:', error);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }
}

// Start the app
init();

