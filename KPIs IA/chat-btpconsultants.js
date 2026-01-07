// Configuration
const CHAT_DATA_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_btpconsultants_ct.json';
const POPULATION_CSV_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/population_cible.csv';

// State
let allData = [];
let filteredData = [];
let availableAgencies = [];
let availableDRs = [];
let agencyPopulation = {}; // {agencyCode: effectif}
let agencyToDR = {}; // {agencyCode: DR}
let dateChart = null;
let costChart = null;
let tableSortState = {
    column: 'sessions', // Default sort by sessions
    ascending: false
};
let isCumulativeMode = false;

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
const cumulToggleEl = document.getElementById('cumul-toggle');
const drFilterEl = document.getElementById('dr-filter');
const agencyFilterEl = document.getElementById('agency-filter');
const resetFiltersBtn = document.getElementById('reset-filters');
const agencyTableBodyEl = document.getElementById('agency-table-body');

// KPI Elements
const totalUsersEl = document.getElementById('total-users');
const totalSessionsEl = document.getElementById('total-sessions');
const totalMessagesEl = document.getElementById('total-messages');
const totalCostEl = document.getElementById('total-cost');
const avgMessagesPerSessionEl = document.getElementById('avg-messages-per-session');

// Utility Functions
function parseDate(dateString) {
    if (!dateString) return null;
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return null;
        return date;
    } catch (e) {
        return null;
    }
}

function formatNumber(num) {
    return new Intl.NumberFormat('fr-FR').format(Math.round(num));
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
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
    
    // Specific fixes for known issues in the CSV
    fixed = fixed.replace(/Pyr.n.es/g, 'Pyrénées');
    fixed = fixed.replace(/Op.rationnelle/g, 'Opérationnelle');
    
    return fixed;
}

// Load population CSV to map agencies to DRs
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
                const dr = fixEncoding(parts[0].trim());
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

// Transform JSON data to our format
function transformData(jsonArray) {
    return jsonArray.map(item => {
        const metadata = item.metadata || {};
        const productionService = metadata.productionService || '';
        let management = metadata.management || '';
        
        // Fix encoding for management field
        if (management) {
            management = fixEncoding(management);
        }
        
        // Use agencyToDR mapping if management is not available
        const dr = management || (agencyToDR[productionService] || '');
        
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
            dr: dr,
            metadata: metadata
        };
    });
}

// Get current month in YYYY-MM format
function getCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
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

function filterByDR(data, dr) {
    if (!dr || dr === 'all') return data;
    return data.filter(item => item.dr === dr);
}

function filterByAgence(data, agence) {
    if (!agence || agence === 'all') return data;
    return data.filter(item => item.agency === agence);
}

// Apply all filters
function applyFilters() {
    let filtered = [...allData];
    
    // Apply month filter (skip if in cumulative mode)
    if (!isCumulativeMode) {
        filtered = filterByMonth(filtered, filters.month);
    }
    
    // Apply DR filter
    filtered = filterByDR(filtered, filters.dr);
    
    // Apply agence filter
    filtered = filterByAgence(filtered, filters.agence);
    
    filteredData = filtered;
    
    // Update KPIs
    updateKPIs();
    
    // Update table
    updateAgencyTable();
    
    // Update charts
    updateCharts();
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
        if (item.dr) {
            drs.add(item.dr);
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

// Update KPIs
function updateKPIs() {
    // Calculate unique users
    const uniqueUsers = new Set();
    filteredData.forEach(item => {
        if (item.email) {
            uniqueUsers.add(item.email);
        }
    });
    
    // Calculate total sessions (each item is a session)
    const totalSessions = filteredData.length;
    
    // Calculate total messages
    const totalMessages = filteredData.reduce((sum, item) => sum + (item.messagesLength || 0), 0);
    
    // Calculate average messages per session
    const avgMessagesPerSession = totalSessions > 0 ? (totalMessages / totalSessions).toFixed(1) : 0;
    
    // Calculate total cost
    const totalCost = filteredData.reduce((sum, item) => sum + (item.totalCostInDollars || 0), 0);
    
    // Update UI
    totalUsersEl.textContent = formatNumber(uniqueUsers.size);
    totalSessionsEl.textContent = formatNumber(totalSessions);
    totalMessagesEl.textContent = formatNumber(totalMessages);
    totalCostEl.textContent = formatCurrency(totalCost);
    if (avgMessagesPerSessionEl) {
        avgMessagesPerSessionEl.textContent = `Moyenne: ${avgMessagesPerSession} msg/session`;
    }
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
    updateAgencyTable();
}

// Make sortTable accessible globally for onclick
window.sortTable = sortTable;

// Update sort icons in table headers
function updateSortIcons() {
    const columns = ['dr', 'agency', 'users', 'usage', 'sessions', 'messages', 'cost'];
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
function updateAgencyTable() {
    // Calculate stats by agency
    const agencyStats = {};
    
    // Initialize structure for all agencies
    const initAgency = (agency, agencyCode) => {
        if (!agencyStats[agency]) {
            agencyStats[agency] = {
                users: new Set(),
                sessions: 0,
                messages: 0,
                cost: 0,
                agencyCode: agencyCode
            };
        }
    };
    
    // Count stats per agency
    filteredData.forEach(item => {
        if (!item.agency) return;
        initAgency(item.agency, item.agencyCode);
        
        if (item.email) {
            agencyStats[item.agency].users.add(item.email);
        }
        agencyStats[item.agency].sessions += 1;
        agencyStats[item.agency].messages += (item.messagesLength || 0);
        agencyStats[item.agency].cost += (item.totalCostInDollars || 0);
    });
    
    // Get list of agencies
    const agencies = Object.keys(agencyStats);
    
    // Calculate usage rate for each agency
    agencies.forEach(agency => {
        const stats = agencyStats[agency];
        const agencyCode = stats.agencyCode;
        const effectif = agencyCode ? (agencyPopulation[agencyCode] || 0) : 0;
        stats.usageRate = effectif > 0 ? (stats.users.size / effectif) * 100 : 0;
    });
    
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
            case 'users':
                compareResult = agencyStats[a].users.size - agencyStats[b].users.size;
                break;
            case 'usage':
                const usageA = agencyStats[a].usageRate || 0;
                const usageB = agencyStats[b].usageRate || 0;
                compareResult = usageA - usageB;
                break;
            case 'sessions':
                compareResult = agencyStats[a].sessions - agencyStats[b].sessions;
                break;
            case 'messages':
                compareResult = agencyStats[a].messages - agencyStats[b].messages;
                break;
            case 'cost':
                compareResult = agencyStats[a].cost - agencyStats[b].cost;
                break;
            default:
                compareResult = agencyStats[a].sessions - agencyStats[b].sessions;
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
        const users = stats.users.size;
        const sessions = stats.sessions;
        const messages = stats.messages;
        const cost = stats.cost;
        const dr = agencyCode ? agencyToDR[agencyCode] || '-' : '-';
        
        // Calculate usage rate
        const effectif = agencyCode ? (agencyPopulation[agencyCode] || 0) : 0;
        const usageRate = effectif > 0 ? (users / effectif) * 100 : 0;
        const usageRateFormatted = effectif > 0 ? `${usageRate.toFixed(1)}%` : '-';
        
        // Color coding for usage rate
        let usageRateClass = 'text-gray-500';
        let usageRateBg = '';
        if (effectif > 0) {
            if (usageRate >= 70) {
                usageRateClass = 'text-white font-bold';
                usageRateBg = 'bg-green-500';
            } else if (usageRate >= 40) {
                usageRateClass = 'text-white font-bold';
                usageRateBg = 'bg-yellow-500';
            } else {
                usageRateClass = 'text-white font-bold';
                usageRateBg = 'bg-red-500';
            }
        }
        
        const row = document.createElement('tr');
        row.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${dr}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${agency}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-center">${formatNumber(users)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-center">
                ${effectif > 0 ? `<span class="px-3 py-1 rounded-full ${usageRateBg} ${usageRateClass}">${usageRateFormatted}</span>` : '-'}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-center">${formatNumber(sessions)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-center">${formatNumber(messages)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-center">${formatCurrency(cost)}</td>
        `;
        
        agencyTableBodyEl.appendChild(row);
    });
    
    updateSortIcons();
}

// Get data for charts (filtered by DR and Agency, but not by month)
function getChartData() {
    let filtered = [...allData];
    
    // Apply DR filter
    filtered = filterByDR(filtered, filters.dr);
    
    // Apply agence filter
    filtered = filterByAgence(filtered, filters.agence);
    
    return filtered;
}

// Update date chart
function updateDateChart() {
    const data = getChartData();
    
    const monthGroups = {
        sessions: {},
        messages: {},
        users: {}
    };
    
    // Group data by month
    data.forEach((item) => {
        const date = parseDate(item.createdAt);
        if (!date) return;
        
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const monthKey = `${year}-${month}`;
        
        if (!monthGroups.sessions[monthKey]) {
            monthGroups.sessions[monthKey] = 0;
            monthGroups.messages[monthKey] = 0;
            monthGroups.users[monthKey] = new Set();
        }
        
        monthGroups.sessions[monthKey] += 1;
        monthGroups.messages[monthKey] += (item.messagesLength || 0);
        if (item.email) {
            monthGroups.users[monthKey].add(item.email);
        }
    });
    
    // Get all unique months
    const allMonths = new Set([
        ...Object.keys(monthGroups.sessions),
        ...Object.keys(monthGroups.messages)
    ]);
    
    // Sort months
    const sortedMonths = Array.from(allMonths).sort();
    
    // Format month labels (e.g., "Jan 2024")
    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const formattedLabels = sortedMonths.map(monthKey => {
        const [year, month] = monthKey.split('-');
        const monthIndex = parseInt(month) - 1;
        return `${monthNames[monthIndex]} ${year}`;
    });
    
    const sessionsData = sortedMonths.map((month) => monthGroups.sessions[month] || 0);
    const messagesData = sortedMonths.map((month) => monthGroups.messages[month] || 0);
    const usersData = sortedMonths.map((month) => (monthGroups.users[month] ? monthGroups.users[month].size : 0));
    
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
                    label: 'Nombre de sessions',
                    data: sessionsData,
                    backgroundColor: 'rgba(59, 130, 246, 0.75)',
                    borderColor: 'rgba(37, 99, 235, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverBackgroundColor: 'rgba(59, 130, 246, 0.9)',
                    hoverBorderColor: 'rgba(29, 78, 216, 1)',
                    hoverBorderWidth: 3
                },
                {
                    label: 'Nombre de messages',
                    data: messagesData,
                    backgroundColor: 'rgba(16, 185, 129, 0.75)',
                    borderColor: 'rgba(5, 150, 105, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverBackgroundColor: 'rgba(16, 185, 129, 0.9)',
                    hoverBorderColor: 'rgba(4, 120, 87, 1)',
                    hoverBorderWidth: 3
                },
                {
                    label: 'Nombre d\'utilisateurs',
                    data: usersData,
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

// Update cost chart
function updateCostChart() {
    const data = getChartData();
    
    const monthGroups = {};
    
    // Group data by month
    data.forEach((item) => {
        const date = parseDate(item.createdAt);
        if (!date) return;
        
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const monthKey = `${year}-${month}`;
        
        if (!monthGroups[monthKey]) {
            monthGroups[monthKey] = 0;
        }
        
        monthGroups[monthKey] += (item.totalCostInDollars || 0);
    });
    
    // Get all unique months
    const allMonths = Object.keys(monthGroups);
    
    // Sort months
    const sortedMonths = allMonths.sort();
    
    // Format month labels (e.g., "Jan 2024")
    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const formattedLabels = sortedMonths.map(monthKey => {
        const [year, month] = monthKey.split('-');
        const monthIndex = parseInt(month) - 1;
        return `${monthNames[monthIndex]} ${year}`;
    });
    
    const costData = sortedMonths.map((month) => monthGroups[month] || 0);
    
    // Create or update chart
    const canvas = document.getElementById('costChart');
    
    if (!canvas) {
        console.error('Canvas element "costChart" not found');
        return;
    }
    
    if (costChart) {
        costChart.destroy();
    }
    
    const ctx = canvas.getContext('2d');
    
    costChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: formattedLabels,
            datasets: [
                {
                    label: 'Coût total ($)',
                    data: costData,
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    borderColor: 'rgba(139, 92, 246, 1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBackgroundColor: 'rgba(139, 92, 246, 1)',
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
                            label += formatCurrency(context.parsed.y);
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
                    grid: {
                        color: 'rgba(229, 231, 235, 0.8)',
                        lineWidth: 1
                    },
                    title: {
                        display: true,
                        text: 'Coût ($)',
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
                            return '$' + value.toFixed(2);
                        }
                    }
                }
            }
        }
    });
}

// Update charts
function updateCharts() {
    updateDateChart();
    updateCostChart();
}

// Event Listeners
monthFilterEl.addEventListener('change', (e) => {
    filters.month = e.target.value;
    applyFilters();
});

cumulToggleEl.addEventListener('change', (e) => {
    isCumulativeMode = e.target.checked;
    applyFilters();
});

drFilterEl.addEventListener('change', (e) => {
    filters.dr = e.target.value === 'all' ? null : e.target.value;
    applyFilters();
});

agencyFilterEl.addEventListener('change', (e) => {
    filters.agence = e.target.value === 'all' ? null : e.target.value;
    applyFilters();
});

resetFiltersBtn.addEventListener('click', () => {
    monthFilterEl.value = getCurrentMonth();
    cumulToggleEl.checked = false;
    drFilterEl.value = 'all';
    agencyFilterEl.value = 'all';
    filters.month = getCurrentMonth();
    isCumulativeMode = false;
    filters.dr = null;
    filters.agence = null;
    applyFilters();
});

// Initialize
async function init() {
    try {
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');
        mainContentEl.classList.add('hidden');
        
        console.log('Fetching data from:', CHAT_DATA_URL);
        
        // Load both data sources in parallel
        const [dataResponse, populationDataResult] = await Promise.all([
            fetch(CHAT_DATA_URL),
            loadAgencyPopulation()
        ]);
        
        if (!dataResponse.ok) {
            throw new Error(`HTTP error! Status: ${dataResponse.status}`);
        }
        
        agencyPopulation = populationDataResult.population;
        agencyToDR = populationDataResult.drMapping;
        
        const jsonData = await dataResponse.json();
        console.log('Response received, items:', jsonData.length);
        
        // Transform data (agencyToDR is now available from loadAgencyPopulation)
        allData = transformData(jsonData);
        
        // Update DRs based on agencyToDR mapping if not already set
        allData.forEach(item => {
            if (!item.dr && item.agencyCode && agencyToDR[item.agencyCode]) {
                item.dr = fixEncoding(agencyToDR[item.agencyCode]);
            }
        });
        
        if (allData.length === 0) {
            throw new Error('No data parsed');
        }
        
        console.log(`Loaded ${allData.length} chat sessions`);
        
        // Get available agencies and DRs
        availableAgencies = getAvailableAgencies(allData);
        availableDRs = getAvailableDRs(allData);
        populateAgencyFilter();
        populateDRFilter();
        
        // Set default filter to current month
        const currentMonth = getCurrentMonth();
        monthFilterEl.value = currentMonth;
        filters.month = currentMonth;
        
        // Initial render
        filteredData = [...allData];
        updateKPIs();
        updateAgencyTable();
        
        // Show main content
        loadingEl.classList.add('hidden');
        mainContentEl.classList.remove('hidden');
        
        // Update charts after a small delay to ensure everything is loaded
        setTimeout(() => {
            updateCharts();
        }, 100);
        
    } catch (error) {
        console.error('Error loading data:', error);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }
}

// Start the app
init();

