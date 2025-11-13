// Configuration
const DESCRIPTIF_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/descriptif.json';
const AUTOCONTACT_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/autocontact.json';
const COMPARATEUR_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/comparateur.json';

// Constants
const DESCRIPTIF_TYPE = 'DESCRIPTIF_SOMMAIRE_DES_TRAVAUX';
const AUTOCONTACT_TYPE = 'AUTOCONTACT';

// Parameters for gains calculation (must match descriptif.js and autocontact.js)
const MINUTES_PER_DESCRIPTIF = 30;
const SECONDS_PER_CONTACT = 90; // Default value from autocontact.js
const SECONDS_PER_PAGE = 20; // Default value for comparateur
const ANNUAL_HOURS = 1607;
const TOTAL_REVENUE = 44000000;
const TOTAL_EFFECTIF = 192; // From population_cible.csv

// State
let descriptifData = [];
let autocontactData = [];
let comparateurData = [];

// DOM Elements
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const mainContentEl = document.getElementById('main-content');
const filialeFilterEl = document.getElementById('filiale-filter');
const resetFiltersBtn = document.getElementById('reset-filters');

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

// ==================== UTILITY FUNCTIONS ====================

/**
 * Helper function to parse a CSV line with quoted values
 */
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
    if (!dateString) return null;
    
    // Remove backslashes
    let cleanDate = dateString.replace(/\\/g, '');
    
    // Try standard parsing
    let date = new Date(cleanDate);
    
    // If that fails, try French format
    if (isNaN(date.getTime())) {
        const months = {
            'janvier': 0, 'février': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5,
            'juillet': 6, 'août': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11
        };
        
        const match = cleanDate.match(/(\d+)\s+(\w+),?\s+(\d{4})/);
        if (match) {
            const day = parseInt(match[1]);
            const monthName = match[2].toLowerCase();
            const year = parseInt(match[3]);
            
            if (months[monthName] !== undefined) {
                date = new Date(year, months[monthName], day);
            }
        }
    }
    
    if (isNaN(date.getTime())) {
        return null;
    }
    
    return date;
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
    
    const lines = csvString.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) return [];
    
    const headers = parseCSVLine(lines[0]);
    
    // Find column indices
    let typeIndex = -1;
    let contractIndex = -1;
    let diffusedAtIndex = -1;
    let emailIndex = -1;
    
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
    }
    
    if (typeIndex === -1 || contractIndex === -1) {
        return [];
    }
    
    // Parse data rows
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < headers.length / 2) continue;
        
        const type = values[typeIndex] || '';
        const contractNumber = values[contractIndex] || '';
        const diffusedAt = diffusedAtIndex >= 0 ? values[diffusedAtIndex] : '';
        const email = emailIndex >= 0 ? values[emailIndex] : '';
        const agency = extractAgency(contractNumber);
        
        data.push({
            type: type.trim(),
            contractNumber: contractNumber.trim(),
            createdAt: diffusedAt.trim(),
            email: email.trim(),
            agency: agency
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
        createdAt: createdAtIndex
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
        const agency = extractAgency(contractNumber);
        
        data.push({
            contractNumber: contractNumber.trim(),
            fromAI: fromAI,
            email: email.trim(),
            createdAt: createdAt.trim(),
            agency: agency
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
    let emailIndex = -1;
    let longResultIndex = -1;
    
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        const headerLower = header.toLowerCase();
        
        if (contractIndex === -1 && (headerLower.includes('contractnumber') || header.includes('SubAffairDetailId'))) {
            contractIndex = i;
        }
        if (emailIndex === -1 && header.includes('User') && header.includes('Email')) {
            emailIndex = i;
        }
        if (longResultIndex === -1 && headerLower === 'longresult') {
            longResultIndex = i;
        }
    }
    
    if (contractIndex === -1 || longResultIndex === -1) {
        return [];
    }
    
    // Parse data rows
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < headers.length / 2) continue;
        
        const contractNumber = values[contractIndex] || '';
        const email = emailIndex >= 0 ? values[emailIndex] : '';
        const longResult = values[longResultIndex] || '';
        const agency = extractAgency(contractNumber);
        const maxPage = extractMaxPage(longResult);
        
        data.push({
            contractNumber: contractNumber.trim(),
            email: email.trim(),
            agency: agency,
            maxPage: maxPage
        });
    }
    
    return data;
}

// ==================== DATA PROCESSING ====================

/**
 * Process descriptif data
 */
function processDescriptifData(data) {
    // Filter YIELD affairs
    const filtered = data.filter(item => 
        !item.contractNumber.toUpperCase().includes('YIELD')
    );
    
    // Total RICT = all filtered rows
    const totalRict = filtered.length;
    
    // Filter by type
    const descriptifFiltered = filtered.filter(item => 
        item.type === DESCRIPTIF_TYPE
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
    
    // Unique operations (contracts)
    const uniqueOperations = new Set();
    descriptifFiltered.forEach(item => {
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            uniqueOperations.add(item.contractNumber);
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
    // Filter YIELD affairs
    const filtered = data.filter(item => 
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
 * Process comparateur data
 */
function processComparateurData(data) {
    // Total comparisons
    const totalComparisons = data.length;
    
    // Unique users
    const uniqueUsers = new Set();
    data.forEach(item => {
        if (item.email && item.email.trim() !== '') {
            uniqueUsers.add(item.email);
        }
    });
    
    // Unique operations (contracts)
    const uniqueOperations = new Set();
    data.forEach(item => {
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            uniqueOperations.add(item.contractNumber);
        }
    });
    
    // Total pages analyzed
    let totalPages = 0;
    data.forEach(item => {
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
 * Calculate gains - MUST match the logic in descriptif.js, autocontact.js, and comparateur.js
 */
function calculateGains(descriptifCount, aiContactsCount, totalPages) {
    // Gain en temps pour descriptifs (minutes → heures)
    const timeGainMinutesDescriptif = descriptifCount * MINUTES_PER_DESCRIPTIF;
    const timeGainHoursDescriptif = timeGainMinutesDescriptif / 60;
    
    // Gain en temps pour autocontacts (secondes → heures)
    const timeGainSecondsAutocontact = aiContactsCount * SECONDS_PER_CONTACT;
    const timeGainHoursAutocontact = timeGainSecondsAutocontact / 3600;
    
    // Gain en temps pour comparateur (secondes → heures)
    const timeGainSecondsComparateur = totalPages * SECONDS_PER_PAGE;
    const timeGainHoursComparateur = timeGainSecondsComparateur / 3600;
    
    // Total time gain
    const totalTimeGain = timeGainHoursDescriptif + timeGainHoursAutocontact + timeGainHoursComparateur;
    
    // Gain en % volume d'affaire
    const percentGain = (totalTimeGain / (TOTAL_EFFECTIF * ANNUAL_HOURS)) * 100;
    
    // Gain en €
    const euroGain = (percentGain / 100) * TOTAL_REVENUE;
    
    return {
        timeGainHours: totalTimeGain,
        timeGainHoursDescriptif,
        timeGainHoursAutocontact,
        timeGainHoursComparateur,
        percentGain,
        euroGain
    };
}

/**
 * Format number with thousands separator
 */
function formatNumber(num) {
    return new Intl.NumberFormat('fr-FR').format(Math.round(num));
}

// ==================== UPDATE UI ====================

function updateKPIs() {
    const descriptifStats = processDescriptifData(descriptifData);
    const autocontactStats = processAutocontactData(autocontactData);
    const comparateurStats = processComparateurData(comparateurData);
    
    // Global stats
    const totalUtilisations = descriptifStats.totalUtilisations + autocontactStats.aiContacts + comparateurStats.totalComparisons;
    const allUsers = new Set();
    
    descriptifData.filter(item => item.type === DESCRIPTIF_TYPE).forEach(item => {
        if (item.email) allUsers.add(item.email);
    });
    // For autocontact: filter YIELD affairs first, then filter by FromAI
    autocontactData
        .filter(item => !item.contractNumber.toUpperCase().includes('YIELD'))
        .filter(item => item.fromAI)
        .forEach(item => {
            if (item.email && item.email.trim() !== '' && item.email.includes('@btp-consultants.fr')) {
                allUsers.add(item.email);
            }
        });
    comparateurData.forEach(item => {
        if (item.email) allUsers.add(item.email);
    });
    
    totalUtilisationsEl.textContent = formatNumber(totalUtilisations);
    totalUsersEl.textContent = allUsers.size;
    
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
    
    // Comparateur stats
    comparateurCountEl.textContent = formatNumber(comparateurStats.totalComparisons);
    comparateurOpsEl.textContent = formatNumber(comparateurStats.uniqueOperations);
    comparateurPagesEl.textContent = formatNumber(comparateurStats.totalPages);
    comparateurUsersEl.textContent = comparateurStats.uniqueUsers;
    
    // Calculate and display gains - USE SAME VALUES AS IN DETAIL PAGES
    // Descriptif page uses: totalOperations (unique operations)
    // Autocontact page uses: aiContacts (total AI contacts, not operations)
    // Comparateur page uses: totalPages
    const gains = calculateGains(descriptifStats.uniqueOperations, autocontactStats.aiContacts, comparateurStats.totalPages);
    
    gainHeuresEl.textContent = formatNumber(gains.timeGainHours);
    gainSubtitleEl.innerHTML = `
        <div class="space-y-1">
            <div>Heures économisées (Descriptif: ${formatNumber(gains.timeGainHoursDescriptif)}h + Auto: ${formatNumber(gains.timeGainHoursAutocontact)}h + Comp: ${formatNumber(gains.timeGainHoursComparateur)}h)</div>
            <div class="text-xs">≈ ${gains.percentGain.toFixed(4)}% du volume d'affaires</div>
            <div class="text-xs">≈ ${formatNumber(gains.euroGain)} €</div>
        </div>
    `;
}

// ==================== INITIALIZATION ====================

async function loadData() {
    try {
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');
        mainContentEl.classList.add('hidden');

        console.log('Loading descriptif data...');
        const descriptifResponse = await fetch(DESCRIPTIF_URL);
        if (!descriptifResponse.ok) {
            throw new Error(`Erreur lors du chargement de descriptif.json: ${descriptifResponse.status}`);
        }
        const descriptifRaw = await descriptifResponse.text();
        
        let descriptifCSV = null;
        try {
            const descriptifJson = JSON.parse(descriptifRaw);
            if (Array.isArray(descriptifJson) && descriptifJson[0] && descriptifJson[0].data) {
                descriptifCSV = descriptifJson[0].data;
            }
        } catch (e) {
            console.warn('Failed to parse descriptif JSON:', e);
        }
        
        if (descriptifCSV) {
            descriptifData = parseDescriptifCSV(descriptifCSV);
            console.log('Loaded', descriptifData.length, 'descriptif records');
        }

        console.log('Loading autocontact data...');
        const autocontactResponse = await fetch(AUTOCONTACT_URL);
        if (!autocontactResponse.ok) {
            throw new Error(`Erreur lors du chargement de autocontact.json: ${autocontactResponse.status}`);
        }
        const autocontactRaw = await autocontactResponse.text();
        
        let autocontactCSV = null;
        try {
            const autocontactJson = JSON.parse(autocontactRaw);
            if (Array.isArray(autocontactJson) && autocontactJson[0] && autocontactJson[0].data) {
                autocontactCSV = autocontactJson[0].data;
            }
        } catch (e) {
            console.warn('Failed to parse autocontact JSON:', e);
        }
        
        if (autocontactCSV) {
            autocontactData = parseAutocontactCSV(autocontactCSV);
            console.log('Loaded', autocontactData.length, 'autocontact records');
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
            if (Array.isArray(comparateurJson) && comparateurJson[0] && comparateurJson[0].data) {
                comparateurCSV = comparateurJson[0].data;
            }
        } catch (e) {
            console.warn('Failed to parse comparateur JSON:', e);
        }
        
        if (comparateurCSV) {
            comparateurData = parseComparateurCSV(comparateurCSV);
            console.log('Loaded', comparateurData.length, 'comparateur records');
        }

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

// ==================== FILIALE FILTERING ====================

// Map each feature card to its filiale
const featureCards = [
    { id: 'descriptif', filiale: 'BTP Consultants', element: null },
    { id: 'autocontact', filiale: 'BTP Consultants', element: null },
    { id: 'comparateur', filiale: 'BTP Consultants', element: null },
    { id: 'chat-projet-btp', filiale: 'BTP Consultants', element: null },
    { id: 'expert-tech-btp', filiale: 'BTP Consultants', element: null },
    { id: 'analyse-geo', filiale: 'BTP Consultants', element: null },
    { id: 'chat-projet-citae', filiale: 'Citae', element: null },
    { id: 'expert-tech-citae', filiale: 'Citae', element: null },
    { id: 'nf-habitat', filiale: 'Citae', element: null }
];

/**
 * Initialize feature card elements
 */
function initializeFeatureCards() {
    featureCards.forEach(card => {
        // Find the card element by looking for the count element's parent
        const countEl = document.getElementById(`${card.id}-count`);
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
 * Filter cards by filiale
 */
function filterCardsByFiliale(filiale) {
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
    const hasFilters = filialeFilterEl.value !== '';
    if (hasFilters) {
        resetFiltersBtn.classList.remove('hidden');
    } else {
        resetFiltersBtn.classList.add('hidden');
    }
}

// Event listeners
filialeFilterEl.addEventListener('change', (e) => {
    filterCardsByFiliale(e.target.value);
    updateResetButtonVisibility();
});

resetFiltersBtn.addEventListener('click', () => {
    filialeFilterEl.value = '';
    filterCardsByFiliale('');
    updateResetButtonVisibility();
});

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

// Start the application
loadData().then(() => {
    // Initialize feature cards after data is loaded
    initializeFeatureCards();
});
