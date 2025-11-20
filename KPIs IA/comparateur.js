// Configuration
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordROI';
const POPULATION_CSV_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/population_cible.csv';

// Data URL will be fetched from webhook after authentication
let DATA_URL = '';

// State
let allData = [];
let availableAgencies = [];
let availableDRs = [];
let agencyPopulation = {}; // {agencyCode: effectif}
let agencyToDR = {}; // {agencyCode: DR}
let dateChart = null;
let tableSortState = {
    column: 'users', // Default sort by users
    ascending: false
};
let isCumulativeMode = false;

// Parameters (stored in localStorage)
let parameters = {
    secondsPerPage: 20,
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
const totalComparisonsEl = document.getElementById('total-comparisons');
const totalPagesEl = document.getElementById('total-pages');
const totalOperationsEl = document.getElementById('total-operations');

// Gains Elements
const gainTimeEl = document.getElementById('gain-time');
const gainTimeFormulaEl = document.getElementById('gain-time-formula');
const gainTimeProjectionEl = document.getElementById('gain-time-projection');
const gainPercentEl = document.getElementById('gain-percent');
const gainPercentFormulaEl = document.getElementById('gain-percent-formula');
const gainPercentProjectionEl = document.getElementById('gain-percent-projection');
const gainEuroEl = document.getElementById('gain-euro');
const gainEuroFormulaEl = document.getElementById('gain-euro-formula');
const gainEuroProjectionEl = document.getElementById('gain-euro-projection');
const cumulToggleEl = document.getElementById('cumul-toggle');

// Settings Modal Elements
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeModalBtn = document.getElementById('close-modal');
const saveSettingsBtn = document.getElementById('save-settings');
const cancelSettingsBtn = document.getElementById('cancel-settings');
const inputSecondsEl = document.getElementById('input-seconds');
const inputAnnualHoursEl = document.getElementById('input-annual-hours');
const inputRevenueEl = document.getElementById('input-revenue');

// Utility Functions
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
        // Try format: "DD Month, YYYY, HH:MM" (e.g., "28 octobre, 2025, 16:13")
        const frenchMonths = {
            'janvier': 0, 'février': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5,
            'juillet': 6, 'août': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11
        };
        
        const match = cleanDate.match(/(\d+)\s+(\w+),?\s+(\d{4})/);
        if (match) {
            const day = parseInt(match[1]);
            const monthName = match[2].toLowerCase();
            const year = parseInt(match[3]);
            
            if (frenchMonths[monthName] !== undefined) {
                date = new Date(year, frenchMonths[monthName], day);
            }
        }
    }
    
    if (isNaN(date.getTime())) {
        return null;
    }
    
    return date;
}

// Extract agency code from contract number (e.g., "C-AGCT-2025-20-258669" → "AGCT")
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

// Parse LongResult JSON to extract max page number
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
            
            console.log(`Extracted max page: ${maxPage} from ${items.length} items`);
            return maxPage;
        }
    } catch (e) {
        console.error('Failed to parse LongResult JSON:', e.message);
        console.log('LongResult sample:', longResultString.substring(0, 200));
    }
    
    return 0;
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
    const saved = localStorage.getItem('comparateur_parameters');
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
    localStorage.setItem('comparateur_parameters', JSON.stringify(parameters));
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

// Calculate gains based on pages analyzed
function calculateGains(totalPages) {
    // 1. Gain en temps (secondes → heures)
    const timeGainSeconds = totalPages * parameters.secondsPerPage;
    const timeGainHours = timeGainSeconds / 3600;
    
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
function updateGains(totalPages) {
    const gains = calculateGains(totalPages);
    
    // Calculate projection for the year
    const periodMonths = calculatePeriodMonths();
    const projectionMultiplier = 12 / periodMonths;
    const projectedPages = totalPages * projectionMultiplier;
    const projectionGains = calculateGains(projectedPages);
    
    // Update time gain
    gainTimeEl.textContent = formatHours(gains.timeGainHours);
    gainTimeFormulaEl.textContent = `${formatNumber(totalPages)} pages × ${parameters.secondsPerPage}s`;
    gainTimeProjectionEl.textContent = `Projection année: ${formatHours(projectionGains.timeGainHours)} (${periodMonths} mois)`;
    
    // Update percent gain
    gainPercentEl.textContent = `${gains.percentGain.toFixed(4)}%`;
    const totalEffectif = getTotalEffectif();
    gainPercentFormulaEl.textContent = `${formatHours(gains.timeGainHours)} / (${totalEffectif} × ${parameters.annualHours}h)`;
    gainPercentProjectionEl.textContent = `Projection année: ${projectionGains.percentGain.toFixed(4)}%`;
    
    // Update euro gain
    gainEuroEl.textContent = `${formatNumber(gains.euroGain)} €`;
    gainEuroFormulaEl.textContent = `${gains.percentGain.toFixed(4)}% × ${formatNumber(parameters.totalRevenue)} €`;
    gainEuroProjectionEl.textContent = `Projection année: ${formatNumber(projectionGains.euroGain)} €`;
}

// Helper function to parse a CSV line with quoted values
function parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = i + 1 < line.length ? line[i + 1] : null;
        
        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // This is an escaped quote ("") inside a quoted value
                // Add a single quote to the result
                current += '"';
                i++; // Skip the next quote
            } else {
                // This is a quote that starts or ends a quoted value
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            values.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    values.push(current);
    return values;
}

// Fix encoding issues in text (convert from Latin-1/Windows-1252 to UTF-8)
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
        '�': 'é'
    };
    
    let fixed = text;
    for (const [wrong, correct] of Object.entries(replacements)) {
        fixed = fixed.replace(new RegExp(wrong, 'g'), correct);
    }
    
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
    
    console.log('CSV headers:', headers.slice(0, 15));
    
    // Find column indices
    let contractIndex = -1;
    let createdAtIndex = -1;
    let emailIndex = -1;
    let longResultIndex = -1;
    let agencyIndex = -1;
    
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        const headerLower = header.toLowerCase();
        
        // SubAffairDetailId → ContractNumber
        if (contractIndex === -1 && (headerLower.includes('contractnumber') || header.includes('SubAffairDetailId'))) {
            contractIndex = i;
            console.log(`Found ContractNumber at column ${i}: ${header}`);
        }
        
        // CreatedAt
        if (createdAtIndex === -1 && headerLower === 'createdat') {
            createdAtIndex = i;
            console.log(`Found CreatedAt at column ${i}: ${header}`);
        }
        
        // User → Email
        if (emailIndex === -1 && header.includes('User') && header.includes('Email')) {
            emailIndex = i;
            console.log(`Found Email at column ${i}: ${header}`);
        }
        
        // LongResult
        if (longResultIndex === -1 && headerLower === 'longresult') {
            longResultIndex = i;
            console.log(`Found LongResult at column ${i}: ${header}`);
        }
        
        // ProductionService (Agency)
        if (agencyIndex === -1 && headerLower.includes('productionservice')) {
            agencyIndex = i;
            console.log(`Found ProductionService at column ${i}: ${header}`);
        }
    }
    
    console.log('Column indices:', {
        contract: contractIndex,
        createdAt: createdAtIndex,
        email: emailIndex,
        longResult: longResultIndex
    });
    
    if (contractIndex === -1 || longResultIndex === -1) {
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
        
        const contractNumber = values[contractIndex] || '';
        const createdAt = createdAtIndex >= 0 ? values[createdAtIndex] : '';
        const email = emailIndex >= 0 ? values[emailIndex] : '';
        const longResult = longResultIndex >= 0 ? values[longResultIndex] : '';
        const agency = (agencyIndex >= 0 ? values[agencyIndex] : '') || '';
        
        // Extract agency code from contract number using the global function
        const agencyCode = extractAgency(contractNumber);
        
        // Extract max page from LongResult
        const maxPage = extractMaxPage(longResult);
        
        data.push({
            contractNumber: (contractNumber || '').trim(),
            createdAt: (createdAt || '').trim(),
            email: (email || '').trim(),
            agency: (agency || '').trim(),
            agencyCode: agencyCode,
            maxPage: maxPage
        });
    }
    
    console.log('Parsed', data.length, 'rows from CSV');
    
    // Debug: Check first few rows
    const samplesWithPages = data.filter(item => item.maxPage > 0).slice(0, 5);
    console.log('Sample rows with pages:', samplesWithPages);
    
    return data;
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
    let filtered = data;
    
    // Apply month filter (skip if in cumulative mode)
    if (!skipMonthFilter) {
        filtered = filterByMonth(filtered, filters.month);
    }

    // Apply DR filter
    filtered = filterByDR(filtered, filters.dr);

    // Apply agence filter
    filtered = filterByAgence(filtered, filters.agence);
    
    // Calculate KPIs
    const uniqueUsers = new Set();
    const uniqueOperations = new Set();
    let totalPages = 0;
    
    filtered.forEach(item => {
        if (item.email && item.email.trim() !== '') {
            uniqueUsers.add(item.email);
        }
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            uniqueOperations.add(item.contractNumber);
        }
        totalPages += item.maxPage || 0;
    });

    return {
        totalUsers: uniqueUsers.size,
        totalComparisons: filtered.length,
        totalPages: totalPages,
        totalOperations: uniqueOperations.size,
        filteredData: filtered
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
    const columns = ['dr', 'agency', 'comparisons', 'pages', 'operations', 'users', 'rate'];
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
function updateAgencyTable(data) {
    // Calculate stats by agency
    const agencyStats = {};
    
    data.forEach(item => {
        if (!item.agency) return;
        
        if (!agencyStats[item.agency]) {
            agencyStats[item.agency] = {
                comparisons: 0,
                pages: 0,
                operations: new Set(),
                users: new Set(),
                agencyCode: item.agencyCode
            };
        }
        
        agencyStats[item.agency].comparisons++;
        agencyStats[item.agency].pages += item.maxPage || 0;
        
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
            case 'comparisons':
                compareResult = agencyStats[a].comparisons - agencyStats[b].comparisons;
                break;
            case 'pages':
                compareResult = agencyStats[a].pages - agencyStats[b].pages;
                break;
            case 'operations':
                compareResult = agencyStats[a].operations.size - agencyStats[b].operations.size;
                break;
            case 'users':
                compareResult = agencyStats[a].users.size - agencyStats[b].users.size;
                break;
            case 'rate':
                const agencyCodeA = agencyStats[a].agencyCode;
                const agencyCodeB = agencyStats[b].agencyCode;
                const effectifA = agencyCodeA ? agencyPopulation[agencyCodeA] || 0 : 0;
                const effectifB = agencyCodeB ? agencyPopulation[agencyCodeB] || 0 : 0;
                const rateA = effectifA > 0 ? (agencyStats[a].users.size / effectifA) : 0;
                const rateB = effectifB > 0 ? (agencyStats[b].users.size / effectifB) : 0;
                compareResult = rateA - rateB;
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
        const comparisons = stats.comparisons;
        const pages = stats.pages;
        const operations = stats.operations.size;
        const users = stats.users.size;
        const effectif = agencyCode ? agencyPopulation[agencyCode] || 0 : 0;
        const dr = agencyCode ? agencyToDR[agencyCode] || '-' : '-';
        const tauxUtilisation = effectif > 0 ? ((users / effectif) * 100).toFixed(1) : '-';
        
        const row = document.createElement('tr');
        row.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${dr}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${agency}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${comparisons}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${pages}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${operations}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${users}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${effectif > 0 ? 'text-blue-600 font-semibold' : 'text-gray-500'}">
                ${effectif > 0 ? `${tauxUtilisation}%` : '-'}
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
    totalComparisonsEl.textContent = kpis.totalComparisons;
    totalPagesEl.textContent = kpis.totalPages;
    totalOperationsEl.textContent = kpis.totalOperations;
    
    // Update gains
    updateGains(kpis.totalPages);
    
    // Update first date display (only once with all data)
    const firstDate = getFirstDate(allData);
    if (firstDate) {
        firstDateTextEl.textContent = formatFirstDate(firstDate.toISOString());
    }
    
    updateAgencyTable(kpis.filteredData);
    updateSortIcons();
    
    // For chart: apply all filters except month (always show all months)
    const chartData = getChartData();
    updateChart(chartData);
}

// Get data for chart (filtered by DR and Agency, but not by month)
function getChartData() {
    let filtered = allData;
    
    // Apply DR filter
    filtered = filterByDR(filtered, filters.dr);
    
    // Apply agence filter
    filtered = filterByAgence(filtered, filters.agence);
    
    return filtered;
}

// Update chart
function updateChart(data) {
    const monthGroups = {};
    
    data.forEach((item) => {
        const date = parseDate(item.createdAt);
        if (!date) return;
        
        // Group by month (YYYY-MM)
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const monthKey = `${year}-${month}`;
        
        if (!monthGroups[monthKey]) {
            monthGroups[monthKey] = {
                comparisons: 0,
                pages: 0
            };
        }
        
        monthGroups[monthKey].comparisons++;
        monthGroups[monthKey].pages += item.maxPage || 0;
    });
    
    // Sort months
    const sortedMonths = Object.keys(monthGroups).sort();
    
    // Format month labels (e.g., "Jan 2024")
    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const formattedLabels = sortedMonths.map(monthKey => {
        const [year, month] = monthKey.split('-');
        const monthIndex = parseInt(month) - 1;
        return `${monthNames[monthIndex]} ${year}`;
    });
    
    const comparisonsData = sortedMonths.map((month) => monthGroups[month].comparisons);
    const pagesData = sortedMonths.map((month) => monthGroups[month].pages);
    
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
                    label: 'Nombre de comparaisons',
                    data: comparisonsData,
                    backgroundColor: 'rgba(59, 130, 246, 0.75)',
                    borderColor: 'rgba(37, 99, 235, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverBackgroundColor: 'rgba(59, 130, 246, 0.9)',
                    hoverBorderColor: 'rgba(29, 78, 216, 1)',
                    hoverBorderWidth: 3,
                    yAxisID: 'y'
                },
                {
                    label: 'Nombre de pages analysées',
                    data: pagesData,
                    backgroundColor: 'rgba(16, 185, 129, 0.75)',
                    borderColor: 'rgba(5, 150, 105, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverBackgroundColor: 'rgba(16, 185, 129, 0.9)',
                    hoverBorderColor: 'rgba(4, 120, 87, 1)',
                    hoverBorderWidth: 3,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2.5,
            interaction: {
                mode: 'index',
                intersect: false,
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
                    type: 'linear',
                    display: true,
                    position: 'left',
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(229, 231, 235, 0.8)',
                        lineWidth: 1
                    },
                    title: {
                        display: true,
                        text: 'Nombre de comparaisons',
                        font: {
                            size: 14,
                            weight: 'bold'
                        },
                        color: '#2563EB'
                    },
                    ticks: {
                        font: {
                            size: 12
                        },
                        color: '#2563EB',
                        precision: 0
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Nombre de pages',
                        font: {
                            size: 14,
                            weight: 'bold'
                        },
                        color: '#059669'
                    },
                    grid: {
                        drawOnChartArea: false,
                    },
                    ticks: {
                        font: {
                            size: 12
                        },
                        color: '#059669',
                        precision: 0
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
    inputSecondsEl.value = parameters.secondsPerPage;
    inputAnnualHoursEl.value = parameters.annualHours;
    inputRevenueEl.value = parameters.totalRevenue;
    settingsModal.classList.remove('hidden');
});

closeModalBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

saveSettingsBtn.addEventListener('click', () => {
    // Update parameters
    parameters.secondsPerPage = parseFloat(inputSecondsEl.value) || 20;
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
        const comparateurMatch = result.match(/COMPARATEUR_URL = '([^']+)'/);
        
        if (comparateurMatch) {
            return comparateurMatch[1];
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
        
        if (!csvData) {
            console.log('No CSV data found, trying raw text as CSV');
            csvData = rawText;
        }
        
        console.log('CSV data length:', csvData.length);
        console.log('First 500 chars of CSV:', csvData.substring(0, 500));
        
        allData = parseCSVData(csvData);
        
        if (allData.length === 0) {
            throw new Error('No data parsed from CSV');
        }

        // Debug: Check data
        const validDates = allData.filter(item => parseDate(item.createdAt) !== null);
        console.log('Total rows:', allData.length);
        console.log('Rows with valid dates:', validDates.length);
        
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

