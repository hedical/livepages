// Configuration
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordROI';
const POPULATION_CSV_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/population_cible.csv';

// Data URL fetched from the webhook after authentication (n8n must expose GEOTECH_URL).
let DATA_URL = '';

// State
let allData = [];
let availableAgencies = [];
let availableDRs = [];
let agencyPopulation = {};
let agencyToDR = {};
let dateChart = null;
let tableSortState = { column: 'operations', ascending: false };
let isCumulativeMode = false;

const filters = {
    startDate: null,
    endDate: null,
    dr: null,
    agence: null,
};

// DOM Elements
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const errorMessageEl = document.getElementById('error-message');
const mainContentEl = document.getElementById('main-content');
const startDateFilterEl = document.getElementById('start-date-filter');
const endDateFilterEl = document.getElementById('end-date-filter');
const drFilterEl = document.getElementById('dr-filter');
const agencyFilterEl = document.getElementById('agency-filter');
const resetFiltersBtn = document.getElementById('reset-filters');
const agencyTableBodyEl = document.getElementById('agency-table-body');
const firstDateTextEl = document.getElementById('first-date-text');
const cumulToggleEl = document.getElementById('cumul-toggle');

// KPI Elements
const totalOperationsEl = document.getElementById('total-operations');
const totalNoticesEl = document.getElementById('total-notices');
const totalReportsEl = document.getElementById('total-reports');
const totalUsersEl = document.getElementById('total-users');

// ==================== UTILITY FUNCTIONS ====================

function parseDate(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
}

// Extract agency code from contract number (e.g., "C-MECT-2026-20-183275" → "MECT")
function extractAgency(contractNumber) {
    if (!contractNumber || typeof contractNumber !== 'string') return null;
    const match = contractNumber.match(/C-([A-Z0-9]+)-/);
    return match && match[1] ? match[1] : null;
}

function getCurrentMonthRange() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
    return {
        startDate: `${year}-${month}-01`,
        endDate: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
    };
}

function formatFirstDate(date) {
    if (!date) return '-';
    const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    return `Depuis le ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function getFirstDate(data) {
    let earliest = null;
    data.forEach(item => {
        const d = parseDate(item.createdAt);
        if (d && (!earliest || d < earliest)) earliest = d;
    });
    return earliest;
}

function formatNumber(num) {
    return new Intl.NumberFormat('fr-FR').format(Math.round(num));
}

// ==================== PARSING ====================

// Parse JSON output of Metabase card 139 — one row per event (Notice or Report).
function parseGeotechJSON(jsonArray) {
    if (!Array.isArray(jsonArray)) {
        console.warn('Invalid JSON array for geotech');
        return [];
    }

    const data = [];
    jsonArray.forEach(item => {
        const eventName = (item['EventName'] || '').trim();
        const isNotice = eventName === 'Create Notice From AI Geotech';
        const isReport = eventName === 'Create Report From AI Geotech';
        if (!isNotice && !isReport) return; // safety net — SQL already filters but just in case

        const contractNumber = (item['ContractNumber'] || '').trim();
        const agencyCode = extractAgency(contractNumber);

        data.push({
            eventId: item['EventId'] || '',
            eventName,
            isNotice,
            isReport,
            createdAt: (item['EventDate'] || '').trim(),
            deliverableId: (item['DeliverableId'] || '').trim(),
            reportId: (item['ReportId'] || '').trim(),
            reportName: (item['ReportName'] || '').trim(),
            noticesCount: parseInt(item['NoticesCount']) || 0,
            contractNumber,
            agencyCode,
            email: (item['UserEmail'] || '').trim(),
            agency: (item['Agence'] || '').trim(),
            direction: (item['DR'] || '').trim(),
        });
    });
    console.log('Parsed', data.length, 'geotech events');
    return data;
}

// Parse n8n CSV envelope ([{ data: "csv..." }]) — simple split (no quoted commas in this dataset).
function parseGeotechCSV(csvString) {
    if (!csvString || typeof csvString !== 'string') return [];
    const lines = csvString.split('\n').filter(l => l.trim() !== '');
    if (lines.length < 2) return [];
    const header = lines[0].split(',').map(h => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < header.length) continue;
        const row = {};
        header.forEach((key, idx) => {
            row[key] = (parts[idx] ?? '').trim();
        });
        rows.push(row);
    }
    return parseGeotechJSON(rows);
}

// ==================== POPULATION ====================

async function loadAgencyPopulation() {
    try {
        const response = await fetch(POPULATION_CSV_URL);
        if (!response.ok) return { population: {}, drMapping: {} };
        const csvText = await response.text();
        const lines = csvText.split('\n').filter(l => l.trim() !== '');
        const population = {};
        const drMapping = {};
        const separator = lines[0] && lines[0].includes(';') ? ';' : ',';
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(separator);
            if (parts.length >= 3) {
                const dr = parts[0].trim();
                const agencyCode = parts[1].trim();
                const effectif = parseInt(parts[2].trim());
                if (agencyCode && !isNaN(effectif)) {
                    population[agencyCode] = effectif;
                    drMapping[agencyCode] = dr;
                }
            }
        }
        return { population, drMapping };
    } catch (e) {
        console.warn('Could not load agency population:', e);
        return { population: {}, drMapping: {} };
    }
}

// ==================== FILTERS ====================

function filterByDateRange(data, startDate, endDate) {
    if (!startDate && !endDate) return data;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (end) end.setHours(23, 59, 59, 999);
    return data.filter(item => {
        const date = parseDate(item.createdAt);
        if (!date) return false;
        if (start && date < start) return false;
        if (end && date > end) return false;
        return true;
    });
}

function filterByAgence(data, agence) {
    if (!agence || agence === 'all') return data;
    return data.filter(item => item.agency === agence);
}

function filterByDR(data, dr) {
    if (!dr || dr === 'all') return data;
    return data.filter(item => {
        // Prefer the DR carried by the event itself; fall back to population mapping.
        if (item.direction) return item.direction === dr;
        if (!item.agencyCode) return false;
        return agencyToDR[item.agencyCode] === dr;
    });
}

function processData(data, currentFilters, skipDateFilter = false) {
    let filtered = data;
    if (!skipDateFilter) {
        filtered = filterByDateRange(filtered, currentFilters.startDate, currentFilters.endDate);
    }
    filtered = filterByDR(filtered, currentFilters.dr);
    filtered = filterByAgence(filtered, currentFilters.agence);

    const uniqueUsers = new Set();
    const uniqueDeliverables = new Set();
    let totalNotices = 0;
    let totalReports = 0;

    filtered.forEach(item => {
        if (item.email) uniqueUsers.add(item.email);
        if (item.deliverableId) uniqueDeliverables.add(item.deliverableId);
        if (item.isNotice) totalNotices += item.noticesCount || 1;
        if (item.isReport) totalReports++;
    });

    return {
        totalOperations: uniqueDeliverables.size,
        totalNotices,
        totalReports,
        totalUsers: uniqueUsers.size,
        filteredData: filtered,
    };
}

// ==================== FILTER POPULATION ====================

function getAvailableAgencies(data) {
    const set = new Set();
    data.forEach(item => { if (item.agency) set.add(item.agency); });
    return Array.from(set).sort();
}

function getAvailableDRs(data) {
    const set = new Set();
    data.forEach(item => {
        if (item.direction) set.add(item.direction);
        else if (item.agencyCode && agencyToDR[item.agencyCode]) set.add(agencyToDR[item.agencyCode]);
    });
    return Array.from(set).sort();
}

function populateDRFilter() {
    drFilterEl.innerHTML = '<option value="all">Toutes les directions</option>';
    availableDRs.forEach(dr => {
        const opt = document.createElement('option');
        opt.value = dr;
        opt.textContent = dr;
        drFilterEl.appendChild(opt);
    });
}

function populateAgencyFilter() {
    agencyFilterEl.innerHTML = '<option value="all">Toutes les agences</option>';
    availableAgencies.forEach(agency => {
        const opt = document.createElement('option');
        opt.value = agency;
        opt.textContent = agency;
        agencyFilterEl.appendChild(opt);
    });
}

// ==================== TABLE ====================

function sortTable(column) {
    if (tableSortState.column === column) {
        tableSortState.ascending = !tableSortState.ascending;
    } else {
        tableSortState.column = column;
        tableSortState.ascending = false;
    }
    updateSortIcons();
    updateKPIs();
}
window.sortTable = sortTable;

function updateSortIcons() {
    const columns = ['dr', 'agency', 'operations', 'notices', 'reports', 'users', 'rate'];
    columns.forEach(col => {
        const icon = document.getElementById(`sort-icon-${col}`);
        if (!icon) return;
        if (tableSortState.column === col) {
            icon.textContent = tableSortState.ascending ? '↑' : '↓';
            icon.className = 'ml-1 text-blue-600';
        } else {
            icon.textContent = '↕';
            icon.className = 'ml-1 text-gray-400';
        }
    });
}

function updateAgencyTable(data) {
    const agencyStats = {};

    data.forEach(item => {
        if (!item.agency) return;
        if (!agencyStats[item.agency]) {
            agencyStats[item.agency] = {
                operations: new Set(),
                notices: 0,
                reports: 0,
                users: new Set(),
                agencyCode: item.agencyCode,
                direction: item.direction || (item.agencyCode ? agencyToDR[item.agencyCode] : ''),
            };
        }
        const s = agencyStats[item.agency];
        if (item.deliverableId) s.operations.add(item.deliverableId);
        if (item.isNotice) s.notices += item.noticesCount || 1;
        if (item.isReport) s.reports++;
        if (item.email) s.users.add(item.email);
    });

    const agencies = Object.keys(agencyStats);
    const sorted = agencies.sort((a, b) => {
        let cmp = 0;
        switch (tableSortState.column) {
            case 'dr':         cmp = (agencyStats[a].direction || '').localeCompare(agencyStats[b].direction || ''); break;
            case 'agency':     cmp = a.localeCompare(b); break;
            case 'operations': cmp = agencyStats[a].operations.size - agencyStats[b].operations.size; break;
            case 'notices':    cmp = agencyStats[a].notices - agencyStats[b].notices; break;
            case 'reports':    cmp = agencyStats[a].reports - agencyStats[b].reports; break;
            case 'users':      cmp = agencyStats[a].users.size - agencyStats[b].users.size; break;
            case 'rate': {
                const codeA = agencyStats[a].agencyCode;
                const codeB = agencyStats[b].agencyCode;
                const effA = codeA ? agencyPopulation[codeA] || 0 : 0;
                const effB = codeB ? agencyPopulation[codeB] || 0 : 0;
                const rA = effA > 0 ? agencyStats[a].users.size / effA : 0;
                const rB = effB > 0 ? agencyStats[b].users.size / effB : 0;
                cmp = rA - rB;
                break;
            }
            default: cmp = agencyStats[a].operations.size - agencyStats[b].operations.size;
        }
        return tableSortState.ascending ? cmp : -cmp;
    });

    agencyTableBodyEl.innerHTML = '';
    if (sorted.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="7" class="px-6 py-4 text-center text-gray-500">Aucune donnée disponible pour cette période</td>`;
        agencyTableBodyEl.appendChild(row);
        return;
    }

    sorted.forEach((agency, index) => {
        const s = agencyStats[agency];
        const dr = s.direction || '-';
        const effectif = s.agencyCode ? agencyPopulation[s.agencyCode] || 0 : 0;
        const tauxAdoption = effectif > 0 ? ((s.users.size / effectif) * 100).toFixed(1) : '-';

        const row = document.createElement('tr');
        row.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${dr}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${agency}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-blue-600 font-semibold">${s.operations.size}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${s.notices}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${s.reports}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${s.users.size}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${effectif > 0 ? 'text-blue-600 font-semibold' : 'text-gray-500'}">
                ${effectif > 0 ? `${tauxAdoption}%` : '-'}
            </td>
        `;
        agencyTableBodyEl.appendChild(row);
    });
}

// ==================== CHART ====================

function getChartData() {
    let filtered = allData;
    filtered = filterByDR(filtered, filters.dr);
    filtered = filterByAgence(filtered, filters.agence);
    return filtered;
}

function updateChart(data) {
    const monthGroups = {};
    data.forEach(item => {
        const date = parseDate(item.createdAt);
        if (!date) return;
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthGroups[key]) {
            monthGroups[key] = { deliverables: new Set(), notices: 0, reports: 0 };
        }
        if (item.deliverableId) monthGroups[key].deliverables.add(item.deliverableId);
        if (item.isNotice) monthGroups[key].notices += item.noticesCount || 1;
        if (item.isReport) monthGroups[key].reports++;
    });

    const sortedMonths = Object.keys(monthGroups).sort();
    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const labels = sortedMonths.map(key => {
        const [year, month] = key.split('-');
        return `${monthNames[parseInt(month) - 1]} ${year}`;
    });
    const opsData = sortedMonths.map(k => monthGroups[k].deliverables.size);
    const noticesData = sortedMonths.map(k => monthGroups[k].notices);
    const reportsData = sortedMonths.map(k => monthGroups[k].reports);

    const canvas = document.getElementById('dateChart');
    if (!canvas) return;
    if (dateChart) dateChart.destroy();

    dateChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Opérations IA',
                    data: opsData,
                    backgroundColor: 'rgba(59, 130, 246, 0.85)',
                    borderColor: 'rgba(37, 99, 235, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                },
                {
                    label: 'Notices créées',
                    data: noticesData,
                    backgroundColor: 'rgba(16, 185, 129, 0.75)',
                    borderColor: 'rgba(5, 150, 105, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                },
                {
                    label: 'Rapports créés',
                    data: reportsData,
                    backgroundColor: 'rgba(139, 92, 246, 0.75)',
                    borderColor: 'rgba(109, 40, 217, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2.5,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true, position: 'top',
                    labels: { font: { size: 13, weight: '500' }, color: '#1F2937', padding: 15, usePointStyle: true, pointStyle: 'rectRounded' },
                },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    titleColor: '#F9FAFB', bodyColor: '#E5E7EB',
                    padding: 12, cornerRadius: 8,
                    callbacks: {
                        label: ctx => `${ctx.dataset.label} : ${formatNumber(ctx.parsed.y)}`,
                    },
                },
            },
            scales: {
                x: { grid: { display: false }, title: { display: true, text: 'Période', font: { size: 14, weight: 'bold' }, color: '#374151' } },
                y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Comptes', font: { size: 14, weight: 'bold' }, color: '#374151' } },
            },
        },
    });
}

// ==================== ORCHESTRATION ====================

function updateKPIs() {
    const kpis = processData(allData, filters, isCumulativeMode);

    totalOperationsEl.textContent = formatNumber(kpis.totalOperations);
    totalNoticesEl.textContent = formatNumber(kpis.totalNotices);
    totalReportsEl.textContent = formatNumber(kpis.totalReports);
    totalUsersEl.textContent = formatNumber(kpis.totalUsers);

    const firstDate = getFirstDate(allData);
    if (firstDate) firstDateTextEl.textContent = formatFirstDate(firstDate);

    updateAgencyTable(kpis.filteredData);
    updateSortIcons();
    updateChart(getChartData());
}

// ==================== EVENT LISTENERS ====================

startDateFilterEl.addEventListener('change', e => {
    filters.startDate = e.target.value || null;
    updateKPIs();
});
endDateFilterEl.addEventListener('change', e => {
    filters.endDate = e.target.value || null;
    updateKPIs();
});
drFilterEl.addEventListener('change', e => {
    filters.dr = e.target.value === 'all' ? null : e.target.value;
    updateKPIs();
});
agencyFilterEl.addEventListener('change', e => {
    filters.agence = e.target.value === 'all' ? null : e.target.value;
    updateKPIs();
});
resetFiltersBtn.addEventListener('click', () => {
    const range = getCurrentMonthRange();
    startDateFilterEl.value = range.startDate;
    endDateFilterEl.value = range.endDate;
    drFilterEl.value = 'all';
    agencyFilterEl.value = 'all';
    filters.startDate = range.startDate;
    filters.endDate = range.endDate;
    filters.dr = null;
    filters.agence = null;
    cumulToggleEl.checked = false;
    isCumulativeMode = false;
    updateKPIs();
});
cumulToggleEl.addEventListener('change', e => {
    isCumulativeMode = e.target.checked;
    updateKPIs();
});

// ==================== AUTH + INIT ====================

// Returns the GEOTECH_URL via the webhook (uses cached response if available).
async function authenticateAndGetURL() {
    const storedPassword = localStorage.getItem('roi_password');
    if (!storedPassword) {
        window.location.href = 'index.html';
        return null;
    }

    // Use cached response when present (saves a webhook round-trip after returning from index).
    const cached = localStorage.getItem('roi_auth_result');
    const tryParse = (text) => {
        const m = text.match(/GEOTECH_URL\s*=\s*['"]([^'"]+)['"]/);
        return m ? m[1] : null;
    };
    if (cached) {
        const url = tryParse(cached);
        if (url) return url;
    }

    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: storedPassword,
        });
        if (!response.ok) {
            localStorage.removeItem('roi_password');
            window.location.href = 'index.html';
            return null;
        }
        const result = await response.text();
        localStorage.setItem('roi_auth_result', result);
        return tryParse(result);
    } catch (e) {
        console.error('Authentication error:', e);
        return null;
    }
}

async function init() {
    try {
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');
        mainContentEl.classList.add('hidden');

        DATA_URL = await authenticateAndGetURL();

        // Load agency population in parallel — does not require auth.
        const populationPromise = loadAgencyPopulation();

        if (!DATA_URL) {
            const populationResult = await populationPromise;
            agencyPopulation = populationResult.population;
            agencyToDR = populationResult.drMapping;
            loadingEl.classList.add('hidden');
            errorEl.classList.remove('hidden');
            errorMessageEl.innerHTML = `Aucune URL <code>GEOTECH_URL</code> n'est exposée par le webhook. Ajoute la ligne <code>GEOTECH_URL = '&lt;supabase-url&gt;'</code> à la réponse n8n (cf. <a href="metabase-queries.md" class="underline">metabase-queries.md</a>, card 139).`;
            return;
        }

        const [dataResponse, populationResult] = await Promise.all([
            fetch(DATA_URL),
            populationPromise,
        ]);

        agencyPopulation = populationResult.population;
        agencyToDR = populationResult.drMapping;

        if (!dataResponse.ok) {
            throw new Error(`HTTP error ${dataResponse.status}`);
        }

        const rawText = await dataResponse.text();
        let payload = null;
        try { payload = JSON.parse(rawText); } catch (_) { /* raw CSV fallthrough */ }

        if (payload === null) {
            allData = parseGeotechCSV(rawText);
        } else if (Array.isArray(payload) && payload.length && payload[0].data && typeof payload[0].data === 'string') {
            const inner = payload[0].data;
            let innerJson = null;
            try { innerJson = JSON.parse(inner); } catch (_) {}
            allData = Array.isArray(innerJson) ? parseGeotechJSON(innerJson) : parseGeotechCSV(inner);
        } else if (payload && payload.data && typeof payload.data === 'string') {
            const inner = payload.data;
            let innerJson = null;
            try { innerJson = JSON.parse(inner); } catch (_) {}
            allData = Array.isArray(innerJson) ? parseGeotechJSON(innerJson) : parseGeotechCSV(inner);
        } else if (Array.isArray(payload)) {
            allData = parseGeotechJSON(payload);
        }
        console.log('Loaded', allData.length, 'geotech events');

        availableAgencies = getAvailableAgencies(allData);
        availableDRs = getAvailableDRs(allData);
        populateAgencyFilter();
        populateDRFilter();

        const range = getCurrentMonthRange();
        startDateFilterEl.value = range.startDate;
        endDateFilterEl.value = range.endDate;
        filters.startDate = range.startDate;
        filters.endDate = range.endDate;

        updateKPIs();

        loadingEl.classList.add('hidden');
        mainContentEl.classList.remove('hidden');
    } catch (error) {
        console.error('Error loading data:', error);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
        errorMessageEl.textContent = `Erreur lors du chargement des données : ${error.message}`;
    }
}

init();
