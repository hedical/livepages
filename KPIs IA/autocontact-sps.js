// ============================================================================
// autocontact-sps.js — Brique « Autocontact SPS ».
//
// SOURCE : backoffice BTP Force (https://admin.btp-force.cloud/contacts), qui
// est l'application des SPS. TOUTES les lignes qui en sortent sont donc SPS,
// y compris celles dont l'email est @btp-consultants.fr et dont l'agence
// ressemble à du CT : ici la source EST le marqueur de BU, on ne filtre pas.
//
// Le bouton « Exporter en CSV » du backoffice ne tape aucun endpoint CSV : il
// construit le fichier dans le navigateur à partir de l'API AppSync
// (query listContactTrackings, paginée par nextToken, auth Cognito). Tant que
// le compte de service Cognito n'existe pas, personne ne peut automatiser cette
// extraction : `autocontact_sps.json` est donc DÉPOSÉ À LA MAIN dans le bucket
// Supabase (conversion : tools/csv-to-autocontact-sps.js), signé par le webhook
// passwordROI comme les autres briques, et lu ici via AUTOCONTACT_SPS_URL.
// Le jour où l'API s'ouvre, seul le producteur du fichier change — la page non.
// ============================================================================

// ==================== CONFIGURATION ====================
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordROI';
let DATA_URL = '';

const PARAMETERS_KEY = 'autocontact_sps_parameters';

// Parameters
let parameters = {
    secondsPerContact: 90,   // même hypothèse que la brique Autocontact CT
    annualHours: 1607,
    revenuePerUser: 150000   // production annuelle par collaborateur (€)
};

// State
let allData = [];
let isCumulativeMode = false;
let filters = { startDate: null, endDate: null, origin: 'all', agency: 'all' };
let userSortState = { column: 'ai', ascending: false };

// ==================== DOM ELEMENTS ====================
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const mainContentEl = document.getElementById('main-content');
const startDateEl = document.getElementById('start-date-filter');
const endDateEl = document.getElementById('end-date-filter');
const cumulToggleEl = document.getElementById('cumul-toggle');
const originFilterEl = document.getElementById('origin-filter');
const agencyFilterEl = document.getElementById('agency-filter');
const resetFiltersBtn = document.getElementById('reset-filters');
const firstDateTextEl = document.getElementById('first-date-text');

// Source banner
const sourceBannerEl = document.getElementById('source-banner');
const sourceLabelEl = document.getElementById('source-label');
const sourceHintEl = document.getElementById('source-hint');

// KPI elements
const aiContactsEl = document.getElementById('ai-contacts');
const aiRateEl = document.getElementById('ai-rate');
const aiRateDetailEl = document.getElementById('ai-rate-detail');
const totalUsersEl = document.getElementById('total-users');
const totalUsersDetailEl = document.getElementById('total-users-detail');
const totalAffairsEl = document.getElementById('total-affairs');
const totalContactsEl = document.getElementById('total-contacts');
const totalDeliverablesEl = document.getElementById('total-deliverables');
const proposedContactsEl = document.getElementById('proposed-contacts');
const retentionRateEl = document.getElementById('retention-rate');

// Gain elements
const gainTimeEl = document.getElementById('gain-time');
const gainTimeFormulaEl = document.getElementById('gain-time-formula');
const gainTimeMaxEl = document.getElementById('gain-time-max');
const gainTimeProjectionEl = document.getElementById('gain-time-projection');
const gainPercentEl = document.getElementById('gain-percent');
const gainPercentFormulaEl = document.getElementById('gain-percent-formula');
const gainPercentMaxEl = document.getElementById('gain-percent-max');
const gainPercentProjectionEl = document.getElementById('gain-percent-projection');
const gainEuroEl = document.getElementById('gain-euro');
const gainEuroFormulaEl = document.getElementById('gain-euro-formula');
const gainEuroMaxEl = document.getElementById('gain-euro-max');
const gainEuroProjectionEl = document.getElementById('gain-euro-projection');

// Chart instances
let monthlyChart = null;
let usersChart = null;
let agencyChart = null;

// ==================== HELPERS ====================
function formatNumber(n) {
    return new Intl.NumberFormat('fr-FR').format(Math.round(n));
}
function formatHours(h) {
    return `${new Intl.NumberFormat('fr-FR').format(Math.round(h))}h`;
}
function formatDate(value) {
    if (!value) return '-';
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function percent(part, whole, digits) {
    if (!whole) return 0;
    const p = (part / whole) * 100;
    return digits === undefined ? p : parseFloat(p.toFixed(digits));
}

// ==================== PARSING ====================
// Une ligne = un contact créé dans une affaire. `fromAI` distingue les contacts
// proposés par le livrable Autocontact de ceux saisis à la main.
function normalizeJsonItem(item) {
    const source = (item.sourceType || item.origine || '').toString().toUpperCase();
    const first = item.userFirstname || '';
    const last = item.userLastname || '';
    return {
        id: item.id || item.contactId || '',
        createdAt: item.createdAt || '',
        fromAI: source === 'IA',
        email: (item.userEmail || '').toLowerCase().trim(),
        userName: `${first} ${last}`.trim(),
        direction: item.direction || '',
        agency: item.agencyName || '',
        service: item.productionService || '',
        contactType: item.contactType || '',
        company: item.companyName || '',
        affairNumber: item.affairNumber || '',
        affairName: item.affairName || '',
        projectId: item.projectId || '',
        deliverableId: item.deliverableId || '',
        deliverableType: item.deliverableType || '',
        proposedCount: parseInt(item.proposedCount, 10) || 0
    };
}

// CSV du backoffice : séparateur ';', BOM UTF-8, Date et Heure en colonnes
// séparées, « Origine » valant « IA » ou « Humain ».
function parseContactsCSV(csvString) {
    const rows = KPI.parseFullCSV(csvString.replace(/^﻿/, ''), ';');
    if (rows.length < 2) return [];

    const headers = rows[0];
    const idx = {
        date: KPI.findIdx(headers, ['date']),
        heure: KPI.findIdx(headers, ['heure']),
        origine: KPI.findIdx(headers, ['origine']),
        email: KPI.findIdx(headers, ['utilisateur', 'email']),
        nom: KPI.findIdx(headers, ['utilisateur', 'nom']),
        prenom: KPI.findIdx(headers, ['utilisateur', 'prénom'], ['utilisateur', 'prenom']),
        direction: KPI.findIdx(headers, ['direction']),
        agence: KPI.findIdx(headers, ['agence']),
        service: KPI.findIdx(headers, ['service']),
        contactType: KPI.findIdx(headers, ['contact', 'type']),
        societe: KPI.findIdx(headers, ['société'], ['societe']),
        affaireNum: KPI.findIdx(headers, ['affaire', 'numéro'], ['affaire', 'numero']),
        affaireNom: KPI.findIdx(headers, ['affaire', 'nom']),
        projet: KPI.findIdx(headers, ['projet', 'ia']),
        livrable: KPI.findIdx(headers, ['livrable', 'ia']),
        typeLivrable: KPI.findIdx(headers, ['type', 'livrable']),
        proposes: KPI.findIdx(headers, ['proposés'], ['proposes']),
        contactId: KPI.findIdx(headers, ['contact', 'id'])
    };

    const get = (row, i) => (i >= 0 && i < row.length ? row[i] : '');

    return rows.slice(1).map(row => {
        const date = KPI.parseFrDateTime(get(row, idx.date), get(row, idx.heure));
        return {
            id: get(row, idx.contactId),
            createdAt: date ? date.toISOString() : '',
            fromAI: get(row, idx.origine).toUpperCase() === 'IA',
            email: get(row, idx.email).toLowerCase().trim(),
            userName: `${get(row, idx.prenom)} ${get(row, idx.nom)}`.trim(),
            direction: get(row, idx.direction),
            agency: get(row, idx.agence),
            service: get(row, idx.service),
            contactType: get(row, idx.contactType),
            company: get(row, idx.societe),
            affairNumber: get(row, idx.affaireNum),
            affairName: get(row, idx.affaireNom),
            projectId: get(row, idx.projet),
            deliverableId: get(row, idx.livrable),
            deliverableType: get(row, idx.typeLivrable),
            proposedCount: parseInt(get(row, idx.proposes), 10) || 0
        };
    }).filter(item => item.createdAt);
}

// Accepte indifféremment : CSV backoffice, réponse GraphQL brute, tableau
// d'items, et les enveloppes n8n [{ data: "..." }] / [{ items: [...] }].
function parseContactsPayload(raw) {
    const text = (raw || '').replace(/^﻿/, '').trim();
    if (!text) return [];

    if (text[0] !== '[' && text[0] !== '{') return parseContactsCSV(text);

    try {
        let json = JSON.parse(text);
        if (Array.isArray(json) && json.length > 0 && typeof json[0].data === 'string') {
            return parseContactsPayload(json[0].data);
        }
        if (json && json.data && json.data.listContactTrackings) {
            json = json.data.listContactTrackings.items;
        }
        if (Array.isArray(json) && json.length > 0 && Array.isArray(json[0].items)) {
            json = json[0].items;
        }
        if (!Array.isArray(json) && json && Array.isArray(json.items)) {
            json = json.items;
        }
        if (!Array.isArray(json)) return [];
        return json.map(normalizeJsonItem).filter(item => item.createdAt);
    } catch (e) {
        console.error('Autocontact SPS : charge utile illisible', e);
        return [];
    }
}

// ==================== FILTRES ====================
function getFilteredData() {
    return allData.filter(item => {
        if (filters.origin === 'ia' && !item.fromAI) return false;
        if (filters.origin === 'human' && item.fromAI) return false;
        if (filters.agency !== 'all' && (item.agency || '(sans agence)') !== filters.agency) return false;

        if (!isCumulativeMode && filters.startDate) {
            if (new Date(item.createdAt) < new Date(filters.startDate)) return false;
        }
        if (!isCumulativeMode && filters.endDate) {
            if (new Date(item.createdAt) > new Date(filters.endDate + 'T23:59:59')) return false;
        }
        return true;
    });
}

function calculatePeriodMonths() {
    if (isCumulativeMode || !filters.startDate || !filters.endDate) {
        const dates = allData.map(i => new Date(i.createdAt)).filter(d => !isNaN(d));
        if (!dates.length) return 1;
        const first = new Date(Math.min(...dates));
        const last = isCumulativeMode ? new Date() : new Date(Math.max(...dates));
        return Math.max(1, (last.getFullYear() - first.getFullYear()) * 12 + (last.getMonth() - first.getMonth()) + 1);
    }
    const s = new Date(filters.startDate);
    const e = new Date(filters.endDate);
    return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
}

// `proposedCount` est porté par le LIVRABLE, pas par la ligne de contact :
// le sommer ligne à ligne le multiplierait par le nombre de contacts créés.
function sumProposedContacts(items) {
    const perDeliverable = new Map();
    items.forEach(item => {
        if (!item.fromAI || !item.deliverableId) return;
        if (!perDeliverable.has(item.deliverableId)) {
            perDeliverable.set(item.deliverableId, item.proposedCount || 0);
        }
    });
    let total = 0;
    perDeliverable.forEach(v => { total += v; });
    return { total, deliverables: perDeliverable.size };
}

// ==================== GAINS ====================
function calculateGains(aiContacts, usersCount) {
    const timeGainHours = (aiContacts * parameters.secondsPerContact) / 3600;
    const activeUsers = usersCount > 0 ? usersCount : 1;
    const percentGain = parameters.annualHours > 0
        ? (timeGainHours / (activeUsers * parameters.annualHours)) * 100
        : 0;
    const totalRevenue = activeUsers * parameters.revenuePerUser;
    const euroGain = (percentGain / 100) * totalRevenue;
    return { timeGainHours, percentGain, euroGain, totalRevenue };
}

function updateGains(filtered) {
    const aiContacts = filtered.filter(i => i.fromAI).length;
    const users = new Set(filtered.filter(i => i.fromAI).map(i => i.email).filter(Boolean)).size;
    const aiContactsAll = allData.filter(i => i.fromAI).length;

    const gains = calculateGains(aiContacts, users);
    const maxGains = calculateGains(aiContactsAll, users);

    const periodMonths = calculatePeriodMonths();
    const projection = calculateGains(aiContacts * (12 / periodMonths), users);

    gainTimeEl.textContent = formatHours(gains.timeGainHours);
    gainTimeFormulaEl.textContent = `${formatNumber(aiContacts)} contacts IA × ${parameters.secondsPerContact} s`;
    gainTimeMaxEl.textContent = `Max atteignable (tout l'historique chargé) : ${formatHours(maxGains.timeGainHours)}`;
    gainTimeProjectionEl.textContent = `Projection année : ${formatHours(projection.timeGainHours)} (${periodMonths} mois)`;

    gainPercentEl.textContent = `${gains.percentGain.toFixed(4)}%`;
    gainPercentFormulaEl.textContent = `${formatHours(gains.timeGainHours)} / (${users || 1} × ${parameters.annualHours}h)`;
    gainPercentMaxEl.textContent = `Max atteignable : ${maxGains.percentGain.toFixed(4)}%`;
    gainPercentProjectionEl.textContent = `Projection année : ${projection.percentGain.toFixed(4)}%`;

    gainEuroEl.textContent = `${formatNumber(gains.euroGain)} €`;
    gainEuroFormulaEl.textContent = `${gains.percentGain.toFixed(4)}% × (${users || 1} × ${formatNumber(parameters.revenuePerUser)} €)`;
    gainEuroMaxEl.textContent = `Max atteignable : ${formatNumber(maxGains.euroGain)} €`;
    gainEuroProjectionEl.textContent = `Projection année : ${formatNumber(projection.euroGain)} €`;
}

// ==================== TABLEAU UTILISATEURS ====================
function updateUserTable(filtered) {
    const userMap = {};
    filtered.forEach(item => {
        const email = item.email || '(sans email)';
        if (!userMap[email]) {
            userMap[email] = {
                name: item.userName || email,
                email,
                agency: item.agency || '-',
                ai: 0,
                manual: 0,
                affairs: new Set(),
                lastDate: null
            };
        }
        const u = userMap[email];
        if (item.fromAI) u.ai++; else u.manual++;
        if (item.affairNumber) u.affairs.add(item.affairNumber);
        const d = new Date(item.createdAt);
        if (!isNaN(d) && (!u.lastDate || d > u.lastDate)) u.lastDate = d;
    });

    const rows = Object.values(userMap).map(u => ({
        ...u,
        affairs: u.affairs.size,
        rate: percent(u.ai, u.ai + u.manual)
    }));

    const col = userSortState.column;
    rows.sort((a, b) => {
        const va = col === 'name' ? a.name.toLowerCase() : a[col];
        const vb = col === 'name' ? b.name.toLowerCase() : b[col];
        if (va === vb) return 0;
        return userSortState.ascending ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });

    document.getElementById('user-table-body').innerHTML = rows.map(u => `
        <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${KPI.escapeHtml(u.name)}
                <span class="block text-xs text-gray-400">${KPI.escapeHtml(u.email)}</span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${KPI.escapeHtml(u.agency)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-cyan-700 font-semibold">${formatNumber(u.ai)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatNumber(u.manual)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${u.rate.toFixed(0)}%</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatNumber(u.affairs)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-400">${formatDate(u.lastDate)}</td>
        </tr>
    `).join('');
}

window.sortUserTable = function (col) {
    if (userSortState.column === col) {
        userSortState.ascending = !userSortState.ascending;
    } else {
        userSortState.column = col;
        userSortState.ascending = false;
    }
    ['name', 'ai', 'manual', 'rate', 'affairs'].forEach(c => {
        const el = document.getElementById(`sort-icon-${c}`);
        if (el) el.textContent = c === col ? (userSortState.ascending ? '↑' : '↓') : '↕';
    });
    updateDashboard();
};

// ==================== GRAPHIQUES ====================
const MONTH_NAMES = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

function getMonthKey(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const TOOLTIP_STYLE = {
    backgroundColor: 'rgba(17,24,39,0.95)',
    titleColor: '#F9FAFB',
    bodyColor: '#E5E7EB',
    padding: 10,
    cornerRadius: 8
};

function updateCharts(filtered) {
    const monthly = {};
    filtered.forEach(item => {
        const key = getMonthKey(item.createdAt);
        if (!key) return;
        if (!monthly[key]) monthly[key] = { ai: 0, manual: 0, users: new Set() };
        if (item.fromAI) monthly[key].ai++; else monthly[key].manual++;
        if (item.email) monthly[key].users.add(item.email);
    });

    const months = Object.keys(monthly).sort();
    const labels = months.map(k => {
        const [y, m] = k.split('-');
        return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
    });

    // Contacts par mois : IA vs saisie manuelle + part de l'IA
    if (monthlyChart) { monthlyChart.destroy(); monthlyChart = null; }
    monthlyChart = new Chart(document.getElementById('monthlyChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Contacts IA',
                    data: months.map(k => monthly[k].ai),
                    backgroundColor: 'rgba(6, 182, 212, 0.75)',
                    borderColor: 'rgba(8, 145, 178, 1)',
                    borderWidth: 1,
                    borderRadius: 4,
                    yAxisID: 'yCount',
                    order: 2
                },
                {
                    label: 'Saisie manuelle',
                    data: months.map(k => monthly[k].manual),
                    backgroundColor: 'rgba(148, 163, 184, 0.65)',
                    borderColor: 'rgba(100, 116, 139, 1)',
                    borderWidth: 1,
                    borderRadius: 4,
                    yAxisID: 'yCount',
                    order: 3
                },
                {
                    label: "Part de l'IA",
                    data: months.map(k => percent(monthly[k].ai, monthly[k].ai + monthly[k].manual, 1)),
                    type: 'line',
                    borderColor: 'rgba(99, 102, 241, 1)',
                    backgroundColor: 'rgba(99, 102, 241, 0.08)',
                    borderWidth: 2.5,
                    tension: 0.35,
                    pointRadius: 4,
                    pointBackgroundColor: 'rgba(99, 102, 241, 1)',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    yAxisID: 'yRate',
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: true, position: 'top', labels: { font: { size: 12 }, padding: 14, usePointStyle: true } },
                tooltip: TOOLTIP_STYLE
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#6B7280' } },
                yCount: {
                    type: 'linear', position: 'left', beginAtZero: true,
                    title: { display: true, text: 'Contacts', font: { size: 11, weight: 'bold' }, color: '#0891B2' },
                    ticks: { font: { size: 11 }, color: '#0891B2' },
                    grid: { color: 'rgba(229,231,235,0.8)' }
                },
                yRate: {
                    type: 'linear', position: 'right', beginAtZero: true, max: 100,
                    title: { display: true, text: "Part de l'IA (%)", font: { size: 11, weight: 'bold' }, color: '#6366F1' },
                    ticks: { font: { size: 11 }, color: '#6366F1' },
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });

    // Utilisateurs actifs par mois
    if (usersChart) { usersChart.destroy(); usersChart = null; }
    usersChart = new Chart(document.getElementById('usersChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Utilisateurs actifs',
                data: months.map(k => monthly[k].users.size),
                backgroundColor: 'rgba(245, 158, 11, 0.7)',
                borderColor: 'rgba(217, 119, 6, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: TOOLTIP_STYLE },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#6B7280' } },
                y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 }, color: '#6B7280' }, grid: { color: 'rgba(229,231,235,0.8)' } }
            }
        }
    });

    // Contacts IA par agence (top 12)
    const perAgency = {};
    filtered.filter(i => i.fromAI).forEach(item => {
        const key = item.agency || '(sans agence)';
        perAgency[key] = (perAgency[key] || 0) + 1;
    });
    const topAgencies = Object.entries(perAgency).sort((a, b) => b[1] - a[1]).slice(0, 12);

    if (agencyChart) { agencyChart.destroy(); agencyChart = null; }
    agencyChart = new Chart(document.getElementById('agencyChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: topAgencies.map(([name]) => name),
            datasets: [{
                label: 'Contacts IA',
                data: topAgencies.map(([, count]) => count),
                backgroundColor: 'rgba(6, 182, 212, 0.7)',
                borderColor: 'rgba(8, 145, 178, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: TOOLTIP_STYLE },
            scales: {
                x: { beginAtZero: true, ticks: { font: { size: 11 }, color: '#6B7280' }, grid: { color: 'rgba(229,231,235,0.8)' } },
                y: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#6B7280' } }
            }
        }
    });
}

// ==================== DASHBOARD ====================
function populateAgencyFilter() {
    const agencies = [...new Set(allData.map(i => i.agency || '(sans agence)'))].sort();
    agencyFilterEl.innerHTML = '<option value="all">Toutes les agences</option>' +
        agencies.map(a => `<option value="${KPI.escapeHtml(a)}">${KPI.escapeHtml(a)}</option>`).join('');
}

function updateDashboard() {
    const filtered = getFilteredData();

    const aiItems = filtered.filter(i => i.fromAI);
    const users = new Set(filtered.map(i => i.email).filter(Boolean));
    const aiUsers = new Set(aiItems.map(i => i.email).filter(Boolean));
    const affairs = new Set(aiItems.map(i => i.affairNumber).filter(Boolean));
    const proposed = sumProposedContacts(filtered);

    aiContactsEl.textContent = formatNumber(aiItems.length);
    aiRateEl.textContent = `${percent(aiItems.length, filtered.length, 1)}%`;
    aiRateDetailEl.textContent = `${formatNumber(aiItems.length)} sur ${formatNumber(filtered.length)} contacts créés`;
    totalUsersEl.textContent = formatNumber(aiUsers.size);
    totalUsersDetailEl.textContent = `Ont utilisé l'IA — ${formatNumber(users.size)} créateurs de contacts au total`;
    totalAffairsEl.textContent = formatNumber(affairs.size);
    totalContactsEl.textContent = formatNumber(filtered.length);
    totalDeliverablesEl.textContent = formatNumber(proposed.deliverables);
    proposedContactsEl.textContent = formatNumber(proposed.total);
    retentionRateEl.textContent = proposed.total ? `${percent(aiItems.length, proposed.total, 1)}%` : '-';

    updateGains(filtered);
    updateCharts(filtered);
    updateUserTable(filtered);
}

// ==================== SOURCE DE DONNÉES ====================
function showSourceBanner(label, hint) {
    sourceBannerEl.classList.remove('hidden');
    sourceLabelEl.textContent = label;
    sourceHintEl.textContent = hint || '';
}

function showNoSourcePanel() {
    loadingEl.classList.add('hidden');
    mainContentEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    errorEl.innerHTML = `
        <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
            <p class="text-gray-800 font-medium">Aucune donnée Autocontact SPS pour le moment.</p>
            <p class="text-gray-500 text-sm mt-2">
                Le webhook <code>passwordROI</code> ne renvoie pas <code>AUTOCONTACT_SPS_URL</code>,
                ou le fichier <code>autocontact_sps.json</code> est absent du bucket.
            </p>
            <p class="text-gray-500 text-sm mt-2">
                Pour le régénérer : export CSV depuis
                <a class="text-cyan-600 underline" href="https://admin.btp-force.cloud/contacts" target="_blank" rel="noopener">admin.btp-force.cloud/contacts</a>,
                conversion via <code>tools/csv-to-autocontact-sps.js</code>, dépôt dans le bucket.
            </p>
            <a href="index.html" class="mt-4 inline-block text-cyan-600 underline text-sm">← Retour au tableau de bord</a>
        </div>`;
}

function applyData(items, sourceLabel, sourceHint) {
    allData = items;
    if (!allData.length) {
        showSourceBanner(sourceLabel, sourceHint);
        showNoSourcePanel();
        return;
    }

    const dates = allData.map(i => new Date(i.createdAt)).filter(d => !isNaN(d));
    if (dates.length) {
        const first = new Date(Math.min(...dates));
        const last = new Date(Math.max(...dates));
        firstDateTextEl.textContent = `Données du ${formatDate(first)} au ${formatDate(last)} — ${formatNumber(allData.length)} contacts`;
    }

    showSourceBanner(sourceLabel, sourceHint);
    populateAgencyFilter();

    // Afficher le contenu AVANT de dessiner les charts : Chart.js a besoin d'un
    // canvas visible pour calculer ses dimensions.
    errorEl.classList.add('hidden');
    loadingEl.classList.add('hidden');
    mainContentEl.classList.remove('hidden');

    updateDashboard();
}

async function loadData() {
    try {
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');

        if (!DATA_URL) {
            showSourceBanner(
                'Source indisponible',
                'AUTOCONTACT_SPS_URL absente de la réponse du webhook passwordROI.'
            );
            showNoSourcePanel();
            return;
        }

        const response = await fetch(DATA_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        applyData(
            parseContactsPayload(await response.text()),
            'Source : autocontact_sps.json (Supabase, URL signée)',
            "Fichier déposé à la main en attendant l'accès API au backoffice : le bouton « Rafraîchir les données » du dashboard ne le régénère pas."
        );
    } catch (e) {
        console.error('Autocontact SPS : erreur de chargement', e);
        loadingEl.classList.add('hidden');
        mainContentEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }
}

// ==================== AUTHENTIFICATION ====================
async function authenticateWithPassword(password) {
    try {
        // Le webhook passwordROI attend le mot de passe en TEXTE BRUT
        // (nœud rawBody côté n8n) — pas en JSON.
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: password
        });
        if (!response.ok) return false;

        const urls = KPI.parseUrlsResponse(await response.text());
        DATA_URL = urls.AUTOCONTACT_SPS_URL || '';

        // Auth réussie dès que le webhook renvoie une URL connue : AUTOCONTACT_SPS_URL
        // n'existe pas encore, son absence ne doit pas bloquer l'accès à la page.
        return !!(urls.DESCRIPTIF_URL || urls.AUTOCONTACT_URL || urls.COMPARATEUR_URL || DATA_URL);
    } catch (e) {
        console.error('Auth error:', e);
        return false;
    }
}

// ==================== ÉVÉNEMENTS ====================
cumulToggleEl.addEventListener('change', () => {
    isCumulativeMode = cumulToggleEl.checked;
    startDateEl.disabled = isCumulativeMode;
    endDateEl.disabled = isCumulativeMode;
    updateDashboard();
});
startDateEl.addEventListener('change', () => { filters.startDate = startDateEl.value || null; updateDashboard(); });
endDateEl.addEventListener('change', () => { filters.endDate = endDateEl.value || null; updateDashboard(); });
originFilterEl.addEventListener('change', () => { filters.origin = originFilterEl.value; updateDashboard(); });
agencyFilterEl.addEventListener('change', () => { filters.agency = agencyFilterEl.value; updateDashboard(); });

resetFiltersBtn.addEventListener('click', () => {
    filters = { startDate: null, endDate: null, origin: 'all', agency: 'all' };
    startDateEl.value = '';
    endDateEl.value = '';
    cumulToggleEl.checked = false;
    isCumulativeMode = false;
    startDateEl.disabled = false;
    endDateEl.disabled = false;
    originFilterEl.value = 'all';
    agencyFilterEl.value = 'all';
    updateDashboard();
});

// Modale paramètres
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeModal = document.getElementById('close-modal');
const saveSettings = document.getElementById('save-settings');
const cancelSettings = document.getElementById('cancel-settings');
const inputSeconds = document.getElementById('input-seconds');
const inputAnnualHours = document.getElementById('input-annual-hours');
const inputRevenue = document.getElementById('input-revenue');

settingsBtn.addEventListener('click', () => {
    inputSeconds.value = parameters.secondsPerContact;
    inputAnnualHours.value = parameters.annualHours;
    inputRevenue.value = parameters.revenuePerUser;
    settingsModal.classList.remove('hidden');
});
closeModal.addEventListener('click', () => settingsModal.classList.add('hidden'));
cancelSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));
saveSettings.addEventListener('click', () => {
    parameters.secondsPerContact = parseFloat(inputSeconds.value) || 90;
    parameters.annualHours = parseFloat(inputAnnualHours.value) || 1607;
    parameters.revenuePerUser = parseFloat(inputRevenue.value) || 150000;
    try { localStorage.setItem(PARAMETERS_KEY, JSON.stringify(parameters)); } catch (e) {}
    settingsModal.classList.add('hidden');
    updateDashboard();
});

// ==================== INIT ====================
(async function init() {
    const saved = localStorage.getItem(PARAMETERS_KEY);
    if (saved) {
        try { Object.assign(parameters, JSON.parse(saved)); } catch (e) {}
    }

    // Pas de cache de réponse webhook : les URLs sont SIGNÉES (12h).
    localStorage.removeItem('roi_auth_result');

    const storedPwd = localStorage.getItem('roi_password');
    if (storedPwd) {
        const ok = await authenticateWithPassword(storedPwd);
        if (ok) { await loadData(); return; }
    }

    loadingEl.classList.add('hidden');
    const loginModal = document.createElement('div');
    loginModal.className = 'fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50';
    loginModal.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl p-8 w-96">
            <h2 class="text-xl font-bold text-gray-900 mb-6">Accès sécurisé</h2>
            <form id="login-form">
                <input type="password" id="pwd-input" placeholder="Mot de passe"
                    class="w-full px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500 mb-4" required />
                <p id="login-error" class="hidden text-red-600 text-sm mb-3">Mot de passe incorrect.</p>
                <button type="submit" class="w-full px-4 py-3 bg-cyan-600 text-white rounded-md hover:bg-cyan-700 font-medium">Se connecter</button>
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
