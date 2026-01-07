// Configuration
const DATA_URLS = {
    'chat-btp': 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_btpconsultants_ct.json',
    'expert-btp': 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_btpconsultants_ct.json',
    'chat-citae': 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_citae.json',
    'expert-citae': 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_citae.json'
};

// Global state
let allRecords = [];
let userGroups = []; // Grouped by user: [{email, sessions: [], stats: {}}]
let filteredUserGroups = [];
let currentIndex = 0;
let currentDataSource = 'chat-btp';

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

async function loadData() {
    try {
        loadingOverlay.classList.remove('hidden');
        
        const url = DATA_URLS[currentDataSource];
        console.log('Loading data from:', url);
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const jsonData = await response.json();
        console.log('Response received, items:', jsonData.length);
        
        allRecords = transformData(jsonData);
        
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
    
    // Populate agency filter
    const agencies = new Set();
    userGroups.forEach(userGroup => {
        userGroup.agencies.forEach(agency => {
            if (agency) agencies.add(agency);
        });
    });
    
    agencyFilterEl.innerHTML = '<option value="all">Toutes les agences</option>';
    Array.from(agencies).sort().forEach(agency => {
        const option = document.createElement('option');
        option.value = agency;
        option.textContent = agency;
        agencyFilterEl.appendChild(option);
    });
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
    
    totalSessionsEl.textContent = formatNumber(allRecords.length);
    uniqueUsersEl.textContent = formatNumber(uniqueUsers.size);
    totalMessagesEl.textContent = formatNumber(totalMessages);
    totalCostEl.textContent = formatCurrency(totalCost);
    
    // Filtered stats
    filteredUsersEl.textContent = formatNumber(filteredUserGroups.length);
    recordCounterEl.textContent = filteredUserGroups.length > 0 
        ? `Utilisateur ${currentIndex + 1} / ${filteredUserGroups.length}`
        : 'Aucun utilisateur';
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
        sessionDiv.className = 'p-3 border border-gray-200 rounded-lg hover:bg-gray-50';
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
    }
});

// ==================== INITIALIZATION ====================

// Initialize
loadData();

