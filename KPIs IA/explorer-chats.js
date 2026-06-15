// Configuration
const DATA_URLS = {
    'chat-btp': 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_btpconsultants_ct.json',
    'expert-btp': 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_btpconsultants_ct.json',
    'chat-citae': 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_citae.json',
    'expert-citae': 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_citae.json'
};
// Liste maître des agences (toutes filiales) — utilisée pour peupler le filtre même
// si certaines agences n'ont aucun chat dans la source sélectionnée.
const POPULATION_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/population_cible.csv';

// Global state
let allRecords = [];
let userGroups = []; // Grouped by user: [{email, sessions: [], stats: {}}]
let filteredUserGroups = [];
let currentIndex = 0;
let currentDataSource = 'chat-btp';
let allKnownAgencies = []; // toutes les agences connues (population_cible.csv) — chargée une seule fois

// Filters
let filters = {
    user: 'all',
    agency: 'all',
    sortBy: 'date-desc'
};

// DOM Elements
const loadingOverlay = document.getElementById('loading-overlay');
const summaryEl = document.getElementById('summary');
const totalSessionsEl = document.getElementById('total-sessions');
const uniqueUsersEl = document.getElementById('unique-users');
const totalMessagesEl = document.getElementById('total-messages');
const totalCostEl = document.getElementById('total-cost');
const avgMessagesPerSessionEl = document.getElementById('avg-messages-per-session');
const avgCostPerSessionEl = document.getElementById('avg-cost-per-session');
const filteredUsersEl = document.getElementById('filtered-users');
const recordCounterEl = document.getElementById('record-counter');

const dataSourceEl = document.getElementById('data-source');
const userFilterEl = document.getElementById('user-filter');
const agencyFilterEl = document.getElementById('agency-filter');
const sortByEl = document.getElementById('sort-by');
const resetFiltersBtn = document.getElementById('reset-filters');
const searchEmailInput = document.getElementById('search-email');
const searchEmailButton = document.getElementById('search-email-button');

const userDisplayEl = document.getElementById('user-display');
const emptyStateEl = document.getElementById('empty-state');
const userEmailEl = document.getElementById('user-email');
const userAgencyEl = document.getElementById('user-agency');
const userFirstSessionEl = document.getElementById('user-first-session');
const userLastSessionEl = document.getElementById('user-last-session');
const userTotalSessionsEl = document.getElementById('user-total-sessions');
const userTotalMessagesEl = document.getElementById('user-total-messages');
const userTotalCostEl = document.getElementById('user-total-cost');
const userAvgMessagesEl = document.getElementById('user-avg-messages');
const userThemesEl = document.getElementById('user-themes');
const userSessionsListEl = document.getElementById('user-sessions-list');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');

const analyticsSectionEl = document.getElementById('analytics-section');
const topUsersTableEl = document.getElementById('top-users-table');
const topFlopsTableEl = document.getElementById('top-flops-table');
let usersChart = null;

// Messages Modal Elements
const messagesModal = document.getElementById('messages-modal');
const closeMessagesModalBtn = document.getElementById('close-messages-modal');
const messagesContainer = document.getElementById('messages-container');
const messagesLoading = document.getElementById('messages-loading');
const messagesError = document.getElementById('messages-error');
const modalSessionTitle = document.getElementById('modal-session-title');

// Utility Functions
function formatDate(dateString) {
    if (!dateString) return '-';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('fr-FR', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateString;
    }
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
}

function formatNumber(num) {
    return new Intl.NumberFormat('fr-FR').format(Math.round(num));
}

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

// Extract themes from title
function extractThemes(title) {
    if (!title) return [];
    
    // Common keywords that might indicate themes
    const themeKeywords = {
        'réemploi': { label: 'Réemploi', color: 'bg-green-100 text-green-800' },
        'isolation': { label: 'Isolation', color: 'bg-blue-100 text-blue-800' },
        'chauffage': { label: 'Chauffage', color: 'bg-orange-100 text-orange-800' },
        'ventilation': { label: 'Ventilation', color: 'bg-purple-100 text-purple-800' },
        'électricité': { label: 'Électricité', color: 'bg-yellow-100 text-yellow-800' },
        'plomberie': { label: 'Plomberie', color: 'bg-cyan-100 text-cyan-800' },
        'sécurité': { label: 'Sécurité', color: 'bg-red-100 text-red-800' },
        'accessibilité': { label: 'Accessibilité', color: 'bg-pink-100 text-pink-800' },
        'réglementation': { label: 'Réglementation', color: 'bg-indigo-100 text-indigo-800' },
        'performance': { label: 'Performance', color: 'bg-teal-100 text-teal-800' },
        'bâtiment': { label: 'Bâtiment', color: 'bg-gray-100 text-gray-800' },
        'maison': { label: 'Maison', color: 'bg-gray-100 text-gray-800' },
        'appartement': { label: 'Appartement', color: 'bg-gray-100 text-gray-800' },
        'école': { label: 'École', color: 'bg-blue-100 text-blue-800' },
        'bureau': { label: 'Bureau', color: 'bg-blue-100 text-blue-800' }
    };
    
    const titleLower = title.toLowerCase();
    const foundThemes = [];
    
    for (const [keyword, theme] of Object.entries(themeKeywords)) {
        if (titleLower.includes(keyword)) {
            foundThemes.push(theme);
        }
    }
    
    // If no themes found, try to extract first few words as a general theme
    if (foundThemes.length === 0 && title.length > 0) {
        const words = title.split(' ').slice(0, 3).join(' ');
        if (words.length > 0) {
            foundThemes.push({
                label: words.length > 30 ? words.substring(0, 30) + '...' : words,
                color: 'bg-gray-100 text-gray-800'
            });
        }
    }
    
    return foundThemes;
}

// Extract all unique themes from multiple sessions
function extractAllThemes(sessions) {
    const themeMap = new Map();
    
    sessions.forEach(session => {
        const themes = extractThemes(session.title);
        themes.forEach(theme => {
            if (!themeMap.has(theme.label)) {
                themeMap.set(theme.label, theme);
            }
        });
    });
    
    return Array.from(themeMap.values());
}

// Transform JSON data to our format
function transformData(jsonArray) {
    return jsonArray.map(item => {
        const metadata = item.metadata || {};
        const productionService = metadata.productionService || '';
        
        return {
            id: item.id,
            title: item.title || 'Sans titre',
            email: item.email || '',
            createdAt: item.createdAt || '',
            updatedAt: item.updatedAt || '',
            messagesLength: item.messagesLength || item._count?.messages || 0,
            totalCostInDollars: item.totalCostInDollars || 0,
            agency: productionService || 'Non spécifié',
            agencyCode: productionService || '',
            metadata: metadata
        };
    });
}

// ==================== DATA LOADING ====================

// Charge la liste des agences depuis population_cible.csv.
// Formats supportés :
//   - JSON array Metabase : [{"DR":"...","Agence":"<CODE>","Effectif":N}, ...]
//   - CSV avec wrapper n8n "data" : data\n"DR,Agence,Effectif\n...\n"
//   - CSV brut : DR;Agence;Effectif (ou virgules)
async function loadKnownAgencies() {
    try {
        const response = await fetch(POPULATION_URL);
        if (!response.ok) {
            console.warn('Could not load population_cible.csv, status:', response.status);
            return [];
        }
        let text = await response.text();
        // Strip BOM si présent
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        const trimmed = text.trim();

        // Format 1 : JSON array direct
        if (trimmed.startsWith('[') && !trimmed.startsWith('[{"data"')) {
            try {
                const arr = JSON.parse(trimmed);
                if (Array.isArray(arr)) {
                    const set = new Set();
                    arr.forEach(row => {
                        const ag = row.Agence || row.agence || row.AGENCE;
                        if (ag && typeof ag === 'string') set.add(ag.trim());
                    });
                    return Array.from(set).sort();
                }
            } catch (_) { /* fall through to CSV */ }
        }

        // Format 2 : wrapper n8n "data\n\"...\""
        let csvBody = text;
        const lines0 = text.split('\n');
        if (lines0.length > 0 && lines0[0].trim() === 'data') {
            const inner = lines0.slice(1);
            if (inner.length && inner[0].startsWith('"')) inner[0] = inner[0].substring(1);
            const last = inner.length - 1;
            if (last >= 0) {
                if (inner[last].trim() === '"') inner.pop();
                else if (inner[last].endsWith('"')) inner[last] = inner[last].slice(0, -1);
            }
            csvBody = inner.join('\n');
        }

        // Format 3 : CSV brut (avec header sur ligne 0)
        const lines = csvBody.split('\n').filter(l => l.trim() !== '');
        if (lines.length < 2) return [];
        const separator = lines[0].includes(';') ? ';' : ',';
        const set = new Set();
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(separator);
            if (parts.length >= 2) {
                const ag = parts[1].trim();
                if (ag && ag.toLowerCase() !== 'agence') set.add(ag);
            }
        }
        return Array.from(set).sort();
    } catch (e) {
        console.warn('Failed to load population_cible.csv:', e);
        return [];
    }
}

async function loadData() {
    try {
        loadingOverlay.classList.remove('hidden');

        // Charge la liste maître des agences en parallèle (1 seule fois, mis en cache)
        const knownAgenciesPromise = allKnownAgencies.length === 0
            ? loadKnownAgencies()
            : Promise.resolve(allKnownAgencies);

        const url = DATA_URLS[currentDataSource];
        console.log('Loading data from:', url);

        const [response, knownAgencies] = await Promise.all([
            fetch(url),
            knownAgenciesPromise,
        ]);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const jsonData = await response.json();
        console.log('Response received, items:', jsonData.length);

        allRecords = transformData(jsonData);
        allKnownAgencies = knownAgencies;
        console.log(`Loaded ${allKnownAgencies.length} known agencies from population_cible.csv`);

        if (allRecords.length === 0) {
            throw new Error('No data parsed');
        }

        console.log(`Loaded ${allRecords.length} chat sessions`);

        // Group by user
        groupByUser();

        populateFilters();
        applyFilters();
        updateSummary();

        loadingOverlay.classList.add('hidden');
    } catch (error) {
        console.error('Error loading data:', error);
        loadingOverlay.classList.add('hidden');
        alert('Erreur lors du chargement des données: ' + error.message);
    }
}

// ==================== GROUP BY USER ====================

function groupByUser() {
    const userMap = new Map();
    
    allRecords.forEach(record => {
        if (!record.email) return;
        
        if (!userMap.has(record.email)) {
            userMap.set(record.email, {
                email: record.email,
                sessions: [],
                agencies: new Set()
            });
        }
        
        const userGroup = userMap.get(record.email);
        userGroup.sessions.push(record);
        if (record.agency) {
            userGroup.agencies.add(record.agency);
        }
    });
    
    // Convert to array and calculate stats
    userGroups = Array.from(userMap.values()).map(userGroup => {
        const sessions = userGroup.sessions;
        const totalMessages = sessions.reduce((sum, s) => sum + (s.messagesLength || 0), 0);
        const totalCost = sessions.reduce((sum, s) => sum + (s.totalCostInDollars || 0), 0);
        const avgMessages = sessions.length > 0 ? (totalMessages / sessions.length).toFixed(1) : 0;
        
        // Sort sessions by date
        sessions.sort((a, b) => parseDate(b.createdAt) - parseDate(a.createdAt));
        
        const firstSession = sessions[sessions.length - 1];
        const lastSession = sessions[0];
        
        return {
            email: userGroup.email,
            sessions: sessions,
            agencies: Array.from(userGroup.agencies),
            stats: {
                totalSessions: sessions.length,
                totalMessages: totalMessages,
                totalCost: totalCost,
                avgMessages: avgMessages,
                firstSessionDate: firstSession?.createdAt || null,
                lastSessionDate: lastSession?.createdAt || null
            }
        };
    });
}

// ==================== FILTER POPULATION ====================

function populateFilters() {
    // Populate user filter
    userFilterEl.innerHTML = '<option value="all">Tous les utilisateurs</option>';
    userGroups.sort((a, b) => a.email.localeCompare(b.email)).forEach(userGroup => {
        const option = document.createElement('option');
        option.value = userGroup.email;
        option.textContent = userGroup.email;
        userFilterEl.appendChild(option);
    });

    // Agences avec au moins 1 chat dans la source actuelle
    const agenciesWithChats = new Set();
    userGroups.forEach(userGroup => {
        userGroup.agencies.forEach(agency => {
            if (agency && agency !== 'Non spécifié') agenciesWithChats.add(agency);
        });
    });

    // Union avec la liste maître (population_cible.csv) — comme ça toutes les
    // agences connues sont sélectionnables, même celles sans chat dans la source.
    const unionAgencies = new Set([...agenciesWithChats, ...allKnownAgencies]);
    const sortedAgencies = Array.from(unionAgencies).sort();

    agencyFilterEl.innerHTML = '<option value="all">Toutes les agences</option>';
    sortedAgencies.forEach(agency => {
        const option = document.createElement('option');
        option.value = agency;
        // Marque visuellement les agences qui n'ont aucun chat dans la source actuelle
        const hasChats = agenciesWithChats.has(agency);
        option.textContent = hasChats ? agency : `${agency} (0)`;
        agencyFilterEl.appendChild(option);
    });

    // Si des records ont une agence "Non spécifié", l'ajouter en fin de liste
    const hasNonSpec = userGroups.some(ug => ug.agencies.includes('Non spécifié'));
    if (hasNonSpec) {
        const option = document.createElement('option');
        option.value = 'Non spécifié';
        option.textContent = 'Non spécifié';
        agencyFilterEl.appendChild(option);
    }
}

// ==================== FILTERING & SORTING ====================

function applyFilters() {
    filteredUserGroups = userGroups.filter(userGroup => {
        // User filter
        if (filters.user !== 'all' && userGroup.email !== filters.user) return false;
        
        // Agency filter
        if (filters.agency !== 'all' && !userGroup.agencies.includes(filters.agency)) return false;
        
        return true;
    });
    
    // Apply sorting
    filteredUserGroups.sort((a, b) => {
        switch (filters.sortBy) {
            case 'date-desc':
                return parseDate(b.stats.lastSessionDate) - parseDate(a.stats.lastSessionDate);
            case 'date-asc':
                return parseDate(a.stats.lastSessionDate) - parseDate(b.stats.lastSessionDate);
            case 'messages-desc':
                return b.stats.totalMessages - a.stats.totalMessages;
            case 'messages-asc':
                return a.stats.totalMessages - b.stats.totalMessages;
            case 'cost-desc':
                return b.stats.totalCost - a.stats.totalCost;
            case 'cost-asc':
                return a.stats.totalCost - b.stats.totalCost;
            default:
                return 0;
        }
    });
    
    currentIndex = 0;
    updateSummary();
    showUser();
}

// ==================== SUMMARY UPDATE ====================

function updateSummary() {
    // Total stats
    const uniqueUsers = new Set();
    let totalMessages = 0;
    let totalCost = 0;
    
    allRecords.forEach(rec => {
        if (rec.email) uniqueUsers.add(rec.email);
        totalMessages += rec.messagesLength || 0;
        totalCost += rec.totalCostInDollars || 0;
    });
    
    const totalSessions = allRecords.length;
    const avgMessagesPerSession = totalSessions > 0 ? (totalMessages / totalSessions) : 0;
    const avgCostPerSession = totalSessions > 0 ? (totalCost / totalSessions) : 0;
    
    totalSessionsEl.textContent = formatNumber(totalSessions);
    uniqueUsersEl.textContent = formatNumber(uniqueUsers.size);
    totalMessagesEl.textContent = formatNumber(totalMessages);
    totalCostEl.textContent = formatCurrency(totalCost);
    avgMessagesPerSessionEl.textContent = avgMessagesPerSession.toFixed(1);
    avgCostPerSessionEl.textContent = formatCurrency(avgCostPerSession);
    
    // Filtered stats
    filteredUsersEl.textContent = formatNumber(filteredUserGroups.length);
    recordCounterEl.textContent = filteredUserGroups.length > 0 
        ? `Utilisateur ${currentIndex + 1} / ${filteredUserGroups.length}`
        : 'Aucun utilisateur';
    
    // Update analytics section
    updateAnalytics();
}

// ==================== ANALYTICS SECTION ====================

function updateAnalytics() {
    if (userGroups.length === 0) {
        analyticsSectionEl.classList.add('hidden');
        return;
    }
    
    analyticsSectionEl.classList.remove('hidden');
    
    // Calculate top users and flops
    const sortedUsers = [...userGroups].sort((a, b) => {
        // Sort by total messages (or could use totalCost, totalSessions, etc.)
        return b.stats.totalMessages - a.stats.totalMessages;
    });
    
    const topUsers = sortedUsers.slice(0, 10);
    const topFlops = sortedUsers.slice(-10).reverse();
    
    // Update top users table
    topUsersTableEl.innerHTML = '';
    topUsers.forEach((userGroup, index) => {
        const row = document.createElement('tr');
        row.className = index % 2 === 0 ? 'bg-gray-50' : '';
        row.innerHTML = `
            <td class="py-2 px-2 font-semibold text-gray-700">${index + 1}</td>
            <td class="py-2 px-2 text-gray-900" title="${userGroup.email}">${truncateEmail(userGroup.email, 25)}</td>
            <td class="py-2 px-2 text-right text-gray-700">${formatNumber(userGroup.stats.totalSessions)}</td>
            <td class="py-2 px-2 text-right text-gray-700">${formatNumber(userGroup.stats.totalMessages)}</td>
            <td class="py-2 px-2 text-right text-gray-700">${formatCurrency(userGroup.stats.totalCost)}</td>
        `;
        topUsersTableEl.appendChild(row);
    });
    
    // Update top flops table
    topFlopsTableEl.innerHTML = '';
    topFlops.forEach((userGroup, index) => {
        const row = document.createElement('tr');
        row.className = index % 2 === 0 ? 'bg-gray-50' : '';
        row.innerHTML = `
            <td class="py-2 px-2 font-semibold text-gray-700">${index + 1}</td>
            <td class="py-2 px-2 text-gray-900" title="${userGroup.email}">${truncateEmail(userGroup.email, 25)}</td>
            <td class="py-2 px-2 text-right text-gray-700">${formatNumber(userGroup.stats.totalSessions)}</td>
            <td class="py-2 px-2 text-right text-gray-700">${formatNumber(userGroup.stats.totalMessages)}</td>
            <td class="py-2 px-2 text-right text-gray-700">${formatCurrency(userGroup.stats.totalCost)}</td>
        `;
        topFlopsTableEl.appendChild(row);
    });
    
    // Update chart
    updateUsersChart(sortedUsers.slice(0, 15)); // Show top 15 for better visualization
}

function truncateEmail(email, maxLength) {
    if (!email) return 'Non spécifié';
    if (email.length <= maxLength) return email;
    return email.substring(0, maxLength - 3) + '...';
}

function updateUsersChart(userGroups) {
    const ctx = document.getElementById('users-chart');
    if (!ctx) return;
    
    // Destroy existing chart if it exists
    if (usersChart) {
        usersChart.destroy();
    }
    
    // Prepare data for chart (top users by messages)
    const labels = userGroups.map((ug, i) => `#${i + 1}`);
    const messagesData = userGroups.map(ug => ug.stats.totalMessages);
    const costData = userGroups.map(ug => ug.stats.totalCost);
    const sessionsData = userGroups.map(ug => ug.stats.totalSessions);
    const emails = userGroups.map(ug => ug.email || 'Non spécifié');
    
    usersChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Messages',
                    data: messagesData,
                    backgroundColor: 'rgba(59, 130, 246, 0.6)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1,
                    yAxisID: 'y'
                },
                {
                    label: 'Sessions',
                    data: sessionsData,
                    backgroundColor: 'rgba(139, 92, 246, 0.6)',
                    borderColor: 'rgba(139, 92, 246, 1)',
                    borderWidth: 1,
                    yAxisID: 'y'
                },
                {
                    label: 'Coût ($)',
                    data: costData,
                    backgroundColor: 'rgba(16, 185, 129, 0.6)',
                    borderColor: 'rgba(16, 185, 129, 1)',
                    borderWidth: 1,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            const dataIndex = context[0].dataIndex;
                            return emails[dataIndex];
                        },
                        label: function(context) {
                            if (context.datasetIndex === 0) {
                                return `Messages: ${formatNumber(context.parsed.y)}`;
                            } else if (context.datasetIndex === 1) {
                                return `Sessions: ${formatNumber(context.parsed.y)}`;
                            } else {
                                return `Coût: ${formatCurrency(context.parsed.y)}`;
                            }
                        }
                    }
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Messages / Sessions'
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Coût ($)'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        }
    });
}

// ==================== USER DISPLAY ====================

function showUser() {
    if (filteredUserGroups.length === 0) {
        userDisplayEl.classList.add('hidden');
        emptyStateEl.classList.remove('hidden');
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }
    
    emptyStateEl.classList.add('hidden');
    userDisplayEl.classList.remove('hidden');
    
    const userGroup = filteredUserGroups[currentIndex];
    const stats = userGroup.stats;
    
    // Update user info
    userEmailEl.textContent = userGroup.email || 'Non spécifié';
    userAgencyEl.textContent = userGroup.agencies.length > 0 
        ? userGroup.agencies.join(', ')
        : 'Non spécifié';
    userFirstSessionEl.textContent = `Première session: ${formatDate(stats.firstSessionDate)}`;
    userLastSessionEl.textContent = `Dernière session: ${formatDate(stats.lastSessionDate)}`;
    
    // Update stats
    userTotalSessionsEl.textContent = formatNumber(stats.totalSessions);
    userTotalMessagesEl.textContent = formatNumber(stats.totalMessages);
    userTotalCostEl.textContent = formatCurrency(stats.totalCost);
    userAvgMessagesEl.textContent = stats.avgMessages;
    
    // Update themes (all themes from all sessions)
    const allThemes = extractAllThemes(userGroup.sessions);
    userThemesEl.innerHTML = '';
    if (allThemes.length > 0) {
        allThemes.forEach(theme => {
            const tag = document.createElement('span');
            tag.className = `theme-tag ${theme.color}`;
            tag.textContent = theme.label;
            userThemesEl.appendChild(tag);
        });
    } else {
        const noTheme = document.createElement('span');
        noTheme.className = 'text-sm text-gray-500 italic';
        noTheme.textContent = 'Aucun thème identifié';
        userThemesEl.appendChild(noTheme);
    }
    
    // Update sessions list
    userSessionsListEl.innerHTML = '';
    userGroup.sessions.forEach((session, index) => {
        const sessionDiv = document.createElement('div');
        sessionDiv.className = 'p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors';
        sessionDiv.innerHTML = `
            <div class="flex items-start justify-between">
                <div class="flex-1">
                    <p class="font-medium text-gray-900">${session.title || 'Sans titre'}</p>
                    <div class="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                        <span>${formatDate(session.createdAt)}</span>
                        <span>•</span>
                        <span>${formatNumber(session.messagesLength || 0)} messages</span>
                        <span>•</span>
                        <span>${formatCurrency(session.totalCostInDollars || 0)}</span>
                        ${session.agency ? `<span>•</span><span>${session.agency}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
        // Add click handler to open messages modal
        sessionDiv.addEventListener('click', () => {
            openMessagesModal(session);
        });
        userSessionsListEl.appendChild(sessionDiv);
    });
    
    // Update navigation buttons
    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = currentIndex === filteredUserGroups.length - 1;
    
    updateSummary();
}

// ==================== EVENT LISTENERS ====================

dataSourceEl.addEventListener('change', (e) => {
    currentDataSource = e.target.value;
    loadData();
});

userFilterEl.addEventListener('change', (e) => {
    filters.user = e.target.value;
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
    filters.user = 'all';
    filters.agency = 'all';
    filters.sortBy = 'date-desc';
    userFilterEl.value = 'all';
    agencyFilterEl.value = 'all';
    sortByEl.value = 'date-desc';
    searchEmailInput.value = '';
    applyFilters();
});

searchEmailButton.addEventListener('click', () => {
    const email = searchEmailInput.value.trim();
    if (email) {
        filters.user = email;
        userFilterEl.value = email;
        applyFilters();
    }
});

prevBtn.addEventListener('click', () => {
    if (currentIndex > 0) {
        currentIndex--;
        showUser();
    }
});

nextBtn.addEventListener('click', () => {
    if (currentIndex < filteredUserGroups.length - 1) {
        currentIndex++;
        showUser();
    }
});

// Keyboard navigation
document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && !prevBtn.disabled) {
        prevBtn.click();
    } else if (e.key === 'ArrowRight' && !nextBtn.disabled) {
        nextBtn.click();
    } else if (e.key === 'Escape' && !messagesModal.classList.contains('hidden')) {
        closeMessagesModal();
    }
});

// ==================== MESSAGES MODAL ====================

const MESSAGES_WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/getMessages';

// Escape HTML to prevent XSS
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Format markdown-like text (simple formatting)
function formatMessageText(text) {
    if (!text) return '';
    
    const placeholders = [];
    let placeholderIndex = 0;
    
    // First, protect HTML tables and links from escaping
    const htmlTableRegex = /<table[\s\S]*?<\/table>/gi;
    text = text.replace(htmlTableRegex, (match) => {
        const placeholder = `__PLACEHOLDER_${placeholderIndex}__`;
        placeholders[placeholderIndex] = match;
        placeholderIndex++;
        return placeholder;
    });
    
    // Protect HTML links
    const htmlLinkRegex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
    text = text.replace(htmlLinkRegex, (match) => {
        const placeholder = `__PLACEHOLDER_${placeholderIndex}__`;
        placeholders[placeholderIndex] = match;
        placeholderIndex++;
        return placeholder;
    });
    
    // Process markdown tables BEFORE escaping (format: | col1 | col2 |)
    // Match multi-line tables with separator row
    const markdownTableRegex = /(\|[^\n]+\|\s*\n\|[\s\-:|]+\|\s*\n(?:\|[^\n]+\|\s*\n?)+)/g;
    text = text.replace(markdownTableRegex, (match) => {
        const placeholder = `__PLACEHOLDER_${placeholderIndex}__`;
        const lines = match.trim().split('\n').filter(l => l.trim());
        if (lines.length < 2) return match;
        
        let html = '<div class="overflow-x-auto my-4"><table class="min-w-full border border-gray-300 text-sm">';
        
        // Process header row (first line)
        const headerLine = lines[0];
        if (headerLine.includes('|')) {
            const headers = headerLine.split('|').map(h => h.trim()).filter(h => h);
            html += '<thead><tr class="bg-gray-100">';
            headers.forEach(header => {
                // Escape HTML in header but preserve markdown
                let headerContent = escapeHtml(header);
                headerContent = headerContent.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
                headerContent = headerContent.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
                html += `<th class="border border-gray-300 px-4 py-2 text-left font-semibold">${headerContent}</th>`;
            });
            html += '</tr></thead>';
        }
        
        // Process data rows (skip separator row at index 1)
        html += '<tbody>';
        for (let i = 2; i < lines.length; i++) {
            const line = lines[i];
            // Skip separator rows (like |---|---|)
            if (line.match(/^\|[\s\-:|]+\|$/)) continue;
            
            if (line.includes('|')) {
                const cells = line.split('|').map(c => c.trim()).filter(c => c);
                html += '<tr>';
                cells.forEach(cell => {
                    // Escape HTML in cell but preserve markdown
                    let cellContent = escapeHtml(cell);
                    cellContent = cellContent.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
                    cellContent = cellContent.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
                    // Process links in cells
                    cellContent = cellContent.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-800 underline">$1</a>');
                    html += `<td class="border border-gray-300 px-4 py-2">${cellContent}</td>`;
                });
                html += '</tr>';
            }
        }
        html += '</tbody></table></div>';
        
        placeholders[placeholderIndex] = html;
        placeholderIndex++;
        return placeholder;
    });
    
    // Process markdown links [text](url) BEFORE escaping
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
        const placeholder = `__PLACEHOLDER_${placeholderIndex}__`;
        const escapedText = escapeHtml(linkText);
        const escapedUrl = escapeHtml(url);
        placeholders[placeholderIndex] = `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-800 underline">${escapedText}</a>`;
        placeholderIndex++;
        return placeholder;
    });
    
    // Now escape HTML for the rest
    let formatted = escapeHtml(text);
    
    // Restore all placeholders
    placeholders.forEach((html, index) => {
        formatted = formatted.replace(`__PLACEHOLDER_${index}__`, html);
    });
    
    // Protect HTML blocks (tables, divs) before line-by-line processing
    const htmlBlockPlaceholders = [];
    let htmlBlockIndex = 0;
    const htmlBlockRegex = /(<div[^>]*class="overflow-x-auto"[^>]*>[\s\S]*?<\/div>|<table[\s\S]*?<\/table>)/gi;
    formatted = formatted.replace(htmlBlockRegex, (match) => {
        const placeholder = `__HTML_BLOCK_${htmlBlockIndex}__`;
        htmlBlockPlaceholders[htmlBlockIndex] = match;
        htmlBlockIndex++;
        return placeholder;
    });
    
    // Process line by line to handle lists properly
    const lines = formatted.split('\n');
    const processedLines = [];
    let inList = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip if it's an HTML block placeholder (will be restored later)
        if (line.includes('__HTML_BLOCK_')) {
            processedLines.push(line);
            continue;
        }
        
        const isListItem = /^[-•*]\s+(.+)$/.test(line);
        
        if (isListItem) {
            if (!inList) {
                processedLines.push('<ul class="list-disc ml-4 my-2 space-y-1">');
                inList = true;
            }
            const content = line.replace(/^[-•*]\s+/, '');
            // Process markdown in list items
            let itemContent = content;
            itemContent = itemContent.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
            itemContent = itemContent.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
            itemContent = itemContent.replace(/`([^`]+)`/g, '<code class="bg-gray-200 px-1 py-0.5 rounded text-xs font-mono">$1</code>');
            processedLines.push(`<li>${itemContent}</li>`);
        } else {
            if (inList) {
                processedLines.push('</ul>');
                inList = false;
            }
            processedLines.push(line);
        }
    }
    
    if (inList) {
        processedLines.push('</ul>');
    }
    
    formatted = processedLines.join('\n');
    
    // Restore HTML blocks
    htmlBlockPlaceholders.forEach((html, index) => {
        formatted = formatted.replace(`__HTML_BLOCK_${index}__`, html);
    });
    
    // Headers ###
    formatted = formatted.replace(/^### (.+)$/gm, '<h3 class="font-bold text-base mt-4 mb-2">$1</h3>');
    formatted = formatted.replace(/^## (.+)$/gm, '<h2 class="font-bold text-lg mt-4 mb-2">$1</h2>');
    formatted = formatted.replace(/^# (.+)$/gm, '<h1 class="font-bold text-xl mt-4 mb-2">$1</h1>');
    
    // Bold **text** (non-greedy, handle multiple) - do this after lists to avoid breaking HTML
    formatted = formatted.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    
    // Italic *text* (but not if it's part of **)
    formatted = formatted.replace(/(?<!\*)\*([^*\n<>]+?)\*(?!\*)/g, '<em>$1</em>');

    // Code `text` (but not inside HTML tags)
    formatted = formatted.replace(/(?<!`|>|")`([^`]+)`(?!`|<|")/g, '<code class="bg-gray-200 px-1 py-0.5 rounded text-sm font-mono">$1</code>');
    
    // Line breaks (but preserve existing <br> from lists and headers, and don't break tables)
    formatted = formatted.replace(/\n/g, (match, offset, string) => {
        // Don't add <br> if we're inside a table or other block element
        const before = string.substring(Math.max(0, offset - 50), offset);
        const after = string.substring(offset, Math.min(string.length, offset + 50));
        if (before.includes('<table') && !before.includes('</table>')) return '\n';
        if (before.includes('<div') && after.includes('</div>')) return '\n';
        return '<br>';
    });
    
    return formatted;
}

// Load messages from webhook
async function loadMessages(chatId, userEmail) {
    try {
        messagesLoading.classList.remove('hidden');
        messagesContainer.classList.add('hidden');
        messagesError.classList.add('hidden');
        
        const response = await fetch(MESSAGES_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id: chatId })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Response received:', data);
        console.log('Response type:', typeof data);
        console.log('Is array?', Array.isArray(data));
        
        // Handle different response formats
        let messages;
        if (Array.isArray(data)) {
            // Direct array of messages (expected format)
            messages = data;
        } else if (data.messages && Array.isArray(data.messages)) {
            messages = data.messages;
        } else if (data.data && Array.isArray(data.data)) {
            messages = data.data;
        } else if (data.body && Array.isArray(data.body)) {
            messages = data.body;
        } else if (data && typeof data === 'object' && data.role) {
            // Single message object - convert to array
            console.warn('⚠️ ATTENTION: Le webhook n8n renvoie un seul message au lieu d\'un tableau de tous les messages.');
            console.warn('Le webhook devrait renvoyer un tableau de messages pour ce chatId.');
            console.warn('Vérifiez la configuration n8n pour s\'assurer qu\'il renvoie TOUS les messages du chat.');
            messages = [data];
        } else {
            console.error('Unexpected response format:', data);
            throw new Error('Format de réponse inattendu du webhook');
        }
        
        console.log('Messages extracted:', messages.length);
        if (messages.length === 1) {
            console.warn('⚠️ Seul 1 message reçu. Le webhook devrait renvoyer tous les messages du chat.');
        }
        console.log('Messages:', messages);
        
        displayMessages(messages, userEmail);
        
        messagesLoading.classList.add('hidden');
        messagesContainer.classList.remove('hidden');
    } catch (error) {
        console.error('Error loading messages:', error);
        messagesLoading.classList.add('hidden');
        messagesError.classList.remove('hidden');
        messagesError.innerHTML = `<p class="text-red-600">Erreur lors du chargement des messages: ${error.message}</p>`;
    }
}

// Display messages in modal
function displayMessages(messages, userEmail) {
    messagesContainer.innerHTML = '';
    
    if (!messages || messages.length === 0) {
        messagesContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Aucun message trouvé</p>';
        return;
    }
    
    // Warn if only one message (should be multiple)
    if (messages.length === 1) {
        const warningDiv = document.createElement('div');
        warningDiv.className = 'mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg';
        warningDiv.innerHTML = `
            <p class="text-sm text-yellow-800">
                <strong>⚠️ Attention :</strong> Seul 1 message a été reçu. 
                Le webhook n8n devrait renvoyer tous les messages de cette conversation.
                Vérifiez la configuration du workflow n8n.
            </p>
        `;
        messagesContainer.appendChild(warningDiv);
    }
    
    // Ensure messages is an array
    if (!Array.isArray(messages)) {
        console.error('Messages is not an array:', messages);
        messagesContainer.innerHTML = '<p class="text-red-500 text-center py-8">Erreur: Les messages ne sont pas dans un format valide</p>';
        return;
    }
    
    // Sort messages by createdAt date
    const sortedMessages = [...messages].sort((a, b) => {
        const dateA = parseDate(a.createdAt);
        const dateB = parseDate(b.createdAt);
        if (!dateA || !dateB) return 0;
        return dateA - dateB;
    });
    
    console.log('Displaying', sortedMessages.length, 'messages');
    
    sortedMessages.forEach((message, index) => {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'mb-6';
        
        const isUser = message.role === 'USER';
        const isAssistant = message.role === 'ASSISTANT';
        
        if (isUser) {
            // User message - right aligned, blue
            messageDiv.className += ' flex justify-end';
            const userMessageDiv = document.createElement('div');
            userMessageDiv.className = 'max-w-[80%] bg-blue-600 text-white rounded-lg p-4 shadow-sm';
            
            let userContent = '';
            if (message.parts && Array.isArray(message.parts)) {
                const textParts = message.parts.filter(p => p.type === 'text');
                userContent = textParts.map(p => p.text || '').join('') || message.content || '';
            } else {
                userContent = message.content || '';
            }
            
            // Use user email if available, otherwise fallback to "Vous"
            const displayName = userEmail || 'Vous';
            
            userMessageDiv.innerHTML = `
                <div class="text-xs text-blue-100 mb-2 font-medium">${escapeHtml(displayName)}</div>
                <div class="text-sm leading-relaxed">${formatMessageText(userContent)}</div>
                <div class="text-xs text-blue-200 mt-2 opacity-75">${formatDate(message.createdAt)}</div>
            `;
            messageDiv.appendChild(userMessageDiv);
        } else if (isAssistant) {
            // Assistant message - left aligned, gray
            messageDiv.className += ' flex justify-start';
            const assistantMessageDiv = document.createElement('div');
            assistantMessageDiv.className = 'max-w-[80%] bg-gray-100 text-gray-900 rounded-lg p-4 shadow-sm';
            
            let contentHtml = '';
            
            // Process parts
            if (message.parts && Array.isArray(message.parts)) {
                message.parts.forEach((part, partIndex) => {
                    if (part.type === 'step-start') {
                        // Skip step-start markers
                        return;
                    } else if (part.type === 'reasoning') {
                        // Reasoning part - collapsible
                        const reasoningId = `reasoning-${message.id}-${partIndex}`;
                        const reasoningText = part.text || '';
                        const isExpanded = false; // Start collapsed
                        
                        contentHtml += `
                            <div class="mt-2 border-t border-gray-300 pt-2">
                                <button 
                                    onclick="toggleReasoning('${reasoningId}')" 
                                    class="w-full text-left text-xs text-gray-600 hover:text-gray-900 flex items-center justify-between py-1"
                                >
                                    <span>💭 Raisonnement (cliquez pour développer)</span>
                                    <svg id="icon-${reasoningId}" class="w-4 h-4 transform transition-transform -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>
                                <div id="${reasoningId}" class="hidden mt-2 text-xs text-gray-600 bg-gray-50 p-3 rounded border border-gray-200 whitespace-pre-wrap max-h-96 overflow-y-auto reasoning-text">
                                    ${formatMessageText(reasoningText)}
                                </div>
                            </div>
                        `;
                    } else if (part.type === 'text') {
                        // Regular text part
                        const textContent = part.text || '';
                        if (textContent.trim()) {
                            contentHtml += `<div class="text-sm">${formatMessageText(textContent)}</div>`;
                        }
                    }
                });
            } else {
                // Fallback to content if no parts
                const fallbackContent = message.content || '';
                if (fallbackContent.trim()) {
                    contentHtml = `<div class="text-sm">${formatMessageText(fallbackContent)}</div>`;
                } else {
                    contentHtml = '<div class="text-sm text-gray-500 italic">Message vide</div>';
                }
            }
            
            assistantMessageDiv.innerHTML = `
                <div class="text-xs text-gray-600 mb-2 font-medium">Assistant</div>
                <div class="leading-relaxed">${contentHtml}</div>
                <div class="text-xs text-gray-500 mt-2 opacity-75">${formatDate(message.createdAt)}</div>
            `;
            messageDiv.appendChild(assistantMessageDiv);
        }
        
        messagesContainer.appendChild(messageDiv);
    });
}

// Toggle reasoning visibility
window.toggleReasoning = function(reasoningId) {
    const reasoningDiv = document.getElementById(reasoningId);
    const iconDiv = document.getElementById(`icon-${reasoningId}`);
    const button = iconDiv?.closest('button');
    
    if (reasoningDiv && iconDiv && button) {
        const isHidden = reasoningDiv.classList.contains('hidden');
        const buttonText = button.querySelector('span');
        
        if (isHidden) {
            reasoningDiv.classList.remove('hidden');
            iconDiv.classList.remove('-rotate-90');
            if (buttonText) {
                buttonText.textContent = '💭 Raisonnement (cliquez pour réduire)';
            }
        } else {
            reasoningDiv.classList.add('hidden');
            iconDiv.classList.add('-rotate-90');
            if (buttonText) {
                buttonText.textContent = '💭 Raisonnement (cliquez pour développer)';
            }
        }
    }
};

// Open messages modal
function openMessagesModal(session) {
    modalSessionTitle.textContent = session.title || 'Conversation';
    messagesModal.classList.remove('hidden');
    // Pass user email to loadMessages so it can be used in displayMessages
    loadMessages(session.id, session.email);
}

// Close messages modal
function closeMessagesModal() {
    messagesModal.classList.add('hidden');
    messagesContainer.innerHTML = '';
    messagesLoading.classList.remove('hidden');
    messagesContainer.classList.add('hidden');
    messagesError.classList.add('hidden');
}

// Event listeners for modal
if (closeMessagesModalBtn) {
    closeMessagesModalBtn.addEventListener('click', closeMessagesModal);
}

if (messagesModal) {
    // Close modal on background click
    messagesModal.addEventListener('click', (e) => {
        if (e.target === messagesModal) {
            closeMessagesModal();
        }
    });
}

// ==================== INITIALIZATION ====================

// Initialize
loadData();

