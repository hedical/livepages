// Configuration
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordROI';
// Default Google Sheet URL (fallback if not provided by webhook)
const DEFAULT_GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1vUrqckVmTD8yePcsAbVzKy_pTp7zuSIwkRaAi0Jbwhw/export?format=csv&gid=1039655127';
let GOOGLE_SHEET_URL = DEFAULT_GOOGLE_SHEET_URL;

// Data URL will be fetched from webhook after authentication
let DATA_URL = '';

// State
let allContacts = [];
let filteredContacts = [];
let availablePositions = [];
let positionChart = null;
let typologieChart = null;
let googleSheetMapping = {}; // {numeroAffaireOpportunite: typologieBatiment}
let activeFilters = {
    position: null,
    typologie: null
};

// Filters
const filters = {
    company: '',
    role: '',
    position: 'all'
};

// DOM Elements
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const mainContentEl = document.getElementById('main-content');
const companySearchEl = document.getElementById('company-search');
const roleSearchEl = document.getElementById('role-search');
const positionFilterEl = document.getElementById('position-filter');
const resetFiltersBtn = document.getElementById('reset-filters');
const exportCsvBtn = document.getElementById('export-csv');
const tableBodyEl = document.getElementById('contacts-table-body');
const filteredCountEl = document.getElementById('filtered-count');
const totalCountEl = document.getElementById('total-count');

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

// Parse CSV data
function parseCSVData(csvString) {
    if (!csvString || typeof csvString !== 'string') {
        console.warn('Invalid CSV string');
        return [];
    }
    
    // Clean up CSV string
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
    
    // Find column indices
    const emailIndex = headers.findIndex(h => h.toLowerCase() === 'email');
    const roleIndex = headers.findIndex(h => h.toLowerCase() === 'role');
    const firstNameIndex = headers.findIndex(h => h.toLowerCase() === 'firstname');
    const lastNameIndex = headers.findIndex(h => h.toLowerCase() === 'lastname');
    const positionIndex = headers.findIndex(h => h.toLowerCase() === 'position');
    const companyIndex = headers.findIndex(h => h.toLowerCase().includes('company') && h.toLowerCase().includes('name'));
    const btpEmailIndex = headers.findIndex(h => h.toLowerCase().includes('user') && h.toLowerCase().includes('email'));
    const createdAtIndex = headers.findIndex(h => h.toLowerCase() === 'createdat' && !h.includes('→'));
    const contractIndex = headers.findIndex(h => h.toLowerCase().includes('contractnumber'));
    const phoneIndex = headers.findIndex(h => h.toLowerCase().includes('phone') || h.toLowerCase().includes('téléphone') || h.toLowerCase().includes('telephone'));
    
    console.log('Column indices:', {
        email: emailIndex,
        role: roleIndex,
        firstName: firstNameIndex,
        lastName: lastNameIndex,
        position: positionIndex,
        company: companyIndex,
        btpEmail: btpEmailIndex,
        createdAt: createdAtIndex,
        contract: contractIndex,
        phone: phoneIndex
    });
    
    if (emailIndex === -1) {
        console.error('Email column not found');
        return [];
    }
    
    // Parse data rows
    const parsedData = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const values = parseCSVLine(line);
        
        if (values.length <= Math.max(emailIndex, companyIndex, btpEmailIndex)) {
            continue;
        }
        
        // Skip if contract contains YIELD
        if (contractIndex !== -1 && values[contractIndex]) {
            const contractNumber = values[contractIndex].trim().toUpperCase();
            if (contractNumber.includes('YIELD')) {
                continue;
            }
        }
        
        const contact = {
            email: emailIndex !== -1 ? values[emailIndex]?.trim() || '' : '',
            role: roleIndex !== -1 ? values[roleIndex]?.trim() || '' : '',
            firstName: firstNameIndex !== -1 ? values[firstNameIndex]?.trim() || '' : '',
            lastName: lastNameIndex !== -1 ? values[lastNameIndex]?.trim() || '' : '',
            position: positionIndex !== -1 ? values[positionIndex]?.trim() || '' : '',
            company: companyIndex !== -1 ? values[companyIndex]?.trim() || '' : '',
            btpEmail: btpEmailIndex !== -1 ? values[btpEmailIndex]?.trim() || '' : '',
            createdAt: createdAtIndex !== -1 ? values[createdAtIndex]?.trim() || '' : '',
            contractNumber: contractIndex !== -1 ? values[contractIndex]?.trim() || '' : '',
            phone: phoneIndex !== -1 ? values[phoneIndex]?.trim() || '' : ''
        };
        
        // Add all contacts (including internal @btp-consultants.fr)
        if (contact.email) {
            parsedData.push(contact);
        }
    }
    
    console.log(`Parsed ${parsedData.length} contacts`);
    return parsedData;
}

// Get available positions
function getAvailablePositions(contacts) {
    const positions = new Set();
    contacts.forEach(contact => {
        if (contact.position && contact.position.trim() !== '') {
            positions.add(contact.position);
        }
    });
    return Array.from(positions).sort();
}

// Populate position filter
function populatePositionFilter() {
    positionFilterEl.innerHTML = '<option value="all">Toutes les positions</option>';
    availablePositions.forEach(position => {
        const option = document.createElement('option');
        option.value = position;
        option.textContent = position;
        positionFilterEl.appendChild(option);
    });
}

// Filter contacts
function applyFilters() {
    filteredContacts = allContacts.filter(contact => {
        // Company filter (search)
        if (filters.company) {
            const searchTerm = filters.company.toLowerCase();
            const companyMatch = contact.company.toLowerCase().includes(searchTerm);
            if (!companyMatch) return false;
        }
        
        // Role filter (search)
        if (filters.role) {
            const searchTerm = filters.role.toLowerCase();
            const roleMatch = contact.role.toLowerCase().includes(searchTerm);
            if (!roleMatch) return false;
        }
        
        // Position filter (dropdown or chart click)
        if (filters.position !== 'all') {
            if (contact.position !== filters.position) return false;
        }
        
        // Typologie filter (chart click) - use pre-calculated value
        if (activeFilters.typologie !== null) {
            const typologieBatiment = (contact.typologieBatiment || '-');
            if (typologieBatiment !== activeFilters.typologie) return false;
        }
        
        return true;
    });
    
    renderTable();
    updateStats();
    updatePositionChart();
    updateTypologieChart();
}

// Render table
function renderTable() {
    tableBodyEl.innerHTML = '';
    
    if (filteredContacts.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="10" class="px-4 py-8 text-center text-gray-500">
                Aucun contact trouvé avec les filtres actuels
            </td>
        `;
        tableBodyEl.appendChild(row);
        return;
    }
    
    filteredContacts.forEach((contact, index) => {
        const row = document.createElement('tr');
        row.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        
        const typologieBatiment = contact.typologieBatiment || '-';
        
        row.innerHTML = `
            <td class="px-4 py-3 text-sm text-gray-900">${escapeHtml(contact.email)}</td>
            <td class="px-4 py-3 text-sm text-gray-900">${escapeHtml(contact.firstName)}</td>
            <td class="px-4 py-3 text-sm text-gray-900">${escapeHtml(contact.lastName)}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(contact.position)}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(contact.role)}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(contact.company)}</td>
            <td class="px-4 py-3 text-sm text-blue-600">${escapeHtml(contact.btpEmail)}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(contact.phone || '-')}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(typologieBatiment)}</td>
            <td class="px-4 py-3 text-sm text-gray-500">${formatDate(contact.createdAt)}</td>
        `;
        
        tableBodyEl.appendChild(row);
    });
}

// Update stats
function updateStats() {
    filteredCountEl.textContent = filteredContacts.length;
    totalCountEl.textContent = allContacts.length;
}

// Update position chart
function updatePositionChart() {
    // Removed verbose logs for performance
    
    // Check if Chart is available
    if (typeof Chart === 'undefined') {
        console.error('Chart.js is not loaded yet');
        return;
    }
    
    // Check if canvas exists
    const canvas = document.getElementById('positionChart');
    if (!canvas) {
        console.error('Canvas element not found');
        return;
    }
    
    // Count contacts by position
    const positionCounts = {};
    filteredContacts.forEach(contact => {
        const position = contact.position || 'Non spécifié';
        positionCounts[position] = (positionCounts[position] || 0) + 1;
    });
    
    // Sort by count descending
    const sortedPositions = Object.entries(positionCounts)
        .sort((a, b) => b[1] - a[1]);
    
    const labels = sortedPositions.map(([position]) => position);
    const data = sortedPositions.map(([, count]) => count);
    
    if (labels.length === 0) {
        console.warn('No data to display in chart');
        return;
    }
    
    // Generate colors
    const colors = [
        '#3b82f6', // blue-500
        '#10b981', // green-500
        '#f59e0b', // amber-500
        '#ef4444', // red-500
        '#8b5cf6', // violet-500
        '#ec4899', // pink-500
        '#06b6d4', // cyan-500
        '#f97316', // orange-500
        '#14b8a6', // teal-500
        '#a855f7', // purple-500
    ];
    
    const backgroundColors = sortedPositions.map((_, index) => colors[index % colors.length]);
    
    // Destroy existing chart if it exists
    if (positionChart) {
        positionChart.destroy();
    }
    
    try {
        // Create new chart
        positionChart = new Chart(canvas, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: backgroundColors,
                borderColor: '#ffffff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const clickedPosition = labels[index];
                    
                    // Toggle filter: if same position clicked, remove filter; otherwise apply filter
                    if (activeFilters.position === clickedPosition) {
                        activeFilters.position = null;
                        filters.position = 'all';
                        positionFilterEl.value = 'all';
                    } else {
                        activeFilters.position = clickedPosition;
                        filters.position = clickedPosition;
                        positionFilterEl.value = clickedPosition;
                    }
                    
                    applyFilters();
                }
            },
            onHover: (event, elements) => {
                event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
            },
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        padding: 15,
                        font: {
                            size: 12
                        },
                        generateLabels: function(chart) {
                            const data = chart.data;
                            if (data.labels.length && data.datasets.length) {
                                return data.labels.map((label, i) => {
                                    const value = data.datasets[0].data[i];
                                    const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    const isActive = activeFilters.position === label;
                                    return {
                                        text: `${label} (${value} - ${percentage}%)${isActive ? ' ✓' : ''}`,
                                        fillStyle: data.datasets[0].backgroundColor[i],
                                        hidden: false,
                                        index: i,
                                        fontColor: isActive ? '#1f2937' : '#6b7280',
                                        fontStyle: isActive ? 'bold' : 'normal'
                                    };
                                });
                            }
                            return [];
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value} contacts (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
        // Chart created successfully
    } catch (error) {
        console.error('Error creating chart:', error);
    }
}

// Update typologie batiment chart
function updateTypologieChart() {
    // Removed verbose logs for performance
    
    // Check if Chart is available
    if (typeof Chart === 'undefined') {
        console.error('Chart.js is not loaded yet');
        return;
    }
    
    // Check if canvas exists
    const canvas = document.getElementById('typologieChart');
    if (!canvas) {
        console.error('Canvas element "typologieChart" not found');
        return;
    }
    
    // Count contacts by typologie batiment (use pre-calculated value)
    const typologieCounts = {};
    filteredContacts.forEach(contact => {
        const typologieBatiment = (contact.typologieBatiment || 'Non spécifié');
        typologieCounts[typologieBatiment] = (typologieCounts[typologieBatiment] || 0) + 1;
    });
    
    // Sort by count descending
    const sortedTypologies = Object.entries(typologieCounts)
        .sort((a, b) => b[1] - a[1]);
    
    const labels = sortedTypologies.map(([typologie]) => typologie);
    const data = sortedTypologies.map(([, count]) => count);
    
    if (labels.length === 0) {
        console.warn('No data to display in typologie chart');
        return;
    }
    
    // Generate colors
    const colors = [
        '#3b82f6', // blue-500
        '#10b981', // green-500
        '#f59e0b', // amber-500
        '#ef4444', // red-500
        '#8b5cf6', // violet-500
        '#ec4899', // pink-500
        '#06b6d4', // cyan-500
        '#f97316', // orange-500
        '#14b8a6', // teal-500
        '#a855f7', // purple-500
    ];
    
    const backgroundColors = sortedTypologies.map((_, index) => colors[index % colors.length]);
    
    // Destroy existing chart if it exists
    if (typologieChart) {
        typologieChart.destroy();
    }
    
    try {
        // Create new chart
        typologieChart = new Chart(canvas, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: backgroundColors,
                    borderColor: '#ffffff',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const clickedTypologie = labels[index];
                    
                    // Toggle filter: if same typologie clicked, remove filter; otherwise apply filter
                    if (activeFilters.typologie === clickedTypologie) {
                        activeFilters.typologie = null;
                    } else {
                        activeFilters.typologie = clickedTypologie;
                    }
                    
                    applyFilters();
                }
            },
            onHover: (event, elements) => {
                event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
            },
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            padding: 15,
                            font: {
                                size: 12
                            },
                            generateLabels: function(chart) {
                                const data = chart.data;
                                if (data.labels.length && data.datasets.length) {
                                    return data.labels.map((label, i) => {
                                        const value = data.datasets[0].data[i];
                                        const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                                        const percentage = ((value / total) * 100).toFixed(1);
                                        const isActive = activeFilters.typologie === label;
                                        return {
                                            text: `${label} (${value} - ${percentage}%)${isActive ? ' ✓' : ''}`,
                                            fillStyle: data.datasets[0].backgroundColor[i],
                                            hidden: false,
                                            index: i,
                                            fontColor: isActive ? '#1f2937' : '#6b7280',
                                            fontStyle: isActive ? 'bold' : 'normal'
                                        };
                                    });
                                }
                                return [];
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((value / total) * 100).toFixed(1);
                                return `${label}: ${value} contacts (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
        // Typologie chart created successfully
    } catch (error) {
        console.error('Error creating typologie chart:', error);
    }
}

// Format date
function formatDate(dateString) {
    if (!dateString) return '-';
    // Try to parse and format the date
    try {
        const date = new Date(dateString);
        if (!isNaN(date.getTime())) {
            return date.toLocaleDateString('fr-FR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
        }
    } catch (e) {
        // If parsing fails, return the original string
    }
    return dateString;
}

// Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
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
        'Ã': 'É',
        'Ã': 'È',
        'Ã': 'À',
        'Ã': 'Ç',
        '�': 'é'
    };
    
    let fixed = text;
    for (const [wrong, correct] of Object.entries(replacements)) {
        fixed = fixed.replace(new RegExp(wrong, 'g'), correct);
    }
    
    return fixed;
}

// Load Google Sheet data and create mapping
async function loadGoogleSheetMapping() {
    try {
        // Try multiple CORS proxy services as fallback
        // Note: CORS proxies may be slow or unreliable. Best solution is to serve from a web server.
        const proxies = [
            'https://corsproxy.io/?',
            'https://api.codetabs.com/v1/proxy?quest='
        ];
        
        let response = null;
        let lastError = null;
        
        // First try direct fetch (works if served from web server or if URL is from webhook)
        try {
            response = await fetch(GOOGLE_SHEET_URL, {
                mode: 'cors',
                cache: 'no-cache',
                credentials: 'omit'
            });
            if (response.ok) {
                console.log('✓ Google Sheet loaded directly');
            }
        } catch (directError) {
            console.warn('Direct fetch failed, trying CORS proxies...');
            lastError = directError;
        }
        
        // If direct fetch failed, try proxies (only if not from webhook)
        if ((!response || !response.ok) && GOOGLE_SHEET_URL === DEFAULT_GOOGLE_SHEET_URL) {
            for (const proxy of proxies) {
                try {
                    const proxyUrl = proxy + encodeURIComponent(GOOGLE_SHEET_URL);
                    console.log('Trying CORS proxy:', proxy.substring(0, 30) + '...');
                    response = await fetch(proxyUrl, {
                        method: 'GET',
                        signal: AbortSignal.timeout(10000) // 10 second timeout
                    });
                    
                    if (response.ok) {
                        console.log('✓ Google Sheet loaded via CORS proxy');
                        break;
                    }
                } catch (proxyError) {
                    console.warn('Proxy failed:', proxyError.message);
                    lastError = proxyError;
                    continue;
                }
            }
        }
        
        if (!response || !response.ok) {
            console.warn('⚠ Could not load Google Sheet');
            console.warn('Status:', response?.status);
            console.warn('This will not prevent the app from working, but typologie batiment will be empty.');
            console.warn('To fix: Add GOOGLE_SHEET_URL to your n8n webhook response.');
            return {};
        }
        
        let csvText = await response.text();
        csvText = fixEncoding(csvText);
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        
        if (lines.length === 0) {
            console.warn('Google Sheet is empty');
            return {};
        }
        
        // Parse header to find column indices
        const headerLine = lines[0];
        const headers = parseCSVLine(headerLine);
        
        let numeroAffaireIndex = -1;
        let typologieBatimentIndex = -1;
        
        for (let i = 0; i < headers.length; i++) {
            const header = headers[i].toLowerCase().trim();
            if (numeroAffaireIndex === -1 && (header.includes('numéro affaire opportunité') || header.includes('numero affaire opportunite') || header.includes('numero affaire'))) {
                numeroAffaireIndex = i;
            }
            if (typologieBatimentIndex === -1 && (header.includes('typologie batiment') || header.includes('typologie'))) {
                typologieBatimentIndex = i;
            }
        }
        
        if (numeroAffaireIndex === -1 || typologieBatimentIndex === -1) {
            console.error('Could not find required columns in Google Sheet');
            console.error('Headers found:', headers);
            console.error('Looking for:', {
                numeroAffaire: 'numéro affaire opportunité',
                typologieBatiment: 'typologie batiment'
            });
            return {};
        }
        
        console.log('Found columns:', {
            numeroAffaire: numeroAffaireIndex,
            typologieBatiment: typologieBatimentIndex,
            numeroAffaireHeader: headers[numeroAffaireIndex],
            typologieBatimentHeader: headers[typologieBatimentIndex]
        });
        console.log('Total headers:', headers.length);
        
        // Create mapping
        const mapping = {};
        let sampleData = [];
        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            if (values.length > Math.max(numeroAffaireIndex, typologieBatimentIndex)) {
                const numeroAffaire = (values[numeroAffaireIndex] || '').trim();
                const typologieBatiment = (values[typologieBatimentIndex] || '').trim();
                
                // Skip empty values and "NA"
                if (numeroAffaire && numeroAffaire.toUpperCase() !== 'NA' && typologieBatiment && typologieBatiment.toUpperCase() !== 'NA') {
                    // Remove prefix (P- or C-) and normalize
                    const withoutPrefix = numeroAffaire.replace(/^[PC]-/, '').trim();
                    const normalizedWithoutPrefix = withoutPrefix.toUpperCase().replace(/\s+/g, '');
                    
                    // Store with original format
                    mapping[numeroAffaire] = typologieBatiment;
                    mapping[numeroAffaire.toUpperCase().replace(/\s+/g, '')] = typologieBatiment;
                    
                    // Store WITHOUT prefix (this is the key matching strategy)
                    mapping[withoutPrefix] = typologieBatiment;
                    mapping[normalizedWithoutPrefix] = typologieBatiment;
                    
                    // Also store with C- and P- prefixes for flexibility
                    mapping['C-' + withoutPrefix] = typologieBatiment;
                    mapping['P-' + withoutPrefix] = typologieBatiment;
                    mapping['C-' + normalizedWithoutPrefix] = typologieBatiment;
                    mapping['P-' + normalizedWithoutPrefix] = typologieBatiment;
                    
                    // Store partial matches (for truncated numbers)
                    const parts = withoutPrefix.split('-');
                    if (parts.length >= 4) {
                        // Full number without prefix: XXXX-YYYY-ZZ-NNNNNN
                        const fullWithoutPrefix = parts.join('-').toUpperCase().replace(/\s+/g, '');
                        mapping[fullWithoutPrefix] = typologieBatiment;
                        
                        // First 3 segments: XXXX-YYYY-ZZ
                        const firstThree = parts.slice(0, 3).join('-').toUpperCase().replace(/\s+/g, '');
                        mapping[firstThree] = typologieBatiment;
                    } else if (parts.length >= 3) {
                        // First 3 segments: XXXX-YYYY-ZZ
                        const firstThree = parts.join('-').toUpperCase().replace(/\s+/g, '');
                        mapping[firstThree] = typologieBatiment;
                    }
                    
                    if (sampleData.length < 5) {
                        sampleData.push({ 
                            numeroAffaire, 
                            typologieBatiment, 
                            withoutPrefix: withoutPrefix,
                            parts: parts.length 
                        });
                    }
                }
            }
        }
        
        console.log('Loaded Google Sheet mapping for', Object.keys(mapping).length, 'records');
        console.log('Sample data from Google Sheet:', sampleData);
        console.log('Sample mapping keys:', Object.keys(mapping).slice(0, 20));
        
        // Test matching with a sample contract number
        if (Object.keys(mapping).length > 0) {
            const testContract = 'C-MECT-2025-20-285515';
            const testWithoutPrefix = testContract.replace(/^[PC]-/, '').trim();
            console.log('=== TESTING MATCHING ===');
            console.log('Test contract:', testContract);
            console.log('Without prefix:', testWithoutPrefix);
            console.log('Trying key:', testWithoutPrefix);
            console.log('Found?', mapping[testWithoutPrefix]);
            console.log('Trying normalized:', testWithoutPrefix.toUpperCase().replace(/\s+/g, ''));
            console.log('Found?', mapping[testWithoutPrefix.toUpperCase().replace(/\s+/g, '')]);
            console.log('Sample keys in mapping:', Object.keys(mapping).slice(0, 30));
            console.log('=== END TEST ===');
        } else {
            console.error('Mapping is empty! No data loaded from Google Sheet.');
        }
        
        return mapping;
    } catch (error) {
        console.warn('Error loading Google Sheet:', error);
        return {};
    }
}

// Get typologie batiment for a contract number
function getTypologieBatiment(contractNumber) {
    if (!contractNumber) return '-';
    
    // Remove prefix (P- or C-) and normalize - this is the main matching strategy
    const withoutPrefix = contractNumber.replace(/^[PC]-/, '').trim();
    const normalizedWithoutPrefix = withoutPrefix.toUpperCase().replace(/\s+/g, '');
    
    // Removed debug logs for performance
    
    // Try exact match without prefix first (most common case) - this is how we stored it
    if (googleSheetMapping[withoutPrefix]) {
        return googleSheetMapping[withoutPrefix];
    }
    
    // Try normalized without prefix
    if (googleSheetMapping[normalizedWithoutPrefix]) {
        return googleSheetMapping[normalizedWithoutPrefix];
    }
    
    // Try with original format
    if (googleSheetMapping[contractNumber]) {
        return googleSheetMapping[contractNumber];
    }
    
    // Try normalized with prefix
    const normalizedContract = contractNumber.toUpperCase().replace(/\s+/g, '');
    if (googleSheetMapping[normalizedContract]) {
        return googleSheetMapping[normalizedContract];
    }
    
    // Try partial match for truncated numbers
    const parts = withoutPrefix.split('-');
    if (parts.length >= 4) {
        // Try first 3 segments: XXXX-YYYY-ZZ
        const firstThree = parts.slice(0, 3).join('-').toUpperCase().replace(/\s+/g, '');
        if (googleSheetMapping[firstThree]) {
            return googleSheetMapping[firstThree];
        }
    }
    
    return '-';
}

// Export to CSV
function exportToCSV() {
    if (filteredContacts.length === 0) {
        alert('Aucun contact à exporter');
        return;
    }
    
    // Create CSV content
        const headers = ['Email', 'Prénom', 'Nom', 'Position', 'Rôle', 'Entreprise', 'Contact Interne', 'Typologie batiment', 'Date de création'];
    const rows = filteredContacts.map(contact => [
        contact.email,
        contact.firstName,
        contact.lastName,
        contact.position,
        contact.role,
        contact.company,
        contact.btpEmail,
        contact.typologieBatiment || '-',
        contact.createdAt
    ]);
    
    let csvContent = headers.join(',') + '\n';
    rows.forEach(row => {
        const escapedRow = row.map(cell => {
            // Escape quotes and wrap in quotes if contains comma or quotes
            const str = String(cell || '');
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        });
        csvContent += escapedRow.join(',') + '\n';
    });
    
    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `contacts_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Event Listeners
companySearchEl.addEventListener('input', (e) => {
    filters.company = e.target.value;
    applyFilters();
});

roleSearchEl.addEventListener('input', (e) => {
    filters.role = e.target.value;
    applyFilters();
});

positionFilterEl.addEventListener('change', (e) => {
    filters.position = e.target.value;
    applyFilters();
});

resetFiltersBtn.addEventListener('click', () => {
    companySearchEl.value = '';
    roleSearchEl.value = '';
    positionFilterEl.value = 'all';
    filters.company = '';
    filters.role = '';
    filters.position = 'all';
    activeFilters.position = null;
    activeFilters.typologie = null;
    applyFilters();
});

exportCsvBtn.addEventListener('click', exportToCSV);

// Check if we're on the commerce page
function isCommercePage() {
    return window.location.pathname.includes('commerce') || 
           window.location.href.includes('commerce');
}

// Authenticate and get data URL
async function authenticateAndGetURL() {
    const storedPassword = localStorage.getItem('roi_password');
    const isCommerce = isCommercePage();
    
    if (!storedPassword) {
        if (isCommerce) {
            // Show login modal instead of redirecting
            const loginModal = document.getElementById('login-modal');
            const loginForm = document.getElementById('login-form');
            const passwordInput = document.getElementById('password-input');
            const loginError = document.getElementById('login-error');
            const loginButton = document.getElementById('login-button');
            const loginText = document.getElementById('login-text');
            
            if (loginModal) {
                loginModal.classList.remove('hidden');
                
                // Handle form submission
                loginForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const password = passwordInput.value;
                    loginError.classList.add('hidden');
                    loginButton.disabled = true;
                    loginText.textContent = 'Connexion...';
                    
                    const success = await authenticateWithPassword(password);
                    
                    if (success) {
                        // Store password
                        localStorage.setItem('roi_password', password);
                        
                        // Hide modal
                        loginModal.classList.add('hidden');
                        
                        // Reload page to initialize with authenticated state
                        window.location.reload();
                    } else {
                        // Show error
                        loginError.classList.remove('hidden');
                        loginButton.disabled = false;
                        loginText.textContent = 'Se connecter';
                        passwordInput.value = '';
                        passwordInput.focus();
                    }
                });
                
                passwordInput.focus();
            }
            return null;
        } else {
            window.location.href = 'index.html';
            return null;
        }
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
            if (isCommerce) {
                // Show login modal again
                const loginModal = document.getElementById('login-modal');
                if (loginModal) {
                    loginModal.classList.remove('hidden');
                }
            } else {
                window.location.href = 'index.html';
            }
            return null;
        }
        
        const result = await response.text();
        const autocontactMatch = result.match(/AUTOCONTACT_URL = '([^']+)'/);
        
        // Try to get Google Sheet URL from webhook response
        const googleSheetMatch = result.match(/GOOGLE_SHEET_URL = '([^']+)'/);
        if (googleSheetMatch) {
            GOOGLE_SHEET_URL = googleSheetMatch[1];
            console.log('Google Sheet URL loaded from webhook');
        } else {
            console.log('Using default Google Sheet URL');
        }
        
        if (autocontactMatch) {
            return autocontactMatch[1];
        }
        
        if (isCommerce) {
            const loginModal = document.getElementById('login-modal');
            if (loginModal) {
                loginModal.classList.remove('hidden');
            }
        } else {
            window.location.href = 'index.html';
        }
        return null;
    } catch (error) {
        console.error('Authentication error:', error);
        if (isCommerce) {
            const loginModal = document.getElementById('login-modal');
            if (loginModal) {
                loginModal.classList.remove('hidden');
            }
        } else {
            window.location.href = 'index.html';
        }
        return null;
    }
}

// Authenticate with password (used by commerce page login form)
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
        const autocontactMatch = result.match(/AUTOCONTACT_URL = '([^']+)'/);
        
        if (autocontactMatch) {
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Authentication error:', error);
        return false;
    }
}

// Initialize
async function init() {
    try {
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
        const [dataResponse, googleSheetMappingResult] = await Promise.all([
            fetch(DATA_URL),
            loadGoogleSheetMapping()
        ]);
        
        if (!dataResponse.ok) {
            throw new Error(`HTTP error! Status: ${dataResponse.status}`);
        }
        
        googleSheetMapping = googleSheetMappingResult;
        
        const rawText = await dataResponse.text();
        console.log('Response received, length:', rawText.length);
        
        // Parse JSON array format: [{"data":"CSV content"}]
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
            console.log('JSON parsing failed:', jsonError.message);
            csvData = rawText;
        }
        
        if (!csvData) {
            throw new Error('No CSV data found');
        }
        
        allContacts = parseCSVData(csvData);
        
        if (allContacts.length === 0) {
            throw new Error('No contacts parsed');
        }

        // Pre-calculate typologie batiment for all contacts to improve performance
        console.log('Pre-calculating typologie batiment for all contacts...');
        allContacts.forEach(contact => {
            contact.typologieBatiment = getTypologieBatiment(contact.contractNumber);
        });
        console.log(`Loaded ${allContacts.length} contacts`);

        // Get available positions
        availablePositions = getAvailablePositions(allContacts);
        populatePositionFilter();

        // Initial render
        filteredContacts = [...allContacts];
        renderTable();
        updateStats();

        // Show main content
        loadingEl.classList.add('hidden');
        mainContentEl.classList.remove('hidden');
        
        // Update charts after a small delay to ensure everything is loaded
        setTimeout(() => {
            updatePositionChart();
            updateTypologieChart();
        }, 100);
    } catch (error) {
        console.error('Error loading data:', error);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }
}

// Start app
init();

