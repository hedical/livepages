// Configuration
const DATA_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/autocontact.json';

// State
let allContacts = [];
let filteredContacts = [];
let availablePositions = [];

// Filters
const filters = {
    company: '',
    position: 'all'
};

// DOM Elements
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const mainContentEl = document.getElementById('main-content');
const companySearchEl = document.getElementById('company-search');
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
    
    console.log('Column indices:', {
        email: emailIndex,
        role: roleIndex,
        firstName: firstNameIndex,
        lastName: lastNameIndex,
        position: positionIndex,
        company: companyIndex,
        btpEmail: btpEmailIndex,
        createdAt: createdAtIndex,
        contract: contractIndex
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
            createdAt: createdAtIndex !== -1 ? values[createdAtIndex]?.trim() || '' : ''
        };
        
        // Only add contacts with external email (not @btp-consultants.fr)
        if (contact.email && !contact.email.includes('@btp-consultants.fr')) {
            parsedData.push(contact);
        }
    }
    
    console.log(`Parsed ${parsedData.length} external contacts`);
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
        
        // Position filter (dropdown)
        if (filters.position !== 'all') {
            if (contact.position !== filters.position) return false;
        }
        
        return true;
    });
    
    renderTable();
    updateStats();
}

// Render table
function renderTable() {
    tableBodyEl.innerHTML = '';
    
    if (filteredContacts.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="8" class="px-4 py-8 text-center text-gray-500">
                Aucun contact trouvé avec les filtres actuels
            </td>
        `;
        tableBodyEl.appendChild(row);
        return;
    }
    
    filteredContacts.forEach((contact, index) => {
        const row = document.createElement('tr');
        row.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        
        row.innerHTML = `
            <td class="px-4 py-3 text-sm text-gray-900">${escapeHtml(contact.email)}</td>
            <td class="px-4 py-3 text-sm text-gray-900">${escapeHtml(contact.firstName)}</td>
            <td class="px-4 py-3 text-sm text-gray-900">${escapeHtml(contact.lastName)}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(contact.position)}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(contact.role)}</td>
            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(contact.company)}</td>
            <td class="px-4 py-3 text-sm text-blue-600">${escapeHtml(contact.btpEmail)}</td>
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

// Export to CSV
function exportToCSV() {
    if (filteredContacts.length === 0) {
        alert('Aucun contact à exporter');
        return;
    }
    
    // Create CSV content
    const headers = ['Email', 'Prénom', 'Nom', 'Position', 'Rôle', 'Entreprise', 'Contact Interne', 'Date de création'];
    const rows = filteredContacts.map(contact => [
        contact.email,
        contact.firstName,
        contact.lastName,
        contact.position,
        contact.role,
        contact.company,
        contact.btpEmail,
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

positionFilterEl.addEventListener('change', (e) => {
    filters.position = e.target.value;
    applyFilters();
});

resetFiltersBtn.addEventListener('click', () => {
    companySearchEl.value = '';
    positionFilterEl.value = 'all';
    filters.company = '';
    filters.position = 'all';
    applyFilters();
});

exportCsvBtn.addEventListener('click', exportToCSV);

// Initialize
async function init() {
    try {
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');
        mainContentEl.classList.add('hidden');

        console.log('Fetching data from:', DATA_URL);
        const response = await fetch(DATA_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const rawText = await response.text();
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
    } catch (error) {
        console.error('Error loading data:', error);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }
}

// Start app
init();

