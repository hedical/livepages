// Configuration
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordROI';

// URLs will be fetched from webhook after authentication
let DESCRIPTIF_URL = '';
let AUTOCONTACT_URL = '';
let COMPARATEUR_URL = '';
// Default Population URL (public)
const POPULATION_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/population_cible.csv';

// Constants
const DESCRIPTIF_TYPE = 'DESCRIPTIF_SOMMAIRE_DES_TRAVAUX';
const AUTOCONTACT_TYPE = 'AUTOCONTACT';

// Parameters for gains calculation (must match descriptif.js and autocontact.js)
const MINUTES_PER_DESCRIPTIF = 30;
const SECONDS_PER_CONTACT = 90; // Default value from autocontact.js
const SECONDS_PER_PAGE = 20; // Default value for comparateur
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
let agencyPopulation = {}; // {agencyCode: effectif}
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
            'janvier': 0, 'février': 1, 'fevrier': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5,
            'juillet': 6, 'août': 7, 'aout': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11, 'decembre': 11
        };
        
        // Match with optional time part: "DD Month, YYYY" or "DD Month, YYYY, HH:MM"
        const match = cleanDate.match(/(\d+)\s+([a-zàâäéèêëïôùûü]+)[,\s]+(\d{4})/i);
        if (match) {
            const day = parseInt(match[1]);
            const monthName = match[2].toLowerCase().trim();
            const year = parseInt(match[3]);
            
            if (months[monthName] !== undefined) {
                date = new Date(year, months[monthName], day);
                
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
    let agencyIndex = -1;
    let managementIndex = -1;
    
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
        if (managementIndex === -1 && header.includes('management')) {
            managementIndex = i;
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
        const agency = (agencyIndex >= 0 ? values[agencyIndex] : '') || '';
        const direction = (managementIndex >= 0 ? values[managementIndex] : '') || '';
        
        data.push({
            type: (type || '').trim(),
            contractNumber: (contractNumber || '').trim(),
            createdAt: (diffusedAt || '').trim(),
            email: (email || '').trim(),
            agency: (agency || '').trim(),
            direction: (direction || '').trim()
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
    let agencyIndex = -1;
    let managementIndex = -1;
    
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
        if (agencyIndex === -1 && headerLower.includes('productionservice')) {
            agencyIndex = i;
        }
        if (managementIndex === -1 && headerLower.includes('management')) {
            managementIndex = i;
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
        const agency = (agencyIndex >= 0 ? values[agencyIndex] : '') || '';
        const direction = (managementIndex >= 0 ? values[managementIndex] : '') || '';
        const maxPage = extractMaxPage(longResult);
        
        data.push({
            contractNumber: (contractNumber || '').trim(),
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
function parsePopulationData(csvString) {
    if (!csvString || typeof csvString !== 'string') return;
    
    console.log('=== Parsing Population Data ===');
    
    let csvText = fixEncoding(csvString);
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    
    if (lines.length < 2) {
        console.warn('Population CSV has less than 2 lines');
        return;
    }
    
    console.log('First line (header):', lines[0]);
    console.log('Total lines:', lines.length);
    
    // Reset population map
    agencyPopulation = {};
    let total = 0;
    
    // Skip header (line 0: DR;Agence;Effectif)
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(';');
        if (parts.length >= 3) {
            const dr = parts[0].trim();
            const agencyCode = parts[1].trim();
            const effectif = parseInt(parts[2].trim());
            
            if (agencyCode && !isNaN(effectif)) {
                agencyPopulation[agencyCode] = effectif;
                total += effectif;
            }
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
        // Filiale filter (based on email)
        if (filiale === 'BTP Consultants' && !item.email.includes('@btp-consultants.fr')) return false;
        if (filiale === 'Citae' && !item.email.includes('@citae.fr')) return false;
        
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
            descriptifCount: 0,
            descriptifPotential: 0,
            autocontactCount: 0,
            autocontactPotential: 0,
            comparateurCount: 0,
            comparateurPages: 0
        };
    });
    
    // Helper to aggregate stats
    const aggregate = (data, type) => {
        const filtered = getFilteredData(data);
        filtered.forEach(item => {
            const ag = item.agency;
            if (!ag || !agencyStats[ag]) return;
            
            const isBtpOrCitae = item.email && (item.email.includes('@btp-consultants.fr') || item.email.includes('@citae.fr'));
            
            if (type === 'descriptif' && !item.contractNumber.toUpperCase().includes('YIELD')) {
                agencyStats[ag].descriptifPotential++;
                if (item.type === DESCRIPTIF_TYPE) {
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
    
    // Calculate final metrics
    let rows = Object.values(agencyStats).map(stat => {
        // Try to get effectif directly
        let effectif = agencyPopulation[stat.agency] || 0;
        
        // Debug: show what we're trying to match
        if (effectif === 0) {
            console.log(`Looking for agency "${stat.agency}" in population map...`);
            console.log('Available keys in population:', Object.keys(agencyPopulation));
            
            // Fallback: try to find matching key (case-insensitive, trim whitespace)
            const cleanAgency = stat.agency.trim().toUpperCase();
            const matchingKey = Object.keys(agencyPopulation).find(k => 
                k.trim().toUpperCase() === cleanAgency
            );
            
            if (matchingKey) {
                effectif = agencyPopulation[matchingKey];
                console.log(`✓ Matched agency "${stat.agency}" to population key "${matchingKey}" (effectif: ${effectif})`);
            } else {
                console.warn(`✗ No match found for agency "${stat.agency}"`);
            }
        }
        
        // Adoption rates per tool
        const adoptionDescriptif = effectif > 0 ? (stat.usersDescriptif.size / effectif) * 100 : 0;
        const adoptionAutocontact = effectif > 0 ? (stat.usersAutocontact.size / effectif) * 100 : 0;
        const adoptionComparateur = effectif > 0 ? (stat.usersComparateur.size / effectif) * 100 : 0;
        
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
            descriptifCount: stat.descriptifCount,
            autocontactCount: stat.autocontactCount,
            comparateurCount: stat.comparateurCount,
            total: stat.descriptifCount + stat.autocontactCount + stat.comparateurCount
        };
    });
    
    // Sort
    rows.sort((a, b) => {
        const valA = a[tableSortState.column];
        const valB = b[tableSortState.column];
        
        if (typeof valA === 'string') {
            return tableSortState.ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return tableSortState.ascending ? valA - valB : valB - valA;
    });
    
    // Render
    agencyTableBodyEl.innerHTML = '';
    
    if (rows.length === 0) {
        agencyTableBodyEl.innerHTML = `
            <tr>
                <td colspan="6" class="px-6 py-4 text-center text-gray-500">
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
    ['agency', 'shortfall', 'descriptif', 'autocontact', 'comparateur', 'total'].forEach(col => {
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
    // For autocontact, use uniqueOperations (number of usages) instead of aiContacts (total contacts generated)
    const totalUtilisations = descriptifStats.totalUtilisations + autocontactStats.uniqueOperations + comparateurStats.totalComparisons;
    const allUsers = new Set();
    
    getFilteredData(descriptifData).filter(item => item.type === DESCRIPTIF_TYPE).forEach(item => {
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
        
        // Parse the response to extract URLs
        const descriptifMatch = result.match(/DESCRIPTIF_URL = '([^']+)'/);
        const autocontactMatch = result.match(/AUTOCONTACT_URL = '([^']+)'/);
        const comparateurMatch = result.match(/COMPARATEUR_URL = '([^']+)'/);
        
        if (descriptifMatch && autocontactMatch && comparateurMatch) {
            DESCRIPTIF_URL = descriptifMatch[1];
            AUTOCONTACT_URL = autocontactMatch[1];
            COMPARATEUR_URL = comparateurMatch[1];
            
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

        // Initialize filters and table
        extractDirectionsAndAgencies();
        populateFilters();

        // Update Dashboard (KPIs + Table)
        updateDashboard();

        // Initialize feature cards after data is loaded
        initializeFeatureCards();

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
 * Update Dashboard
 */
function updateDashboard() {
    // Update KPIs (calls process...Data which uses getFilteredData)
    updateKPIs();
    
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
