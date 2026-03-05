// Configuration
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordROI';

// URLs will be fetched from webhook after authentication
let DESCRIPTIF_URL = '';
let AUTOCONTACT_URL = '';
let COMPARATEUR_URL = '';
// Expert BTP Consultants URL (public)
const EXPERT_BTP_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_btpconsultants_ct.json';
// Chat BTP Consultants URL (public)
const CHAT_BTP_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_btpconsultants_ct.json';
// Expert Citae URL (public)
const EXPERT_CITAE_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_citae.json';
// Chat Citae URL (public)
const CHAT_CITAE_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_citae.json';
// Expert BTP Diagnostics URL (public)
const EXPERT_BTPDIAG_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_btpdiagnostics.json';
// Chat BTP Diagnostics URL (public)
const CHAT_BTPDIAG_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_btpdiagnostics.json';
// Default Population URL (public)
const POPULATION_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/population_cible.csv';

// Constants
const DESCRIPTIF_TYPE = 'DESCRIPTIF_SOMMAIRE_DES_TRAVAUX';
const AUTOCONTACT_TYPE = 'AUTOCONTACT';

// Parameters for gains calculation (must match descriptif.js and autocontact.js)
const MINUTES_PER_DESCRIPTIF = 30;
const SECONDS_PER_CONTACT = 90; // Default value from autocontact.js
const SECONDS_PER_PAGE = 20; // Default value for comparateur
const MINUTES_PER_MESSAGE = 2.8125; // For chat tools (BTP and Citae)
const MINUTES_PER_MESSAGE_EXPERT = 5; // For expert technique tools (BTP and Citae)
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

// ==================== UTILITY FUNCTIONS ====================

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
    let descriptionIndex = -1;
    let aiResultIndex = -1;
    
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
        if (descriptionIndex === -1 && header.includes('description') && !header.includes('complement')) {
            descriptionIndex = i;
        }
        if (aiResultIndex === -1 && (header.includes('longresult') || header.includes('result'))) {
            aiResultIndex = i;
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
        const description = descriptionIndex >= 0 ? values[descriptionIndex] : '';
        const aiResult = aiResultIndex >= 0 ? values[aiResultIndex] : '';
        
        data.push({
            type: (type || '').trim(),
            contractNumber: (contractNumber || '').trim(),
            createdAt: (diffusedAt || '').trim(),
            email: (email || '').trim(),
            agency: (agency || '').trim(),
            direction: (direction || '').trim(),
            description: description,
            aiResult: aiResult
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
    
    // Unique operations (contracts) - exclure les RICT avec moins de 100 mots
    const uniqueOperations = new Set();
    descriptifFiltered.forEach(item => {
        if (item.contractNumber && item.contractNumber.trim() !== '') {
            // Compter les mots dans le résultat de l'IA
            const processedAI = extractText(item.aiResult || '');
            const wordCount = countWords(processedAI);
            
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
 * Calculate gains - MUST match the logic in descriptif.js, autocontact.js, comparateur.js, chat and expert pages
 */
function calculateGains(descriptifCount, aiContactsCount, totalPages, chatBTPMessages, expertBTPMessages, chatCitaeMessages, expertCitaeMessages, chatBTPDiagMessages, expertBTPDiagMessages) {
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
    
    // Total time gain
    const totalTimeGain = timeGainHoursDescriptif + timeGainHoursAutocontact + timeGainHoursComparateur 
        + timeGainHoursChatBTP + timeGainHoursExpertBTP + timeGainHoursChatCitae + timeGainHoursExpertCitae
        + timeGainHoursChatBTPDiag + timeGainHoursExpertBTPDiag;
    
    // Gain en % volume d'affaire
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

function updateKPIs() {
    const descriptifStats = processDescriptifData(descriptifData);
    const autocontactStats = processAutocontactData(autocontactData);
    const comparateurStats = processComparateurData(comparateurData);
    const expertBTPStats = processExpertBTPData(expertBTPData);
    const chatBTPStats = processChatBTPData(chatBTPData);
    const expertCitaeStats = processExpertCitaeData(expertCitaeData);
    const chatCitaeStats = processChatCitaeData(chatCitaeData);
    const expertBTPDiagStats = processExpertBTPDiagData(expertBTPDiagData);
    const chatBTPDiagStats = processChatBTPDiagData(chatBTPDiagData);
    
    // Global stats
    // For autocontact, use uniqueOperations (number of usages) instead of aiContacts (total contacts generated)
    const totalUtilisations = descriptifStats.totalUtilisations + autocontactStats.uniqueOperations + comparateurStats.totalComparisons + expertBTPStats.totalSessions + chatBTPStats.totalSessions + expertCitaeStats.totalSessions + chatCitaeStats.totalSessions + expertBTPDiagStats.totalSessions + chatBTPDiagStats.totalSessions;
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
    
    // Calculate and display gains - USE SAME VALUES AS IN DETAIL PAGES
    // Descriptif page uses: totalOperations (unique operations)
    // Autocontact page uses: aiContacts (total AI contacts, not operations)
    // Comparateur page uses: totalPages
    // Chat and Expert pages use: totalMessages
    const gains = calculateGains(
        descriptifStats.uniqueOperations, 
        autocontactStats.aiContacts, 
        comparateurStats.totalPages,
        chatBTPStats.totalMessages,
        expertBTPStats.totalMessages,
        chatCitaeStats.totalMessages,
        expertCitaeStats.totalMessages,
        chatBTPDiagStats.totalMessages,
        expertBTPDiagStats.totalMessages
    );
    
    gainHeuresEl.textContent = formatNumber(gains.timeGainHours);
    gainSubtitleEl.innerHTML = `
        <div class="space-y-1">
            <div>Heures économisées (Descriptif: ${formatNumber(gains.timeGainHoursDescriptif)}h + Auto: ${formatNumber(gains.timeGainHoursAutocontact)}h + Comp: ${formatNumber(gains.timeGainHoursComparateur)}h + Chat BTP: ${formatNumber(gains.timeGainHoursChatBTP)}h + Expert BTP: ${formatNumber(gains.timeGainHoursExpertBTP)}h + Chat Citae: ${formatNumber(gains.timeGainHoursChatCitae)}h + Expert Citae: ${formatNumber(gains.timeGainHoursExpertCitae)}h + Chat Diag: ${formatNumber(gains.timeGainHoursChatBTPDiag)}h + Expert Diag: ${formatNumber(gains.timeGainHoursExpertBTPDiag)}h)</div>
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
                        email: item.email || '',
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
                        email: item.email || '',
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
                        email: item.email || '',
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
                        email: item.email || '',
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
                            email: item.email || '',
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
                            email: item.email || '',
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
    { id: 'nf-habitat', filiale: 'Citae', element: null },
    { id: 'chat-projet-btpdiag', filiale: 'BTP Diagnostics', element: null },
    { id: 'expert-tech-btpdiag', filiale: 'BTP Diagnostics', element: null }
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

// ==================== GAIN EVOLUTION MODAL ====================

// ==================== USERS LIST MODAL ====================

/**
 * Collect all unique active users from every data source.
 * Returns [{email, filiale, features: Set, sessions, lastActivity}]
 */
function collectActiveUsers() {
    const usersMap = new Map(); // email → {filiale, features: Set, sessions, lastActivity}

    const FEATURE_LABELS = {
        descriptif:   'Descriptif',
        autocontact:  'Auto-contact',
        comparateur:  'Comparateur',
        expertBTP:    'Expert (BTP)',
        chatBTP:      'Chat (BTP)',
        expertCitae:  'Expert (Citae)',
        chatCitae:    'Chat (Citae)',
        expertDiag:   'Expert (Diag)',
        chatDiag:     'Chat (Diag)',
    };

    const upsert = (email, filiale, featureKey, dateString) => {
        if (!email || !email.trim()) return;
        const key = email.toLowerCase().trim();
        if (!usersMap.has(key)) {
            usersMap.set(key, { email: key, filiale, features: new Set(), sessions: 0, lastActivity: null });
        }
        const u = usersMap.get(key);
        u.features.add(FEATURE_LABELS[featureKey]);
        u.sessions += 1;
        const d = parseFrenchDate(dateString);
        if (d && (!u.lastActivity || d > u.lastActivity)) u.lastActivity = d;
    };

    const getDomainFiliale = (email) => {
        if (!email) return 'Autre';
        if (email.includes('@btp-consultants.fr')) return 'BTP Consultants';
        if (email.includes('@citae.fr')) return 'Citae';
        if (email.includes('@btp-diagnostics.fr')) return 'BTP Diagnostics';
        return 'Autre';
    };

    // Descriptif
    descriptifData
        .filter(item => item.type === DESCRIPTIF_TYPE && !item.contractNumber.toUpperCase().includes('YIELD'))
        .forEach(item => upsert(item.email, getDomainFiliale(item.email), 'descriptif', item.createdAt));

    // Autocontact (@btp-consultants.fr, fromAI, pas YIELD)
    autocontactData
        .filter(item => !item.contractNumber.toUpperCase().includes('YIELD') && item.fromAI && item.email && item.email.includes('@btp-consultants.fr'))
        .forEach(item => upsert(item.email, 'BTP Consultants', 'autocontact', item.createdAt));

    // Comparateur
    comparateurData.forEach(item =>
        upsert(item.email, getDomainFiliale(item.email), 'comparateur', item.createdAt));

    // Expert / Chat BTP Consultants
    expertBTPData.filter(item => item.email && item.email.includes('@btp-consultants.fr'))
        .forEach(item => upsert(item.email, 'BTP Consultants', 'expertBTP', item.createdAt));
    chatBTPData.filter(item => item.email && item.email.includes('@btp-consultants.fr'))
        .forEach(item => upsert(item.email, 'BTP Consultants', 'chatBTP', item.createdAt));

    // Expert / Chat Citae
    expertCitaeData.filter(item => item.email && item.email.includes('@citae.fr'))
        .forEach(item => upsert(item.email, 'Citae', 'expertCitae', item.createdAt));
    chatCitaeData.filter(item => item.email && item.email.includes('@citae.fr'))
        .forEach(item => upsert(item.email, 'Citae', 'chatCitae', item.createdAt));

    // Expert / Chat BTP Diagnostics
    expertBTPDiagData.filter(item => item.email && item.email.includes('@btp-diagnostics.fr'))
        .forEach(item => upsert(item.email, 'BTP Diagnostics', 'expertDiag', item.createdAt));
    chatBTPDiagData.filter(item => item.email && item.email.includes('@btp-diagnostics.fr'))
        .forEach(item => upsert(item.email, 'BTP Diagnostics', 'chatDiag', item.createdAt));

    return Array.from(usersMap.values())
        .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
}

const FILIALE_BADGE = {
    'BTP Consultants': 'bg-blue-100 text-blue-800',
    'Citae':           'bg-green-100 text-green-800',
    'BTP Diagnostics': 'bg-orange-100 text-orange-800',
    'Autre':           'bg-gray-100 text-gray-600',
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

function renderActiveUsersTab(search = '', filiale = '') {
    const tbody = document.getElementById('active-users-table-body');
    const countLabel = document.getElementById('active-users-count-label');
    if (!tbody) return;

    if (!activeUsersCache) activeUsersCache = collectActiveUsers();

    const fmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const searchLow = search.toLowerCase().trim();

    const filtered = activeUsersCache.filter(u => {
        if (searchLow && !u.email.includes(searchLow)) return false;
        if (filiale && u.filiale !== filiale) return false;
        return true;
    });

    document.getElementById('tab-active-count').textContent = activeUsersCache.length + ' utilisateurs';

    tbody.innerHTML = filtered.map(u => {
        const badgeClass = FILIALE_BADGE[u.filiale] || FILIALE_BADGE['Autre'];
        const features = Array.from(u.features).join(', ') || '—';
        const lastDate = u.lastActivity ? fmt.format(u.lastActivity) : '—';
        return `<tr class="hover:bg-indigo-50/30 transition-colors">
            <td class="px-4 py-2.5 font-medium text-gray-800">${u.email}</td>
            <td class="px-4 py-2.5">
                <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${badgeClass}">${u.filiale}</span>
            </td>
            <td class="px-4 py-2.5 text-gray-600 text-xs">${features}</td>
            <td class="px-4 py-2.5 text-right text-gray-700">${u.sessions}</td>
            <td class="px-4 py-2.5 text-right text-gray-500">${lastDate}</td>
        </tr>`;
    }).join('');

    if (countLabel) {
        countLabel.textContent = filtered.length < activeUsersCache.length
            ? `${filtered.length} utilisateur(s) affiché(s) sur ${activeUsersCache.length}`
            : `${filtered.length} utilisateur(s) au total`;
    }
}

function switchUsersListTab(tab) {
    currentUsersTab = tab;
    const tabPop    = document.getElementById('tab-population');
    const tabActive = document.getElementById('tab-active-users');
    const panelPop    = document.getElementById('panel-population');
    const panelActive = document.getElementById('panel-active-users');

    if (tab === 'population') {
        tabPop.className    = 'px-4 py-3 text-sm font-medium border-b-2 border-indigo-600 text-indigo-600 transition-colors';
        tabActive.className = 'px-4 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 transition-colors ml-2';
        panelPop.classList.remove('hidden');
        panelActive.classList.add('hidden');
        document.getElementById('users-list-subtitle').textContent = 'Collaborateurs BTP Consultants (population cible)';
    } else {
        tabActive.className = 'px-4 py-3 text-sm font-medium border-b-2 border-indigo-600 text-indigo-600 transition-colors ml-2';
        tabPop.className    = 'px-4 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 transition-colors';
        panelPop.classList.add('hidden');
        panelActive.classList.remove('hidden');
        document.getElementById('users-list-subtitle').textContent = 'Tous les utilisateurs ayant utilisé au moins une fonctionnalité';
        renderActiveUsersTab(
            document.getElementById('users-list-search').value,
            document.getElementById('users-list-filiale').value
        );
    }
}

function openUsersListModal() {
    activeUsersCache = null; // always refresh on open
    document.getElementById('users-list-modal').classList.remove('hidden');
    renderPopulationTab();
    switchUsersListTab('population');
}

function closeUsersListModal() {
    document.getElementById('users-list-modal').classList.add('hidden');
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

    const search  = document.getElementById('users-list-search');
    const filiale = document.getElementById('users-list-filiale');
    const refresh = () => renderActiveUsersTab(search.value, filiale.value);
    if (search)  search.addEventListener('input', refresh);
    if (filiale) filiale.addEventListener('change', refresh);
})();

// ==================== USERS EVOLUTION MODAL ====================

let usersEvolutionChart = null;
let usersModalIsCumulative = false;
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
    descriptifData
        .filter(item => item.type === DESCRIPTIF_TYPE && !item.contractNumber.toUpperCase().includes('YIELD'))
        .forEach(item => addUser(item.createdAt, item.email));

    // Autocontact (@btp-consultants.fr, pas de YIELD, fromAI)
    autocontactData
        .filter(item => !item.contractNumber.toUpperCase().includes('YIELD') && item.fromAI)
        .forEach(item => addUser(item.createdAt, item.email, '@btp-consultants.fr'));

    // Comparateur
    comparateurData.forEach(item => addUser(item.createdAt, item.email));

    // Expert / Chat BTP Consultants
    expertBTPData.forEach(item => addUser(item.createdAt, item.email, '@btp-consultants.fr'));
    chatBTPData.forEach(item => addUser(item.createdAt, item.email, '@btp-consultants.fr'));

    // Expert / Chat Citae
    expertCitaeData.forEach(item => addUser(item.createdAt, item.email, '@citae.fr'));
    chatCitaeData.forEach(item => addUser(item.createdAt, item.email, '@citae.fr'));

    // Expert / Chat BTP Diagnostics
    expertBTPDiagData.forEach(item => addUser(item.createdAt, item.email, '@btp-diagnostics.fr'));
    chatBTPDiagData.forEach(item => addUser(item.createdAt, item.email, '@btp-diagnostics.fr'));

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

function buildUsersChart() {
    const canvas = document.getElementById('usersEvolutionChart');
    if (!canvas || !usersModalData) return;

    if (usersEvolutionChart) {
        usersEvolutionChart.destroy();
        usersEvolutionChart = null;
    }

    const labels = usersModalData.map(d => d.label);
    const isCumul = usersModalIsCumulative;
    const ctx = canvas.getContext('2d');

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
    const monthlyPill = btn.querySelector('[data-view="monthly"]');
    const cumulPill   = btn.querySelector('[data-view="cumul"]');
    if (!monthlyPill || !cumulPill) return;
    if (!usersModalIsCumulative) {
        monthlyPill.className = 'px-3 py-1 rounded-md text-sm font-medium bg-white text-indigo-700 shadow-sm transition-all';
        cumulPill.className   = 'px-3 py-1 rounded-md text-sm font-medium text-gray-500 hover:text-gray-700 transition-all';
    } else {
        cumulPill.className   = 'px-3 py-1 rounded-md text-sm font-medium bg-white text-indigo-700 shadow-sm transition-all';
        monthlyPill.className = 'px-3 py-1 rounded-md text-sm font-medium text-gray-500 hover:text-gray-700 transition-all';
    }
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
    usersModalIsCumulative = false;
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
            usersModalIsCumulative = (pill.getAttribute('data-view') === 'cumul');
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
            };
        }
    };

    // ── Descriptif ─────────────────────────────────────────────────────────────
    // Mirror processDescriptifData: exclude YIELD, type=DESCRIPTIF_TYPE, ≥100 words.
    // Each contract is attributed to the FIRST month it generated a qualifying
    // descriptif → sum-of-months == all-time unique total (matches the index page).
    const descriptifFirstMonth = new Map(); // contractNumber → earliest valid month key
    descriptifData
        .filter(item =>
            item.type === DESCRIPTIF_TYPE &&
            item.contractNumber &&
            item.contractNumber.trim() !== '' &&
            !item.contractNumber.toUpperCase().includes('YIELD')
        )
        .forEach(item => {
            const key = getMonthKey(item.createdAt);
            if (!key) return;
            const wordCount = countWords(extractText(item.aiResult || ''));
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
    autocontactData
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
    comparateurData.forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].totalPages += (item.maxPage || 0);
    });

    // ── Chat / Expert BTP Consultants ───────────────────────────────────────────
    chatBTPData.forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].chatBTPMessages += (item.messagesLength || 0);
    });

    expertBTPData.forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].expertBTPMessages += (item.messagesLength || 0);
    });

    // ── Chat / Expert Citae ──────────────────────────────────────────────────────
    chatCitaeData.forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].chatCitaeMessages += (item.messagesLength || 0);
    });

    expertCitaeData.forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].expertCitaeMessages += (item.messagesLength || 0);
    });

    // ── Chat / Expert BTP Diagnostics ────────────────────────────────────────────
    chatBTPDiagData.forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].chatBTPDiagMessages += (item.messagesLength || 0);
    });

    expertBTPDiagData.forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        ensureMonth(key);
        monthlyData[key].expertBTPDiagMessages += (item.messagesLength || 0);
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
            d.expertBTPDiagMessages
        );
        const [year, month] = key.split('-');
        return {
            key,
            label: `${monthNames[parseInt(month) - 1]} ${year}`,
            hours: gains.timeGainHours,
            euros: gains.euroGain,
        };
    });
}

let gainModalIsCumulative = false;
let gainModalData = null; // cached monthly gains

function buildGainChart() {
    const canvas = document.getElementById('gainEvolutionChart');
    if (!canvas || !gainModalData) return;

    const isCumul = gainModalIsCumulative;

    // Build display data (monthly or cumulative)
    let hoursData, eurosData;
    if (isCumul) {
        let cumH = 0, cumE = 0;
        hoursData = gainModalData.map(d => { cumH += d.hours; return Math.round(cumH * 100) / 100; });
        eurosData = gainModalData.map(d => { cumE += d.euros; return Math.round(cumE); });
    } else {
        hoursData = gainModalData.map(d => Math.round(d.hours * 100) / 100);
        eurosData = gainModalData.map(d => Math.round(d.euros));
    }
    const labels = gainModalData.map(d => d.label);

    if (gainEvolutionChart) {
        gainEvolutionChart.destroy();
        gainEvolutionChart = null;
    }

    const ctx = canvas.getContext('2d');
    const modeLabel = isCumul ? ' (cumulé)' : ' (mensuel)';

    gainEvolutionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: `Gain en heures${modeLabel}`,
                    data: hoursData,
                    backgroundColor: 'rgba(59, 130, 246, 0.7)',
                    borderColor: 'rgba(37, 99, 235, 1)',
                    borderWidth: 2,
                    borderRadius: 5,
                    yAxisID: 'yHours',
                    order: 2,
                },
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
                    position: 'top',
                    labels: { font: { size: 13, weight: '500' }, color: '#1F2937', padding: 16, usePointStyle: true }
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
                                return ` ${label} : ${new Intl.NumberFormat('fr-FR').format(Math.round(value))} h`;
                            }
                            return ` ${label} : ${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11 }, color: '#6B7280' }
                },
                yHours: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
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
