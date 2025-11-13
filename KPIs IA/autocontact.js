// Configuration
const DATA_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/autocontact.json';
const POPULATION_CSV_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/population_cible.csv';

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
    secondsPerContact: 90,
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
const totalContactsEl = document.getElementById('total-contacts');
const aiContactsEl = document.getElementById('ai-contacts');
const aiContactsPercentEl = document.getElementById('ai-contacts-percent');
const totalOperationsEl = document.getElementById('total-operations');

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
function parseNumber(value) {
    if (typeof value === 'number') {
        return isNaN(value) ? 0 : value;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '-' || trimmed === '' || trimmed === 'null' || trimmed === 'undefined') {
            return 0;
        }
        const parsed = parseFloat(trimmed);
        return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
}

function parseDate(dateString) {
    if (!dateString) return null;
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
        return date;
    }
    return null;
}

// Extract agency code from ContractNumber
// Example: C-CT78-2022-20-157875 → CT78
function extractAgency(contractNumber) {
    if (!contractNumber || typeof contractNumber !== 'string') {
        return null;
    }
    
    // Pattern: C-AGENCY-YEAR-...
    const match = contractNumber.match(/^C-([^-]+)-/);
    if (match && match[1]) {
        return match[1].trim();
    }
    
    return null;
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

// Helper function to parse a CSV line with quoted values
function parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
        const char = line[j];
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

// Load parameters from localStorage
function loadParameters() {
    const saved = localStorage.getItem('autocontact_parameters');
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
    localStorage.setItem('autocontact_parameters', JSON.stringify(parameters));
}

// Calculate total effectif from agency population
function getTotalEffectif() {
    return Object.values(agencyPopulation).reduce((sum, val) => sum + val, 0);
}

// Format number with thousands separator
function formatNumber(num) {
    return new Intl.NumberFormat('fr-FR').format(Math.round(num));
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
function calculateGains(aiContactsCount) {
    // 1. Gain en temps (secondes → heures)
    const timeGainSeconds = aiContactsCount * parameters.secondsPerContact;
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
function updateGains(aiContactsCount, totalContactsCount) {
    const gains = calculateGains(aiContactsCount);
    const maxGains = calculateGains(totalContactsCount);
    
    // Calculate projection for the year
    const periodMonths = calculatePeriodMonths();
    const projectionMultiplier = 12 / periodMonths;
    const projectedContacts = aiContactsCount * projectionMultiplier;
    const projectionGains = calculateGains(projectedContacts);
    
    // Calculate max projection for the year
    const projectedMaxContacts = totalContactsCount * projectionMultiplier;
    const maxProjectionGains = calculateGains(projectedMaxContacts);
    
    // Update time gain
    gainTimeEl.textContent = formatHours(gains.timeGainHours);
    gainTimeFormulaEl.textContent = `${formatNumber(aiContactsCount)} contacts × ${parameters.secondsPerContact}s`;
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
    
    // Clean up CSV string - remove JSON artifacts
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
        console.warn('No lines found in CSV');
        return [];
    }
    
    // Parse header
    const headerLine = lines[0];
    const headers = parseCSVLine(headerLine);
    
    console.log(`CSV has ${headers.length} columns and ${lines.length - 1} data rows`);
    
    // Find required column indices
    let btpEmailColumnIndex = -1;
    let contractColumnIndex = -1;
    let createdAtColumnIndex = -1;
    let fromAIColumnIndex = -1;
    
    // Search for columns in headers
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toLowerCase();
        
        if (contractColumnIndex === -1 && header.includes('contractnumber')) {
            contractColumnIndex = i;
            console.log(`Found ContractNumber at column ${i}: ${headers[i]}`);
        }
        
        if (createdAtColumnIndex === -1 && header === 'createdat' && !headers[i].includes('→')) {
            createdAtColumnIndex = i;
            console.log(`Found CreatedAt at column ${i}: ${headers[i]}`);
        }
        
        if (fromAIColumnIndex === -1 && header === 'fromai') {
            fromAIColumnIndex = i;
            console.log(`Found FromAI at column ${i}: ${headers[i]}`);
        }
        
        if (btpEmailColumnIndex === -1 && header.includes('user') && header.includes('email')) {
            btpEmailColumnIndex = i;
            console.log(`Found BTP User Email at column ${i}: ${headers[i]}`);
        }
    }
    
    // Search for BTP email column by examining data rows
    if (btpEmailColumnIndex === -1) {
        for (let rowIdx = 1; rowIdx < Math.min(10, lines.length); rowIdx++) {
            const values = parseCSVLine(lines[rowIdx]);
            for (let colIdx = 0; colIdx < values.length; colIdx++) {
                const val = values[colIdx];
                if (val && val.includes('@btp-consultants.fr')) {
                    btpEmailColumnIndex = colIdx;
                    console.log(`Found BTP email column at index ${colIdx} by examining data`);
                    break;
                }
            }
            if (btpEmailColumnIndex !== -1) break;
        }
    }
    
    // Validate required columns
    if (contractColumnIndex === -1 || createdAtColumnIndex === -1 || btpEmailColumnIndex === -1) {
        console.error('Missing required columns:');
        console.error('- ContractNumber:', contractColumnIndex);
        console.error('- CreatedAt:', createdAtColumnIndex);
        console.error('- BTP Email:', btpEmailColumnIndex);
        return [];
    }
    
    console.log('Using columns:', {
        btpEmail: btpEmailColumnIndex,
        contract: contractColumnIndex,
        createdAt: createdAtColumnIndex,
        fromAI: fromAIColumnIndex
    });
    
    // Parse data rows
    const parsedData = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const values = parseCSVLine(line);
        
        if (values.length <= Math.max(contractColumnIndex, createdAtColumnIndex, btpEmailColumnIndex)) {
            continue;
        }
        
        const contractNumber = values[contractColumnIndex] || '';
        const createdAt = values[createdAtColumnIndex] || '';
        const btpEmail = values[btpEmailColumnIndex] || '';
        
        // Extract agency from contract number
        const agency = extractAgency(contractNumber);
        
        // Determine FromAI value
        let fromAI = false;
        if (fromAIColumnIndex !== -1 && values.length > fromAIColumnIndex) {
            const fromAIValue = (values[fromAIColumnIndex] || '').toLowerCase().trim();
            fromAI = fromAIValue === 'true' || fromAIValue === '1' || fromAIValue === 'yes';
        }
        
        parsedData.push({
            contractNumber: contractNumber.trim(),
            createdAt: createdAt.trim(),
            email: btpEmail.trim(),
            fromAI: fromAI,
            agency: agency,
            contactCount: 1,
            aiContactCount: fromAI ? 1 : 0
        });
    }
    
    console.log(`Parsed ${parsedData.length} contacts`);
    if (parsedData.length > 0) {
        console.log('Sample data:', parsedData[0]);
    }
    
    return parsedData;
}

// Filter functions
function filterYieldAffairs(data) {
    return data.filter((item) => {
        const contractNumber = item.contractNumber;
        if (!contractNumber || typeof contractNumber !== 'string' || contractNumber.trim() === '') {
            return true;
        }
        return !contractNumber.toUpperCase().includes('YIELD');
    });
}

function filterByMonth(data, month) {
    if (!month) return data;
    
    return data.filter((item) => {
        const date = parseDate(item.createdAt);
        if (!date) return false;
        
        const year = date.getFullYear();
        const monthNum = String(date.getMonth() + 1).padStart(2, '0');
        const dateMonth = `${year}-${monthNum}`;
        
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
        if (!item.agency) return false;
        const itemDR = agencyToDR[item.agency];
        return itemDR === dr;
    });
}

// Process data and calculate KPIs
function processData(data, filters, skipMonthFilter = false) {
    // Filter out YIELD affairs
    let filtered = filterYieldAffairs(data);

    // Apply month filter (skip if in cumulative mode)
    if (!skipMonthFilter) {
        filtered = filterByMonth(filtered, filters.month);
    }

    // Apply DR filter
    filtered = filterByDR(filtered, filters.dr);

    // Apply agence filter
    filtered = filterByAgence(filtered, filters.agence);

    // Calculate KPIs  
    const aiRows = filtered.filter(item => item.fromAI === true);
    
    const usersWithAI = new Set();
    aiRows.forEach(item => {
        if (item.email && item.email.includes('@btp-consultants.fr')) {
            usersWithAI.add(item.email);
        }
    });
    
    let totalContacts = filtered.length;
    let aiContacts = aiRows.length;
    
    const operationsWithAI = new Set();
    aiRows.forEach(item => {
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            operationsWithAI.add(item.contractNumber);
        }
    });
    
    console.log('KPI Calculation:');
    console.log('- Total rows (excl YIELD):', totalContacts);
    console.log('- AI rows (FromAI=true):', aiContacts);
    console.log('- Unique BTP emails with AI:', usersWithAI.size);
    console.log('- Unique operations with AI:', operationsWithAI.size);
    
    return {
        totalUsers: usersWithAI.size,
        totalContacts: totalContacts,
        aiContacts: aiContacts,
        totalOperations: operationsWithAI.size,
        filteredData: filtered
    };
}

// Get available agencies
function getAvailableAgencies(data) {
    const agencies = new Set();
    data.forEach((item) => {
        if (item.agency && item.agency.trim() !== '') {
            agencies.add(item.agency);
        }
    });
    return Array.from(agencies).sort();
}

// Get available DRs
function getAvailableDRs(data) {
    const drs = new Set();
    data.forEach((item) => {
        if (item.agency && agencyToDR[item.agency]) {
            drs.add(agencyToDR[item.agency]);
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
    const columns = ['dr', 'agency', 'aiContacts', 'operations', 'users', 'rate'];
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
                aiContacts: 0,
                operations: new Set(),
                users: new Set()
            };
        }
        
        // Count AI contacts
        if (item.fromAI === true) {
            agencyStats[item.agency].aiContacts++;
            
            // Add user email (only for AI contacts)
            if (item.email && item.email.includes('@btp-consultants.fr')) {
                agencyStats[item.agency].users.add(item.email);
            }
            
            // Add operation (contract number)
            if (item.contractNumber && item.contractNumber.trim() !== '') {
                agencyStats[item.agency].operations.add(item.contractNumber);
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
                const drA = agencyToDR[a] || '';
                const drB = agencyToDR[b] || '';
                compareResult = drA.localeCompare(drB);
                break;
            case 'agency':
                compareResult = a.localeCompare(b);
                break;
            case 'aiContacts':
                compareResult = agencyStats[a].aiContacts - agencyStats[b].aiContacts;
                break;
            case 'operations':
                compareResult = agencyStats[a].operations.size - agencyStats[b].operations.size;
                break;
            case 'users':
                compareResult = agencyStats[a].users.size - agencyStats[b].users.size;
                break;
            case 'rate':
                const effectifA = agencyPopulation[a] || 0;
                const effectifB = agencyPopulation[b] || 0;
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
            <td colspan="6" class="px-6 py-4 text-center text-gray-500">
                Aucune donnée disponible pour cette période
            </td>
        `;
        agencyTableBodyEl.appendChild(row);
        return;
    }
    
    sortedAgencies.forEach((agency, index) => {
        const stats = agencyStats[agency];
        const aiContacts = stats.aiContacts;
        const operations = stats.operations.size;
        const users = stats.users.size;
        const effectif = agencyPopulation[agency] || 0;
        const dr = agencyToDR[agency] || '-';
        const tauxUtilisation = effectif > 0 ? ((users / effectif) * 100).toFixed(1) : '-';
        
        const row = document.createElement('tr');
        row.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${dr}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${agency}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${aiContacts}</td>
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
    totalContactsEl.textContent = kpis.totalContacts;
    aiContactsEl.textContent = kpis.aiContacts;
    totalOperationsEl.textContent = kpis.totalOperations;
    
    // Calculate and display AI contacts percentage
    if (kpis.totalContacts > 0) {
        const percentage = ((kpis.aiContacts / kpis.totalContacts) * 100).toFixed(1);
        aiContactsPercentEl.textContent = `(${percentage}%)`;
    } else {
        aiContactsPercentEl.textContent = '(-)';
    }
    
    // Update gains
    updateGains(kpis.aiContacts, kpis.totalContacts);
    
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
    let filtered = filterYieldAffairs(allData);
    
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
                fromAI: 0,
                notFromAI: 0
            };
        }
        
        if (item.fromAI === true) {
            monthGroups[monthKey].fromAI += 1;
        } else {
            monthGroups[monthKey].notFromAI += 1;
        }
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
    
    const fromAIData = sortedMonths.map((month) => monthGroups[month].fromAI);
    const notFromAIData = sortedMonths.map((month) => monthGroups[month].notFromAI);
    
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
                    label: 'Contacts IA (FromAI = true)',
                    data: fromAIData,
                    backgroundColor: 'rgba(59, 130, 246, 0.75)',
                    borderColor: 'rgba(37, 99, 235, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverBackgroundColor: 'rgba(59, 130, 246, 0.9)',
                    hoverBorderColor: 'rgba(29, 78, 216, 1)',
                    hoverBorderWidth: 3
                },
                {
                    label: 'Contacts Non-IA (FromAI = false)',
                    data: notFromAIData,
                    backgroundColor: 'rgba(156, 163, 175, 0.6)',
                    borderColor: 'rgba(107, 114, 128, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverBackgroundColor: 'rgba(156, 163, 175, 0.8)',
                    hoverBorderColor: 'rgba(75, 85, 99, 1)',
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
                        text: 'Nombre de contacts',
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
                            label += ' contact' + (context.parsed.y > 1 ? 's' : '');
                            return label;
                        },
                        afterBody: function(context) {
                            if (context.length >= 2) {
                                const total = context[0].parsed.y + context[1].parsed.y;
                                const aiCount = context[0].parsed.y;
                                const percentage = total > 0 ? ((aiCount / total) * 100).toFixed(1) : 0;
                                return [
                                    '',
                                    'Total : ' + formatNumber(total) + ' contacts',
                                    'Taux IA : ' + percentage + '%'
                                ];
                            }
                            return [];
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
    inputSecondsEl.value = parameters.secondsPerContact;
    inputAnnualHoursEl.value = parameters.annualHours;
    inputRevenueEl.value = parameters.totalRevenue;
    settingsModal.classList.remove('hidden');
});

closeModalBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

cancelSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

saveSettingsBtn.addEventListener('click', () => {
    // Update parameters
    parameters.secondsPerContact = parseFloat(inputSecondsEl.value) || 90;
    parameters.annualHours = parseFloat(inputAnnualHoursEl.value) || 1607;
    parameters.totalRevenue = parseFloat(inputRevenueEl.value) || 44000000;
    
    // Save to localStorage
    saveParameters();
    
    // Close modal
    settingsModal.classList.add('hidden');
    
    // Recalculate gains
    updateKPIs();
});

// Close modal on background click
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.classList.add('hidden');
    }
});

// Initialize
async function init() {
    try {
        // Load saved parameters
        loadParameters();
        
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');
        mainContentEl.classList.add('hidden');

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
        
        // Parse JSON array format: [{"data":"CSV content"}]
        let csvData = null;
        
        try {
            const jsonData = JSON.parse(rawText);
            
            if (Array.isArray(jsonData) && jsonData.length > 0 && jsonData[0].data) {
                console.log('Found JSON array with data field in first element');
                csvData = jsonData[0].data;
            } else if (jsonData.data && typeof jsonData.data === 'string') {
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
        console.log('First 200 chars of CSV:', csvData.substring(0, 200));
        
        allData = parseCSVData(csvData);
        
        if (allData.length === 0) {
            throw new Error('No data parsed from CSV');
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
        const errorMessage = errorEl.querySelector('p');
        if (errorMessage) {
            errorMessage.textContent = `Erreur: ${error.message}`;
        }
    }
}

// Start app
init();
