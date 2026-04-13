// ==================== CONFIGURATION ====================
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordROI';
let DATA_URL = '';

// Parameters
let parameters = {
    hoursPerPoint: 0.02816,
    annualHours: 1607,
    revenuePerUser: 150000   // Production annuelle par collaborateur (€)
};

// Emails exclus de toutes les statistiques
const EXCLUDED_EMAILS = ['roland.vrignon@btp-consultants.fr'];

// State
let allData = [];
let isCumulativeMode = false;
let filters = { startDate: null, endDate: null, controlName: 'all' };
let userSortState = { column: 'points', ascending: false };

// ==================== DOM ELEMENTS ====================
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const mainContentEl = document.getElementById('main-content');
const startDateEl = document.getElementById('start-date-filter');
const endDateEl = document.getElementById('end-date-filter');
const cumulToggleEl = document.getElementById('cumul-toggle');
const controlFilterEl = document.getElementById('control-filter');
const resetFiltersBtn = document.getElementById('reset-filters');
const firstDateTextEl = document.getElementById('first-date-text');

// KPI elements
const totalUsersEl = document.getElementById('total-users');
const totalControlsEl = document.getElementById('total-controls');
const totalPointsEl = document.getElementById('total-points');
const totalProjectsEl = document.getElementById('total-projects');

// Gain elements
const gainTimeEl = document.getElementById('gain-time');
const gainTimeFormulaEl = document.getElementById('gain-time-formula');
const gainTimeMaxEl = document.getElementById('gain-time-max');
const gainTimeProjectionEl = document.getElementById('gain-time-projection');
const gainTimeMaxProjectionEl = document.getElementById('gain-time-max-projection');
const gainPercentEl = document.getElementById('gain-percent');
const gainPercentFormulaEl = document.getElementById('gain-percent-formula');
const gainPercentMaxEl = document.getElementById('gain-percent-max');
const gainPercentProjectionEl = document.getElementById('gain-percent-projection');
const gainPercentMaxProjectionEl = document.getElementById('gain-percent-max-projection');
const gainEuroEl = document.getElementById('gain-euro');
const gainEuroFormulaEl = document.getElementById('gain-euro-formula');
const gainEuroMaxEl = document.getElementById('gain-euro-max');
const gainEuroProjectionEl = document.getElementById('gain-euro-projection');
const gainEuroMaxProjectionEl = document.getElementById('gain-euro-max-projection');

// Chart instances
let monthlyChart = null;
let usersChart = null;

// ==================== HELPERS ====================
function formatNumber(n) {
    return new Intl.NumberFormat('fr-FR').format(Math.round(n * 10) / 10);
}
function formatHours(h) {
    return `${new Intl.NumberFormat('fr-FR').format(Math.round(h))}h`;
}
function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ==================== FILTER ====================
function isNFHabitat(item) {
    const name = (item.controlName || '').toLowerCase();
    return name.includes('nf') && name.includes('habitat') && (item.status || '').toUpperCase() === 'COMPLETED';
}

function getFilteredData() {
    return allData.filter(item => {
        // NF Habitat filter (always applied)
        if (!isNFHabitat(item)) return false;

        // Exclusion des emails blacklistés
        const email = (item.user?.email || '').toLowerCase().trim();
        if (EXCLUDED_EMAILS.includes(email)) return false;

        // Control name sub-filter
        if (filters.controlName !== 'all' && item.controlName !== filters.controlName) return false;

        // Date filter (skip in cumulative mode)
        if (!isCumulativeMode && filters.startDate) {
            const d = new Date(item.createdAt);
            if (d < new Date(filters.startDate)) return false;
        }
        if (!isCumulativeMode && filters.endDate) {
            const d = new Date(item.createdAt);
            if (d > new Date(filters.endDate + 'T23:59:59')) return false;
        }
        return true;
    });
}

// ==================== PERIOD HELPERS ====================
function calculatePeriodMonths() {
    if (isCumulativeMode) {
        const dates = allData.filter(isNFHabitat).map(i => new Date(i.createdAt)).filter(d => !isNaN(d));
        if (!dates.length) return 1;
        const first = new Date(Math.min(...dates));
        const now = new Date();
        return Math.max(1, (now.getFullYear() - first.getFullYear()) * 12 + (now.getMonth() - first.getMonth()) + 1);
    }
    if (filters.startDate && filters.endDate) {
        const s = new Date(filters.startDate);
        const e = new Date(filters.endDate);
        return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
    }
    return 1;
}

// ==================== GAINS ====================
function calculateGains(totalPoints, usersCount) {
    const timeGainHours = totalPoints * parameters.hoursPerPoint;
    const activeUsers = usersCount > 0 ? usersCount : 1;
    const percentGain = parameters.annualHours > 0
        ? (timeGainHours / (activeUsers * parameters.annualHours)) * 100
        : 0;
    // Volume d'affaire = nb utilisateurs actifs × production par collaborateur
    const totalRevenue = activeUsers * parameters.revenuePerUser;
    const euroGain = (percentGain / 100) * totalRevenue;
    return { timeGainHours, percentGain, euroGain, usersCount: activeUsers, totalRevenue };
}

function updateGains(filteredData) {
    const totalPoints = filteredData.reduce((s, i) => s + (i.pointCount || 0), 0);
    const uniqueUsers = new Set(filteredData.map(i => (i.user?.email || '').toLowerCase())).size;
    const totalPointsAll = allData.filter(isNFHabitat).reduce((s, i) => s + (i.pointCount || 0), 0);

    const gains = calculateGains(totalPoints, uniqueUsers);
    const maxGains = calculateGains(totalPointsAll, uniqueUsers);

    const periodMonths = calculatePeriodMonths();
    const mul = 12 / periodMonths;
    const projGains = calculateGains(totalPoints * mul, uniqueUsers);
    const maxProjGains = calculateGains(totalPointsAll * mul, uniqueUsers);

    gainTimeEl.textContent = formatHours(gains.timeGainHours);
    gainTimeFormulaEl.textContent = `${formatNumber(totalPoints)} points × ${parameters.hoursPerPoint}h`;
    gainTimeMaxEl.textContent = `Max atteignable: ${formatHours(maxGains.timeGainHours)}`;
    gainTimeProjectionEl.textContent = `Projection année: ${formatHours(projGains.timeGainHours)} (${periodMonths} mois)`;
    gainTimeMaxProjectionEl.textContent = `Projection max année: ${formatHours(maxProjGains.timeGainHours)}`;

    gainPercentEl.textContent = `${gains.percentGain.toFixed(4)}%`;
    gainPercentFormulaEl.textContent = `${formatHours(gains.timeGainHours)} / (${uniqueUsers} × ${parameters.annualHours}h)`;
    gainPercentMaxEl.textContent = `Max atteignable: ${maxGains.percentGain.toFixed(4)}%`;
    gainPercentProjectionEl.textContent = `Projection année: ${projGains.percentGain.toFixed(4)}%`;
    gainPercentMaxProjectionEl.textContent = `Projection max année: ${maxProjGains.percentGain.toFixed(4)}%`;

    gainEuroEl.textContent = `${formatNumber(gains.euroGain)} €`;
    gainEuroFormulaEl.textContent = `${gains.percentGain.toFixed(4)}% × (${uniqueUsers} × ${formatNumber(parameters.revenuePerUser)} €)`;
    gainEuroMaxEl.textContent = `Max atteignable: ${formatNumber(maxGains.euroGain)} €`;
    gainEuroProjectionEl.textContent = `Projection année: ${formatNumber(projGains.euroGain)} €`;
    gainEuroMaxProjectionEl.textContent = `Projection max année: ${formatNumber(maxProjGains.euroGain)} €`;
}

// ==================== USER TABLE ====================
function updateUserTable(filteredData) {
    const userMap = {};
    filteredData.forEach(item => {
        const email = (item.user?.email || '').toLowerCase();
        const name = item.user?.name || email;
        if (!userMap[email]) {
            userMap[email] = { name, email, controls: 0, points: 0, projects: new Set(), lastDate: null };
        }
        userMap[email].controls++;
        userMap[email].points += item.pointCount || 0;
        if (item.projectId) userMap[email].projects.add(item.projectId);
        const d = new Date(item.createdAt);
        if (!userMap[email].lastDate || d > userMap[email].lastDate) userMap[email].lastDate = d;
    });

    let rows = Object.values(userMap).map(u => ({ ...u, projects: u.projects.size }));

    const col = userSortState.column;
    rows.sort((a, b) => {
        const va = col === 'name' ? a.name.toLowerCase() : a[col];
        const vb = col === 'name' ? b.name.toLowerCase() : b[col];
        return userSortState.ascending ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });

    const tbody = document.getElementById('user-table-body');
    tbody.innerHTML = rows.map(u => `
        <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${u.name}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${u.email}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-semibold">${u.controls}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-semibold">${formatNumber(u.points)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${u.projects}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-400">${u.lastDate ? formatDate(u.lastDate.toISOString()) : '-'}</td>
        </tr>
    `).join('');
}

window.sortUserTable = function(col) {
    if (userSortState.column === col) {
        userSortState.ascending = !userSortState.ascending;
    } else {
        userSortState.column = col;
        userSortState.ascending = false;
    }
    ['name','controls','points','projects'].forEach(c => {
        const el = document.getElementById(`sort-icon-${c}`);
        if (el) el.textContent = c === col ? (userSortState.ascending ? '↑' : '↓') : '↕';
    });
    updateDashboard();
};

// ==================== CHARTS ====================
function getMonthKey(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function updateCharts(filteredData) {
    const monthly = {};
    filteredData.forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        if (!monthly[key]) monthly[key] = { controls: 0, points: 0, users: new Set() };
        monthly[key].controls++;
        monthly[key].points += item.pointCount || 0;
        const email = (item.user?.email || '').toLowerCase();
        if (email) monthly[key].users.add(email);
    });

    const months = Object.keys(monthly).sort();
    const monthNames = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    const labels = months.map(k => {
        const [y, m] = k.split('-');
        return `${monthNames[parseInt(m) - 1]} ${y}`;
    });

    // Monthly chart (controls + points)
    if (monthlyChart) { monthlyChart.destroy(); monthlyChart = null; }
    const ctxM = document.getElementById('monthlyChart').getContext('2d');
    monthlyChart = new Chart(ctxM, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Contrôles',
                    data: months.map(k => monthly[k].controls),
                    backgroundColor: 'rgba(16, 185, 129, 0.7)',
                    borderColor: 'rgba(5, 150, 105, 1)',
                    borderWidth: 1,
                    borderRadius: 4,
                    yAxisID: 'yControls',
                    order: 2,
                },
                {
                    label: 'Points contrôlés',
                    data: months.map(k => monthly[k].points),
                    type: 'line',
                    borderColor: 'rgba(99, 102, 241, 1)',
                    backgroundColor: 'rgba(99, 102, 241, 0.08)',
                    borderWidth: 2.5,
                    tension: 0.35,
                    pointRadius: 4,
                    pointBackgroundColor: 'rgba(99, 102, 241, 1)',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    yAxisID: 'yPoints',
                    order: 1,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: true, position: 'top', labels: { font: { size: 12 }, padding: 14, usePointStyle: true } },
                tooltip: {
                    backgroundColor: 'rgba(17,24,39,0.95)',
                    titleColor: '#F9FAFB',
                    bodyColor: '#E5E7EB',
                    padding: 10,
                    cornerRadius: 8,
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#6B7280' } },
                yControls: {
                    type: 'linear', position: 'left', beginAtZero: true,
                    title: { display: true, text: 'Contrôles', font: { size: 11, weight: 'bold' }, color: '#059669' },
                    ticks: { font: { size: 11 }, color: '#059669' },
                    grid: { color: 'rgba(229,231,235,0.8)' }
                },
                yPoints: {
                    type: 'linear', position: 'right', beginAtZero: true,
                    title: { display: true, text: 'Points', font: { size: 11, weight: 'bold' }, color: '#6366F1' },
                    ticks: { font: { size: 11 }, color: '#6366F1' },
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });

    // Users chart
    if (usersChart) { usersChart.destroy(); usersChart = null; }
    const ctxU = document.getElementById('usersChart').getContext('2d');
    usersChart = new Chart(ctxU, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Utilisateurs actifs',
                data: months.map(k => monthly[k].users.size),
                backgroundColor: 'rgba(245, 158, 11, 0.7)',
                borderColor: 'rgba(217, 119, 6, 1)',
                borderWidth: 1,
                borderRadius: 4,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: 'rgba(17,24,39,0.95)', titleColor: '#F9FAFB', bodyColor: '#E5E7EB', padding: 10, cornerRadius: 8 }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#6B7280' } },
                y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 }, color: '#6B7280' }, grid: { color: 'rgba(229,231,235,0.8)' } }
            }
        }
    });
}

// ==================== FILTERS POPULATION ====================
function populateControlFilter() {
    const names = [...new Set(allData.filter(isNFHabitat).map(i => i.controlName).filter(Boolean))].sort();
    controlFilterEl.innerHTML = '<option value="all">Tous les référentiels</option>' +
        names.map(n => `<option value="${n}">${n}</option>`).join('');
}

// ==================== DASHBOARD ====================
function updateDashboard() {
    const filtered = getFilteredData();

    // KPIs
    const users = new Set(filtered.map(i => (i.user?.email || '').toLowerCase()).filter(Boolean));
    const totalPoints = filtered.reduce((s, i) => s + (i.pointCount || 0), 0);
    const projects = new Set(filtered.map(i => i.projectId).filter(Boolean));

    totalUsersEl.textContent = users.size;
    totalControlsEl.textContent = filtered.length;
    totalPointsEl.textContent = formatNumber(totalPoints);
    totalProjectsEl.textContent = projects.size;

    // Gains
    updateGains(filtered);

    // Charts
    updateCharts(filtered);

    // User Table
    updateUserTable(filtered);
}

// ==================== DATA LOADING ====================
function parseNFHabitatData(raw) {
    try {
        // Try JSON
        let json = JSON.parse(raw);
        // Handle [{data: "..."}] wrapper (CSV inside JSON)
        if (Array.isArray(json) && json.length > 0 && typeof json[0].data === 'string') {
            json = JSON.parse(json[0].data);
        }
        // Handle [{items: [...]}] wrapper  ← format réel : tableau contenant un objet avec items
        if (Array.isArray(json) && json.length > 0 && Array.isArray(json[0].items)) {
            json = json[0].items;
        }
        // Handle {items: [...]} wrapper (sans tableau externe)
        if (!Array.isArray(json) && json && Array.isArray(json.items)) {
            json = json.items;
        }
        if (!Array.isArray(json)) return [];
        return json.map(item => ({
            id: item.id || '',
            createdAt: item.createdAt || '',
            status: item.status || '',
            projectId: item.projectId || '',
            projectName: item.projectName || '',
            totalCost: item.totalCost || 0,
            pointCount: parseInt(item.pointCount) || 0,
            controlName: item.controlName || '',
            user: { name: item.user?.name || '', email: (item.user?.email || '').toLowerCase() }
        }));
    } catch (e) {
        console.error('Error parsing NF Habitat data:', e);
        return [];
    }
}

// ==================== AUTHENTICATION ====================
async function authenticateWithPassword(password) {
    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        if (!response.ok) return false;
        const result = await response.text();

        // Extract NF Habitat URL — accepts both single and double quotes
        const urlRegex = (name) => result.match(new RegExp(name + `\\s*=\\s*['"]([^'"]+)['"]`));
        const nfMatch = urlRegex('NF_HABITAT_URL') || urlRegex('NFHABITAT_URL');
        if (nfMatch) DATA_URL = nfMatch[1];

        // Auth is successful if the webhook returned ANY known URL pattern
        const isAuthenticated = !!(
            urlRegex('DESCRIPTIF_URL') ||
            urlRegex('AUTOCONTACT_URL') ||
            urlRegex('COMPARATEUR_URL') ||
            DATA_URL
        );
        return isAuthenticated;
    } catch (e) {
        console.error('Auth error:', e);
        return false;
    }
}

async function loadData() {
    try {
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');

        if (!DATA_URL) {
            // Webhook not yet updated to return NF_HABITAT_URL
            loadingEl.classList.add('hidden');
            errorEl.classList.remove('hidden');
            errorEl.innerHTML = `
                <div class="text-center py-8">
                    <p class="text-red-600 font-medium">NF_HABITAT_URL non configurée.</p>
                    <p class="text-gray-500 text-sm mt-2">Mettez à jour votre workflow n8n pour retourner <code>NF_HABITAT_URL = '...'</code> dans la réponse d'authentification.</p>
                    <a href="index.html" class="mt-4 inline-block text-blue-600 underline text-sm">← Retour au tableau de bord</a>
                </div>`;
            return;
        }

        const response = await fetch(DATA_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.text();
        allData = parseNFHabitatData(raw);
        console.log('NF Habitat: loaded', allData.length, 'total records');
        console.log('NF Habitat: filtered', allData.filter(isNFHabitat).length, 'NF Habitat records');

        // First date
        const dates = allData.filter(isNFHabitat).map(i => new Date(i.createdAt)).filter(d => !isNaN(d));
        if (dates.length) {
            const first = new Date(Math.min(...dates));
            firstDateTextEl.textContent = `Données depuis le ${formatDate(first.toISOString())}`;
        }

        populateControlFilter();

        // Afficher le contenu AVANT de dessiner les charts :
        // Chart.js a besoin que le canvas soit visible pour calculer ses dimensions.
        loadingEl.classList.add('hidden');
        mainContentEl.classList.remove('hidden');

        updateDashboard();
    } catch (e) {
        console.error('Error loading NF Habitat data:', e);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }
}

// ==================== EVENT LISTENERS ====================
cumulToggleEl.addEventListener('change', () => {
    isCumulativeMode = cumulToggleEl.checked;
    startDateEl.disabled = isCumulativeMode;
    endDateEl.disabled = isCumulativeMode;
    updateDashboard();
});

startDateEl.addEventListener('change', () => { filters.startDate = startDateEl.value || null; updateDashboard(); });
endDateEl.addEventListener('change', () => { filters.endDate = endDateEl.value || null; updateDashboard(); });
controlFilterEl.addEventListener('change', () => { filters.controlName = controlFilterEl.value; updateDashboard(); });

resetFiltersBtn.addEventListener('click', () => {
    filters = { startDate: null, endDate: null, controlName: 'all' };
    startDateEl.value = '';
    endDateEl.value = '';
    cumulToggleEl.checked = false;
    isCumulativeMode = false;
    startDateEl.disabled = false;
    endDateEl.disabled = false;
    controlFilterEl.value = 'all';
    updateDashboard();
});

// Settings modal
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeModal = document.getElementById('close-modal');
const saveSettings = document.getElementById('save-settings');
const cancelSettings = document.getElementById('cancel-settings');
const inputHoursPerPoint = document.getElementById('input-hours-per-point');
const inputAnnualHours = document.getElementById('input-annual-hours');
const inputRevenue = document.getElementById('input-revenue');

settingsBtn.addEventListener('click', () => {
    inputHoursPerPoint.value = parameters.hoursPerPoint;
    inputAnnualHours.value = parameters.annualHours;
    inputRevenue.value = parameters.revenuePerUser;
    settingsModal.classList.remove('hidden');
});
closeModal.addEventListener('click', () => settingsModal.classList.add('hidden'));
cancelSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));
saveSettings.addEventListener('click', () => {
    parameters.hoursPerPoint = parseFloat(inputHoursPerPoint.value) || 0.02816;
    parameters.annualHours = parseFloat(inputAnnualHours.value) || 1607;
    parameters.revenuePerUser = parseFloat(inputRevenue.value) || 150000;
    settingsModal.classList.add('hidden');
    updateDashboard();
});

// ==================== INIT ====================
(async function init() {
    // Load saved parameters
    const saved = localStorage.getItem('nfhabitat_parameters');
    if (saved) {
        try { Object.assign(parameters, JSON.parse(saved)); } catch (e) {}
    }

    // 1. Try to reuse cached webhook response from index.html auth (no extra network call)
    const cachedResult = localStorage.getItem('roi_auth_result');
    if (cachedResult) {
        const m = cachedResult.match(/NF_HABITAT_URL\s*=\s*['"]([^'"]+)['"]/);
        if (m) DATA_URL = m[1];
        // If cache exists, password was already validated → go straight to loadData
        await loadData();
        return;
    }

    // 2. No cache: call webhook with stored password
    const storedPwd = localStorage.getItem('roi_password');
    if (storedPwd) {
        const ok = await authenticateWithPassword(storedPwd);
        if (ok) { await loadData(); return; }
    }

    // 3. No stored password or auth failed: show login modal
    loadingEl.classList.add('hidden');
    const loginModal = document.createElement('div');
    loginModal.className = 'fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50';
    loginModal.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl p-8 w-96">
            <h2 class="text-xl font-bold text-gray-900 mb-6">Accès sécurisé</h2>
            <form id="login-form">
                <input type="password" id="pwd-input" placeholder="Mot de passe"
                    class="w-full px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 mb-4" required />
                <p id="login-error" class="hidden text-red-600 text-sm mb-3">Mot de passe incorrect.</p>
                <button type="submit" class="w-full px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium">Se connecter</button>
            </form>
        </div>`;
    document.body.appendChild(loginModal);

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('pwd-input').value;
        const ok = await authenticateWithPassword(pwd);
        if (ok) {
            localStorage.setItem('roi_password', pwd);
            document.body.removeChild(loginModal);
            await loadData();
        } else {
            document.getElementById('login-error').classList.remove('hidden');
        }
    });
})();
