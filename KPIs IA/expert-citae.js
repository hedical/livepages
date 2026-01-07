// Configuration
const EXPERT_DATA_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_citae.json';

// State
let allData = [];
let filteredData = [];
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

// Transform JSON data to our format
function transformData(jsonArray) {
    return jsonArray.map(item => {
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
            dr: management || '',
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
    const drs = getAvailableDRs(allData);
    drs.forEach((dr) => {
        const option = document.createElement('option');
        option.value = dr;
        option.textContent = dr;
        drFilterEl.appendChild(option);
    });
}

// Populate agency filter dropdown
function populateAgencyFilter() {
    agencyFilterEl.innerHTML = '<option value="all">Toutes les agences</option>';
    const agencies = getAvailableAgencies(allData);
    agencies.forEach((agency) => {
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
                    backgroundColor: 'rgba(16, 185, 129, 0.75)',
                    borderColor: 'rgba(5, 150, 105, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverBackgroundColor: 'rgba(16, 185, 129, 0.9)',
                    hoverBorderColor: 'rgba(4, 120, 87, 1)',
                    hoverBorderWidth: 3
                },
                {
                    label: 'Nombre de messages',
                    data: messagesData,
                    backgroundColor: 'rgba(34, 197, 94, 0.75)',
                    borderColor: 'rgba(22, 163, 74, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                    hoverBackgroundColor: 'rgba(34, 197, 94, 0.9)',
                    hoverBorderColor: 'rgba(20, 83, 45, 1)',
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
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    borderColor: 'rgba(34, 197, 94, 1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBackgroundColor: 'rgba(34, 197, 94, 1)',
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
        
        console.log('Fetching data from:', EXPERT_DATA_URL);
        
        const dataResponse = await fetch(EXPERT_DATA_URL);
        
        if (!dataResponse.ok) {
            throw new Error(`HTTP error! Status: ${dataResponse.status}`);
        }
        
        const jsonData = await dataResponse.json();
        console.log('Response received, items:', jsonData.length);
        
        // Transform data
        allData = transformData(jsonData);
        
        if (allData.length === 0) {
            throw new Error('No data parsed');
        }
        
        console.log(`Loaded ${allData.length} expert sessions`);
        
        // Get available agencies and DRs
        populateAgencyFilter();
        populateDRFilter();
        
        // Set default filter to current month
        const currentMonth = getCurrentMonth();
        monthFilterEl.value = currentMonth;
        filters.month = currentMonth;
        
        // Initial render
        filteredData = [...allData];
        updateKPIs();
        
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

