// Configuration
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordROI';
const DESCRIPTIF_TYPE = 'DESCRIPTIF_SOMMAIRE_DES_TRAVAUX';

// Data URL will be fetched from webhook after authentication
let DATA_URL = '';

// Constants for similarity tests
const HTML_TAG_RE = /<[^>]+>/g;
const NUM_TESTS = 50;
const SUBSTRING_LENGTH = 30;

// Global state
let allRecords = [];
let filteredRecords = [];
let currentIndex = 0;

// Filters
let filters = {
    quality: 'all',
    agency: 'all',
    sortBy: 'date-desc'
};

// DOM Elements
const loadingOverlay = document.getElementById('loading-overlay');
const summaryEl = document.getElementById('summary');
const totalRecordsEl = document.getElementById('total-records');
const uniqueUsersEl = document.getElementById('unique-users');
const uniqueOperationsEl = document.getElementById('unique-operations');
const scoreStatsEl = document.getElementById('score-stats');
const highQualityEl = document.getElementById('high-quality');
const mediumQualityEl = document.getElementById('medium-quality');
const lowQualityEl = document.getElementById('low-quality');
const lowWordCountEl = document.getElementById('low-word-count');
const avgScoreEl = document.getElementById('avg-score');

const qualityFilterEl = document.getElementById('quality-filter');
const agencyFilterEl = document.getElementById('agency-filter');
const sortByEl = document.getElementById('sort-by');
const resetFiltersBtn = document.getElementById('reset-filters');

const recordEl = document.getElementById('record');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const recordCounterEl = document.getElementById('record-counter');

const searchContractInput = document.getElementById('search-contract');
const searchButton = document.getElementById('search-button');
const searchEmailInput = document.getElementById('search-email');
const searchEmailButton = document.getElementById('search-email-button');

const recContractEl = document.getElementById('rec-contract');
const recAgencyEl = document.getElementById('rec-agency');
const recEmailEl = document.getElementById('rec-email');
const recDateEl = document.getElementById('rec-date');
const recScoreEl = document.getElementById('rec-score');
const recMatchesEl = document.getElementById('rec-matches');
const scoreBarEl = document.getElementById('score-bar');
const scorePercentageEl = document.getElementById('score-percentage');
const descBlockEl = document.getElementById('desc-block');
const aiBlockEl = document.getElementById('ai-block');
const descWordCountEl = document.getElementById('desc-word-count');
const aiWordCountEl = document.getElementById('ai-word-count');
const segmentsListEl = document.getElementById('segments-list');

// ==================== UTILITY FUNCTIONS ====================

/**
 * Extracts plain text from an HTML string, cleans it, and normalizes whitespace.
 */
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

/**
 * Extracts a random substring from a text.
 */
function randomSubstring(text, length = SUBSTRING_LENGTH) {
    if (text.length < length || text.length === 0) return null;
    const start = Math.floor(Math.random() * (text.length - length));
    return text.substring(start, start + length);
}

/**
 * Performs similarity tests by searching for random substrings.
 */
function similarityTests(desc, result, nTests = NUM_TESTS, substrLen = SUBSTRING_LENGTH) {
    const logs = [];
    let matches = 0, tests = 0;
    
    if (desc.length < substrLen) {
        return { matches: 0, tests: 0, logs: [] };
    }
    
    for (let i = 0; i < nTests; i++) {
        const sub = randomSubstring(desc, substrLen);
        if (!sub) break;
        const found = result.includes(sub);
        logs.push({ substring: sub, found });
        tests++;
        if (found) matches++;
    }
    
    return { matches, tests, logs };
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

/**
 * Format date for display
 */
function formatDate(dateString) {
    const date = parseFrenchDate(dateString);
    if (!date) return '-';
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${day}/${month}/${year}`;
}

/**
 * Count words in text (only words, not numbers)
 */
function countWords(text) {
    if (!text || typeof text !== 'string') return 0;
    // Match only sequences of letters (including accented characters)
    const words = text.match(/[a-zA-ZÀ-ÿ]+/g);
    return words ? words.length : 0;
}

/**
 * Escapes special HTML characters in a string.
 */
function escapeHtml(str) {
    return str.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Highlights substrings in a text.
 */
function highlight(text, segments, useFoundColors = false) {
    let safeText = escapeHtml(text);
    segments.sort((a, b) => b.substring.length - a.substring.length);
    segments.forEach(({ substring, found }) => {
        const escSubstring = escapeHtml(substring);
        const re = new RegExp(escSubstring.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        let colorClass = useFoundColors ? (found ? 'highlight-found' : 'highlight-not-found') : 'highlight';
        safeText = safeText.replace(re, `<span class="${colorClass}">${escSubstring}</span>`);
    });
    return safeText.replace(/\n/g, '<br>');
}

/**
 * Displays a temporary message to the user.
 */
function displayMessage(message, type = 'info') {
    const messageBox = document.createElement('div');
    const colors = {
        error: 'bg-red-500',
        success: 'bg-green-500',
        warning: 'bg-amber-500',
        info: 'bg-blue-500'
    };
    messageBox.className = `fixed top-5 left-1/2 -translate-x-1/2 p-4 rounded-lg text-white font-bold shadow-lg z-50 ${colors[type] || colors.info}`;
    messageBox.textContent = message;
    document.body.appendChild(messageBox);
    setTimeout(() => messageBox.remove(), 4000);
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
 * Helper function to parse a CSV line with quoted values
 */
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

// ==================== DATA LOADING & PROCESSING ====================

/**
 * Parse CSV data from string
 */
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
    
    console.log('CSV headers found:', headers.length);
    
    // Find column indices - we need to find the description and AI result fields
    let typeIndex = -1;
    let contractIndex = -1;
    let diffusedAtIndex = -1;
    let emailIndex = -1;
    let descriptionIndex = -1;
    let aiResultIndex = -1;
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
        if (descriptionIndex === -1 && header.includes('description') && !header.includes('complement')) {
            descriptionIndex = i;
        }
        if (aiResultIndex === -1 && (header.includes('longresult') || header.includes('result'))) {
            aiResultIndex = i;
        }
        if (agencyIndex === -1 && header.includes('productionservice')) {
            agencyIndex = i;
        }
    }
    
    console.log('Column indices:', {
        type: typeIndex,
        contract: contractIndex,
        diffusedAt: diffusedAtIndex,
        email: emailIndex,
        description: descriptionIndex,
        aiResult: aiResultIndex
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
        const description = descriptionIndex >= 0 ? values[descriptionIndex] : '';
        const aiResult = aiResultIndex >= 0 ? values[aiResultIndex] : '';
        const agency = (agencyIndex >= 0 ? values[agencyIndex] : '') || '';
        
        // Extract agency code from contract number using the global function
        const agencyCode = extractAgency(contractNumber);
        
        // Only keep DESCRIPTIF_SOMMAIRE_DES_TRAVAUX
        if ((type || '').trim() === DESCRIPTIF_TYPE) {
            data.push({
                type: (type || '').trim(),
                contractNumber: (contractNumber || '').trim(),
                createdAt: (diffusedAt || '').trim(),
                email: (email || '').trim(),
                agency: (agency || '').trim(),
                agencyCode: agencyCode,
                description: description,
                aiResult: aiResult
            });
        }
    }
    
    console.log('Parsed', data.length, 'descriptif rows from CSV');
    
    return data;
}

/**
 * Process each record to calculate similarity
 */
function processRecords(rawData) {
    console.log('Processing', rawData.length, 'records...');
    
    const records = [];
    
    rawData.forEach((item, index) => {
        const processedDesc = extractText(item.description);
        const processedAI = extractText(item.aiResult);
        
        if (processedDesc.length === 0 || processedAI.length === 0) {
            console.log(`Skipping record ${index}: empty description or AI result`);
            return;
        }
        
        const { matches, tests, logs } = similarityTests(processedDesc, processedAI);
        const score = tests ? (matches / tests) : 0;
        
        // Count words in description and AI result
        const descWordCount = countWords(processedDesc);
        const aiWordCount = countWords(processedAI);
        
        records.push({
            contractNumber: item.contractNumber,
            email: item.email,
            agency: item.agency,
            createdAt: item.createdAt,
            processedDesc,
            processedAI,
            descWordCount,
            aiWordCount,
            matches,
            tests,
            score,
            logs
        });
    });
    
    console.log('Processed', records.length, 'valid records');
    
    return records;
}

/**
 * Calculate summary statistics
 * @param {Array} records - Records to calculate stats from (filtered)
 * @param {Array} allRecordsForUsers - All records to calculate user tables (unfiltered)
 */
function calculateSummary(records, allRecordsForUsers = null) {
    // Use all records for user tables if provided, otherwise use filtered records
    const recordsForUsers = allRecordsForUsers || records;
    
    const uniqueUsers = new Set();
    const uniqueOperations = new Set();
    let totalScore = 0;
    let highQuality = 0;
    let mediumQuality = 0;
    let lowQuality = 0;
    let lowWordCount = 0; // Count records with less than 500 words
    
    // Calculate stats from filtered records
    records.forEach(rec => {
        if (rec.email) uniqueUsers.add(rec.email);
        if (rec.contractNumber) uniqueOperations.add(rec.contractNumber);
        
        totalScore += rec.score;
        
        if (rec.score >= 0.70) highQuality++;
        else if (rec.score >= 0.30) mediumQuality++;
        else lowQuality++;
        
        // Count records with less than 300 words
        if (rec.descWordCount < 500) lowWordCount++;
    });
    
    const avgScore = records.length > 0 ? (totalScore / records.length) : 0;
    
    // For user aggregation - use ALL records (not filtered)
    const userScores = {};
    
    recordsForUsers.forEach(rec => {
        if (rec.email) {
            // Aggregate scores by user
            if (!userScores[rec.email]) {
                userScores[rec.email] = {
                    totalMatches: 0,
                    totalTests: 0,
                    count: 0
                };
            }
            userScores[rec.email].totalMatches += rec.matches;
            userScores[rec.email].totalTests += rec.tests;
            userScores[rec.email].count++;
        }
    });
    
    // Calculate best and low score users
    const bestUsers = [];
    const lowScoreUsers = [];
    
    Object.keys(userScores).forEach(email => {
        const data = userScores[email];
        const avgUserScore = data.totalTests > 0 ? (data.totalMatches / data.totalTests) : 0;
        const userInfo = {
            email,
            averageScore: avgUserScore,
            usage: data.count
        };
        
        if (avgUserScore >= 0.70) {
            bestUsers.push(userInfo);
        } else if (avgUserScore < 0.30) {
            lowScoreUsers.push(userInfo);
        }
    });
    
    // Sort users
    bestUsers.sort((a, b) => b.averageScore - a.averageScore);
    lowScoreUsers.sort((a, b) => a.averageScore - b.averageScore);
    
    return {
        totalRecords: records.length,
        uniqueUsers: uniqueUsers.size,
        uniqueOperations: uniqueOperations.size,
        avgScore,
        highQuality,
        mediumQuality,
        lowQuality,
        lowWordCount,
        bestUsers,
        lowScoreUsers
    };
}

/**
 * Update summary display
 */
function updateSummary() {
    // Calculate summary with filtered records for stats, but ALL records for user tables
    const summary = calculateSummary(filteredRecords, allRecords);
    
    totalRecordsEl.textContent = `Enregistrements traités: ${summary.totalRecords}`;
    uniqueUsersEl.textContent = `Utilisateurs uniques: ${summary.uniqueUsers}`;
    uniqueOperationsEl.textContent = `Opérations uniques: ${summary.uniqueOperations}`;
    
    scoreStatsEl.textContent = `Score de similarité moyen: ${(summary.avgScore * 100).toFixed(1)}%`;
    highQualityEl.innerHTML = `Qualité élevée (≥70%): <strong class="float-right text-green-600">${summary.highQuality}</strong>`;
    mediumQualityEl.innerHTML = `Qualité moyenne (30-70%): <strong class="float-right text-yellow-600">${summary.mediumQuality}</strong>`;
    lowQualityEl.innerHTML = `Qualité faible (<30%): <strong class="float-right text-red-600">${summary.lowQuality}</strong>`;
    
    // Add word count stats
    const lowWordPercentage = summary.totalRecords > 0 ? ((summary.lowWordCount / summary.totalRecords) * 100).toFixed(1) : 0;
    lowWordCountEl.innerHTML = `Descriptions < 500 mots: <strong class="float-right text-blue-600">${summary.lowWordCount} (${lowWordPercentage}%)</strong>`;
    
    avgScoreEl.textContent = `Score moyen global: ${(summary.avgScore * 100).toFixed(1)}%`;
    
    // Update user tables (based on ALL records, not filtered)
    populateUserTable('best-users-table', summary.bestUsers, 'Aucun utilisateur avec un score > 70%');
    populateUserTable('low-score-users-table', summary.lowScoreUsers, 'Aucun utilisateur avec un score < 30%');
    
    // Update chart (uses filteredRecords)
    updateDailySimilarityChart();
}

/**
 * Get available agencies from all records
 */
function getAvailableAgencies(records) {
    const agencies = new Set();
    records.forEach(rec => {
        if (rec.agency) agencies.add(rec.agency);
    });
    return Array.from(agencies).sort();
}

/**
 * Populate agency filter
 */
function populateAgencyFilter() {
    const agencies = getAvailableAgencies(allRecords);
    agencyFilterEl.innerHTML = '<option value="all">Toutes les agences</option>';
    agencies.forEach(agency => {
        const option = document.createElement('option');
        option.value = agency;
        option.textContent = agency;
        agencyFilterEl.appendChild(option);
    });
}

// ==================== FILTERING & SORTING ====================

/**
 * Apply filters to records
 */
function applyFilters() {
    filteredRecords = allRecords.filter(rec => {
        // Quality filter
        if (filters.quality !== 'all') {
            if (filters.quality === 'high' && rec.score < 0.70) return false;
            if (filters.quality === 'medium' && (rec.score < 0.30 || rec.score >= 0.70)) return false;
            if (filters.quality === 'low' && rec.score >= 0.30) return false;
        }
        
        // Agency filter
        if (filters.agency !== 'all' && rec.agency !== filters.agency) return false;
        
        return true;
    });
    
    // Apply sorting
    filteredRecords.sort((a, b) => {
        switch (filters.sortBy) {
            case 'date-desc':
                return parseFrenchDate(b.createdAt) - parseFrenchDate(a.createdAt);
            case 'date-asc':
                return parseFrenchDate(a.createdAt) - parseFrenchDate(b.createdAt);
            case 'score-desc':
                return b.score - a.score;
            case 'score-asc':
                return a.score - b.score;
            default:
                return 0;
        }
    });
    
    currentIndex = 0;
    updateSummary();
    showRecord();
}

// ==================== RECORD DISPLAY ====================

/**
 * Show the current record
 */
function showRecord() {
    if (filteredRecords.length === 0) {
        recordEl.classList.add('hidden');
        displayMessage('Aucun enregistrement à afficher', 'warning');
        return;
    }
    
    recordEl.classList.remove('hidden');
    
    const rec = filteredRecords[currentIndex];
    
    // Update header info
    recContractEl.textContent = rec.contractNumber || '-';
    recAgencyEl.textContent = rec.agency || '-';
    recEmailEl.textContent = rec.email || '-';
    recDateEl.textContent = formatDate(rec.createdAt);
    recScoreEl.textContent = (rec.score * 100).toFixed(1) + '%';
    recMatchesEl.textContent = `${rec.matches}/${rec.tests} segments retrouvés`;
    
    // Update record counter
    recordCounterEl.textContent = `${currentIndex + 1} / ${filteredRecords.length}`;
    
    // Update score bar
    const scorePercent = (rec.score * 100).toFixed(1);
    scoreBarEl.style.width = scorePercent + '%';
    scorePercentageEl.textContent = scorePercent + '%';
    
    // Color the score bar based on quality
    if (rec.score >= 0.70) {
        scoreBarEl.className = 'h-full transition-all duration-500 bg-green-500';
    } else if (rec.score >= 0.30) {
        scoreBarEl.className = 'h-full transition-all duration-500 bg-yellow-500';
    } else {
        scoreBarEl.className = 'h-full transition-all duration-500 bg-red-500';
    }
    
    // Update text blocks
    descBlockEl.innerHTML = highlight(rec.processedDesc, rec.logs, true);
    aiBlockEl.innerHTML = highlight(rec.processedAI, rec.logs, false);
    
    // Update word counts
    descWordCountEl.textContent = `(${rec.descWordCount} mots)`;
    aiWordCountEl.textContent = `(${rec.aiWordCount} mots)`;
    
    // Update segments list
    segmentsListEl.innerHTML = '';
    rec.logs.forEach(({ substring, found }) => {
        const li = document.createElement('li');
        li.className = `p-2 rounded-md flex justify-between items-center font-mono ${found ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`;
        li.innerHTML = `<span class="break-all">"${escapeHtml(substring)}"</span><span class="font-sans font-bold text-xs px-2 py-1 rounded-full ${found ? 'bg-green-200' : 'bg-red-200'}">${found ? 'Trouvé' : 'Non trouvé'}</span>`;
        segmentsListEl.appendChild(li);
    });
    
    // Update navigation buttons
    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = currentIndex === filteredRecords.length - 1;
}

// ==================== EVENT LISTENERS ====================

// Filter listeners
qualityFilterEl.addEventListener('change', (e) => {
    filters.quality = e.target.value;
    applyFilters();
});

agencyFilterEl.addEventListener('change', (e) => {
    filters.agency = e.target.value;
    applyFilters();
});

sortByEl.addEventListener('change', (e) => {
    filters.sortBy = e.target.value;
    applyFilters();
});

resetFiltersBtn.addEventListener('click', () => {
    filters.quality = 'all';
    filters.agency = 'all';
    filters.sortBy = 'date-desc';
    qualityFilterEl.value = 'all';
    agencyFilterEl.value = 'all';
    sortByEl.value = 'date-desc';
    applyFilters();
});

// Navigation listeners
prevBtn.addEventListener('click', () => {
    if (currentIndex > 0) {
        currentIndex--;
        showRecord();
    }
});

nextBtn.addEventListener('click', () => {
    if (currentIndex < filteredRecords.length - 1) {
        currentIndex++;
        showRecord();
    }
});

// Search listeners
const search = (key, value) => {
    if (!value) return;
    const foundIndex = filteredRecords.findIndex(rec => 
        String(rec[key]).toLowerCase().includes(value.toLowerCase())
    );
    if (foundIndex !== -1) {
        currentIndex = foundIndex;
        showRecord();
        displayMessage(`${key === 'contractNumber' ? 'Contrat' : 'Email'} trouvé !`, 'success');
    } else {
        displayMessage(`Aucun résultat pour "${value}".`, 'error');
    }
};

searchButton.addEventListener('click', () => search('contractNumber', searchContractInput.value.trim()));
searchEmailButton.addEventListener('click', () => search('email', searchEmailInput.value.trim()));
searchContractInput.addEventListener('keydown', (e) => e.key === 'Enter' && search('contractNumber', e.target.value.trim()));
searchEmailInput.addEventListener('keydown', (e) => e.key === 'Enter' && search('email', e.target.value.trim()));

// ==================== INITIALIZATION ====================

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

async function init() {
    try {
        // Authenticate and get data URL
        DATA_URL = await authenticateAndGetURL();
        if (!DATA_URL) {
            return;
        }
        
        console.log('Loading data from:', DATA_URL);
        
        const response = await fetch(DATA_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const rawText = await response.text();
        console.log('Response received, length:', rawText.length);
        
        let csvData = null;
        
        try {
            const jsonData = JSON.parse(rawText);
            
            if (Array.isArray(jsonData) && jsonData.length > 0 && jsonData[0].data) {
                console.log('Found JSON array with data field');
                csvData = jsonData[0].data;
            } else if (jsonData.data && typeof jsonData.data === 'string') {
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
            }
        }
        
        if (!csvData) {
            console.log('No CSV data found, trying raw text as CSV');
            csvData = rawText;
        }
        
        const rawData = parseCSVData(csvData);
        
        if (rawData.length === 0) {
            throw new Error('No descriptif data found in file');
        }
        
        console.log('Starting similarity analysis...');
        allRecords = processRecords(rawData);
        
        if (allRecords.length === 0) {
            throw new Error('No valid records after processing');
        }
        
        // Initialize filters
        populateAgencyFilter();
        applyFilters();
        
        // Hide loading overlay
        loadingOverlay.style.display = 'none';
        
        displayMessage(`${allRecords.length} descriptifs chargés avec succès !`, 'success');
        
    } catch (error) {
        console.error('Error loading data:', error);
        loadingOverlay.innerHTML = `
            <div class="text-center">
                <p class="text-white text-lg font-bold mb-2">Erreur de chargement</p>
                <p class="text-white text-sm">${error.message}</p>
                <button onclick="location.reload()" class="mt-4 px-4 py-2 bg-white text-gray-800 rounded-lg hover:bg-gray-100">
                    Réessayer
                </button>
            </div>
        `;
    }
}

// ==================== USER TABLES ====================

/**
 * Populates a table with user data.
 */
function populateUserTable(tableId, userData, emptyMessage) {
    const container = document.getElementById(tableId);
    container.innerHTML = '';
    
    if (userData && userData.length > 0) {
        const table = document.createElement('table');
        table.className = "w-full text-sm text-left text-gray-500";
        table.innerHTML = `
            <thead class="text-xs text-gray-700 uppercase bg-gray-50">
                <tr>
                    <th scope="col" class="py-3 px-6">Email</th>
                    <th scope="col" class="py-3 px-6 text-center">Score Moyen</th>
                    <th scope="col" class="py-3 px-6 text-center">Utilisations</th>
                </tr>
            </thead>
            <tbody></tbody>`;
        const tbody = table.querySelector('tbody');
        userData.forEach(user => {
            const tr = document.createElement('tr');
            tr.className = "bg-white border-b hover:bg-gray-50";
            tr.innerHTML = `
                <td class="py-4 px-6 font-medium text-gray-900">${user.email}</td>
                <td class="py-4 px-6 text-center">${user.averageScore.toFixed(2)}</td>
                <td class="py-4 px-6 text-center">${user.usage}</td>
            `;
            tbody.appendChild(tr);
        });
        container.appendChild(table);
    } else {
        container.innerHTML = `<p class="text-sm text-gray-500 p-4 text-center">${emptyMessage}</p>`;
    }
}

// ==================== D3 CHART ====================

/**
 * Update daily similarity chart
 */
function updateDailySimilarityChart() {
    // Group records by date
    const dailyData = {};
    
    filteredRecords.forEach(rec => {
        const date = parseFrenchDate(rec.createdAt);
        if (!date) return;
        
        const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
        
        if (!dailyData[dateKey]) {
            dailyData[dateKey] = {
                totalScore: 0,
                count: 0
            };
        }
        
        dailyData[dateKey].totalScore += rec.score;
        dailyData[dateKey].count++;
    });
    
    // Convert to array and calculate average
    const chartData = Object.keys(dailyData)
        .map(dateKey => ({
            date: d3.timeParse("%Y-%m-%d")(dateKey),
            score: dailyData[dateKey].count > 0 ? dailyData[dateKey].totalScore / dailyData[dateKey].count : 0
        }))
        .sort((a, b) => a.date - b.date);
    
    // Calculate overall average
    const overallAverage = filteredRecords.length > 0 
        ? filteredRecords.reduce((sum, rec) => sum + rec.score, 0) / filteredRecords.length 
        : 0;
    
    drawLineChart('#daily-similarity-chart', chartData, overallAverage);
}

/**
 * Draw line chart with D3
 */
function drawLineChart(selector, data, overallAverageScore = null) {
    const svg = d3.select(selector);
    svg.selectAll('*').remove();

    if (svg.empty()) {
        console.error(`D3 container not found for selector: ${selector}`);
        return;
    }
    
    const containerWidth = svg.node().getBoundingClientRect().width;
    const containerHeight = svg.node().getBoundingClientRect().height;

    const margin = { top: 20, right: 30, bottom: 40, left: 50 };
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    
    if (!data || data.length < 2) {
        g.append("text")
            .attr("x", width / 2)
            .attr("y", height / 2)
            .attr("text-anchor", "middle")
            .text("Données insuffisantes pour un graphique linéaire.");
        return;
    }

    const x = d3.scaleTime()
        .domain(d3.extent(data, d => d.date))
        .range([0, width]);
    
    const y = d3.scaleLinear()
        .domain([0, Math.min(1, d3.max(data, d => d.score) * 1.1)])
        .nice()
        .range([height, 0]);

    g.append('g')
        .attr('class', 'axis x-axis')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(x).ticks(5).tickFormat(d3.timeFormat("%d/%m")));
    
    g.append('g')
        .attr('class', 'axis y-axis')
        .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));

    // Daily line
    const lineDaily = d3.line()
        .x(d => x(d.date))
        .y(d => y(d.score));
    
    // 7-day moving average
    const movingAverageData = data.map((d, i, arr) => {
        const window = arr.slice(Math.max(0, i - 6), i + 1);
        const score = window.reduce((acc, curr) => acc + curr.score, 0) / window.length;
        return { date: d.date, score };
    });
    
    const lineTrend = d3.line()
        .x(d => x(d.date))
        .y(d => y(d.score));

    g.append('path')
        .datum(data)
        .attr('class', 'line-daily')
        .attr('d', lineDaily);
    
    g.append('path')
        .datum(movingAverageData)
        .attr('class', 'line-trend')
        .attr('d', lineTrend);
    
    // Average line
    if (overallAverageScore !== null) {
        g.append("line")
            .attr("class", "average-line")
            .attr("x1", 0)
            .attr("y1", y(overallAverageScore))
            .attr("x2", width)
            .attr("y2", y(overallAverageScore));
    }

    // Tooltip
    const tooltip = d3.select("body").append("div")
        .attr("class", "tooltip")
        .style("opacity", 0);
    
    g.selectAll(".dot")
        .data(data)
        .enter()
        .append("circle")
        .attr("class", "dot")
        .attr("cx", d => x(d.date))
        .attr("cy", d => y(d.score))
        .attr("r", 4)
        .on("mouseover", (event, d) => {
            tooltip.transition().duration(200).style("opacity", .9);
            tooltip.html(`Date: ${d3.timeFormat("%d/%m/%Y")(d.date)}<br/>Score: ${(d.score * 100).toFixed(1)}%`)
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", () => {
            tooltip.transition().duration(500).style("opacity", 0);
        });
}

// Start the app
init();

