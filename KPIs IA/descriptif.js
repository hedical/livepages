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
let dateChart = null;
let ratesChart = null;
let tableSortState = {
    column: 'users', // Default sort by users
    ascending: false
};
let isCumulativeMode = false;

// Parameters (stored in localStorage)
let parameters = {
    minutesPerDescriptif: 30,
    annualHours: 1607,
    totalRevenue: 44000000
};

// Filters
const filters = {
    month: null, // Format: YYYY-MM
    dr: null,
    agence: null,
};

// DOM Elements
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const mainContentEl = document.getElementById('main-content');
const monthFilterEl = document.getElementById('month-filter');
const drFilterEl = document.getElementById('dr-filter');
const agencyFilterEl = document.getElementById('agency-filter');
const resetFiltersBtn = document.getElementById('reset-filters');
const agencyTableBodyEl = document.getElementById('agency-table-body');
const firstDateTextEl = document.getElementById('first-date-text');

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

// Get current month in YYYY-MM format
function getCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
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
function calculateGains(descriptifsCount) {
    // 1. Gain en temps (minutes → heures)
    const timeGainMinutes = descriptifsCount * parameters.minutesPerDescriptif;
    const timeGainHours = timeGainMinutes / 60;
    
    // 2. Total effectif
    const totalEffectif = getTotalEffectif();
    
    // 3. Gain en % volume d'affaire
    let percentGain = 0;
    if (totalEffectif > 0 && parameters.annualHours > 0) {
        percentGain = (timeGainHours / (totalEffectif * parameters.annualHours)) * 100;
    }
    
    // 4. Gain en €
    const euroGain = (percentGain / 100) * parameters.totalRevenue;
    
    return {
        timeGainHours,
        percentGain,
        euroGain
    };
}

// Calculate number of months in current period
function calculatePeriodMonths() {
    if (!isCumulativeMode) {
        // Mode "Mois" : 1 mois
        return 1;
    }
    
    // Mode "Cumulé" : calculer le nombre de mois depuis la première date
    const firstDate = getFirstDate(allData);
    if (!firstDate) return 1;
    
    const now = new Date();
    const yearsDiff = now.getFullYear() - firstDate.getFullYear();
    const monthsDiff = now.getMonth() - firstDate.getMonth();
    const totalMonths = yearsDiff * 12 + monthsDiff + 1; // +1 pour inclure le mois en cours
    
    return Math.max(1, totalMonths); // Au moins 1 mois
}

// Update gains display
function updateGains(descriptifsCount, totalRictCount) {
    const gains = calculateGains(descriptifsCount);
    const maxGains = calculateGains(totalRictCount);
    
    // Calculate projection for the year
    const periodMonths = calculatePeriodMonths();
    const projectionMultiplier = 12 / periodMonths;
    const projectedDescriptifs = descriptifsCount * projectionMultiplier;
    const projectionGains = calculateGains(projectedDescriptifs);
    
    // Calculate max projection for the year
    const projectedMaxDescriptifs = totalRictCount * projectionMultiplier;
    const maxProjectionGains = calculateGains(projectedMaxDescriptifs);
    
    // Update time gain
    gainTimeEl.textContent = formatHours(gains.timeGainHours);
    gainTimeFormulaEl.textContent = `${formatNumber(descriptifsCount)} descriptifs × ${parameters.minutesPerDescriptif}min`;
    gainTimeMaxEl.textContent = `Max atteignable: ${formatHours(maxGains.timeGainHours)}`;
    gainTimeProjectionEl.textContent = `Projection année: ${formatHours(projectionGains.timeGainHours)} (${periodMonths} mois)`;
    gainTimeMaxProjectionEl.textContent = `Projection max année: ${formatHours(maxProjectionGains.timeGainHours)}`;
    
    // Update percent gain
    gainPercentEl.textContent = `${gains.percentGain.toFixed(4)}%`;
    const totalEffectif = getTotalEffectif();
    gainPercentFormulaEl.textContent = `${formatHours(gains.timeGainHours)} / (${totalEffectif} × ${parameters.annualHours}h)`;
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

// Parse population CSV file
async function loadAgencyPopulation() {
    try {
        const response = await fetch(POPULATION_CSV_URL);
        if (!response.ok) {
            console.warn('Could not load population_cible.csv');
            return { population: {}, drMapping: {} };
        }
        
        let csvText = await response.text();
        csvText = fixEncoding(csvText);
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        
        const population = {};
        const drMapping = {};
        
        // Skip header (line 0: DR;Agence;Effectif)
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(';');
            if (parts.length >= 3) {
                const dr = parts[0].trim();
                const agencyCode = parts[1].trim();
                const effectif = parseInt(parts[2].trim());
                if (agencyCode && !isNaN(effectif)) {
                    population[agencyCode] = effectif;
                    drMapping[agencyCode] = dr;
                }
            }
        }
        
        console.log('Loaded population data for', Object.keys(population).length, 'agencies');
        console.log('Loaded DR mapping for', Object.keys(drMapping).length, 'agencies');
        return { population, drMapping };
    } catch (error) {
        console.warn('Error loading population data:', error);
        return { population: {}, drMapping: {} };
    }
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
    
    const lines = csvString.split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed !== '' && trimmed !== '[' && trimmed !== ']';
    });
    
    if (lines.length === 0) {
        console.warn('No valid lines after CSV cleanup');
        return [];
    }
    
    const headerLine = lines[0];
    const headers = parseCSVLine(headerLine);
    
    console.log('CSV headers:', headers.slice(0, 10));
    
    // Find column indices
    let typeIndex = -1;
    let contractIndex = -1;
    let diffusedAtIndex = -1;
    let emailIndex = -1;
    let agencyIndex = -1;
    
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toLowerCase();
        if (typeIndex === -1 && header.includes('aideliver') && header.includes('type')) {
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
    }
    
    console.log('Column indices:', {
        type: typeIndex,
        contract: contractIndex,
        diffusedAt: diffusedAtIndex,
        email: emailIndex
    });
    
    if (typeIndex === -1 || contractIndex === -1) {
        console.warn('Missing required columns');
        return [];
    }
    
    // Parse data rows
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < headers.length / 2) {
            continue; // Skip malformed rows
        }
        
        const type = values[typeIndex] || '';
        const contractNumber = values[contractIndex] || '';
        const diffusedAt = diffusedAtIndex >= 0 ? values[diffusedAtIndex] : '';
        const email = emailIndex >= 0 ? values[emailIndex] : '';
        const agency = (agencyIndex >= 0 ? values[agencyIndex] : '') || '';
        
        // ProductionService already contains the agency code (CT95, LYCT, etc.)
        // Use it directly as agencyCode for mapping with population_cible
        const agencyCode = (agency || '').trim();
        
        data.push({
            type: (type || '').trim(),
            contractNumber: (contractNumber || '').trim(),
            createdAt: (diffusedAt || '').trim(), // Using Report → DiffusedAt as date
            email: (email || '').trim(),
            agency: (agency || '').trim(),
            agencyCode: agencyCode // Same as agency - ProductionService is the code
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
    return data.filter((item) => item.type === type);
}

function filterByMonth(data, month) {
    if (!month) return data;
    
    return data.filter((item) => {
        const date = parseDate(item.createdAt);
        if (!date) return false;
        
        const year = date.getFullYear();
        const itemMonth = String(date.getMonth() + 1).padStart(2, '0');
        const dateMonth = `${year}-${itemMonth}`;
        
        return dateMonth === month;
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
    
    // Apply month filter (skip if in cumulative mode)
    if (!skipMonthFilter) {
        allFiltered = filterByMonth(allFiltered, filters.month);
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
        if (item.email && item.email.trim() !== '') {
            uniqueUsers.add(item.email);
        }
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            uniqueOperations.add(item.contractNumber);
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

// Update agency stats table
function updateAgencyTable(allRictData, descriptifData) {
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
    
    // Count total RICT per agency (nombre unique d'affaires)
    allRictData.forEach(item => {
        if (!item.agency) return;
        initAgency(item.agency, item.agencyCode);
        
        // Créer un Set pour les contractNumber uniques si pas encore fait
        if (!agencyStats[item.agency].uniqueContracts) {
            agencyStats[item.agency].uniqueContracts = new Set();
        }
        
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            agencyStats[item.agency].uniqueContracts.add(item.contractNumber);
        }
    });
    
    // Calculer le totalRict à partir des contractNumber uniques
    Object.keys(agencyStats).forEach(agency => {
        agencyStats[agency].totalRict = agencyStats[agency].uniqueContracts ? agencyStats[agency].uniqueContracts.size : 0;
    });
    
    // Count descriptifs effectifs and users per agency
    descriptifData.forEach(item => {
        if (!item.agency) return;
        initAgency(item.agency, item.agencyCode);
        
        if (item.email && item.email.trim() !== '') {
            agencyStats[item.agency].users.add(item.email);
        }
        
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            agencyStats[item.agency].operations.add(item.contractNumber);
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
    updateGains(kpis.totalOperations, kpis.totalRict);
    
    // Update first date display (only once with all data)
    const firstDate = getFirstDate(allData);
    if (firstDate) {
        firstDateTextEl.textContent = formatFirstDate(firstDate.toISOString());
    }
    
    // For agency table, we need both all RICT and descriptif-filtered data
    const allRictFiltered = filterYieldAffairs(allData);
    const allRictWithFilters = filterByAgence(filterByDR(
        isCumulativeMode ? allRictFiltered : filterByMonth(allRictFiltered, filters.month),
        filters.dr
    ), filters.agence);
    
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
monthFilterEl.addEventListener('change', (e) => {
    filters.month = e.target.value;
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
    monthFilterEl.value = getCurrentMonth();
    drFilterEl.value = 'all';
    agencyFilterEl.value = 'all';
    filters.month = getCurrentMonth();
    filters.dr = null;
    filters.agence = null;
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
        filteredData = filterByMonth(filteredData, filters.month);
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

        // Set default filter to current month
        const currentMonth = getCurrentMonth();
        monthFilterEl.value = currentMonth;
        filters.month = currentMonth;

        // Update KPIs
        updateKPIs();

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

