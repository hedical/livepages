// Explorateur des générations "Analyse géotechnique".
// Même source de données que analyse-geotechnique.js (card Metabase 139 via GEOTECH_URL),
// mais orienté détail : qui a utilisé la fonctionnalité, sur quelles opérations, quand.

// Configuration
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordROI';
// URL population : remplacée par l'URL signée du webhook après auth
// (fallback public conservé le temps de la transition bucket privé).
let POPULATION_CSV_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/population_cible.csv';

// Data URL fetched from the webhook after authentication (n8n must expose GEOTECH_URL).
let DATA_URL = '';

const PAGE_SIZE = 50;

// State
let allData = [];
let availableAgencies = [];
let availableDRs = [];
let agencyToDR = {};
let currentEvents = [];
let currentPage = 1;
let userSortState = { column: 'operations', ascending: false };
let eventSortState = { column: 'createdAt', ascending: false };

const filters = {
    startDate: null,
    endDate: null,
    dr: null,
    agence: null,
    type: 'all',
    search: '',
    user: null,
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
const typeFilterEl = document.getElementById('type-filter');
const searchInputEl = document.getElementById('search-input');
const resetFiltersBtn = document.getElementById('reset-filters');
const exportCsvBtn = document.getElementById('export-csv');
const cumulToggleEl = document.getElementById('cumul-toggle');
const firstDateTextEl = document.getElementById('first-date-text');
const usersTableBodyEl = document.getElementById('users-table-body');
const eventsTableBodyEl = document.getElementById('events-table-body');
const selectedUserLabelEl = document.getElementById('selected-user-label');
const clearUserBtn = document.getElementById('clear-user');
const eventsRangeEl = document.getElementById('events-range');
const pageIndicatorEl = document.getElementById('page-indicator');
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');

// KPI Elements
const kpiEventsEl = document.getElementById('kpi-events');
const kpiOperationsEl = document.getElementById('kpi-operations');
const kpiNoticesEl = document.getElementById('kpi-notices');
const kpiReportsEl = document.getElementById('kpi-reports');
const kpiUsersEl = document.getElementById('kpi-users');

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

function formatDateTime(dateString) {
    const d = parseDate(dateString);
    if (!d) return '-';
    return d.toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function formatDateShort(dateString) {
    const d = parseDate(dateString);
    if (!d) return '-';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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

// Only used here for the agency → DR fallback mapping (no adoption rate on this page).
async function loadAgencyPopulation() {
    try {
        const response = await fetch(POPULATION_CSV_URL);
        if (!response.ok) return { drMapping: {} };
        const csvText = await response.text();
        const lines = csvText.split('\n').filter(l => l.trim() !== '');
        const drMapping = {};
        const separator = lines[0] && lines[0].includes(';') ? ';' : ',';
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(separator);
            if (parts.length >= 2) {
                const dr = parts[0].trim();
                const agencyCode = parts[1].trim();
                if (agencyCode) drMapping[agencyCode] = dr;
            }
        }
        return { drMapping };
    } catch (e) {
        console.warn('Could not load agency population:', e);
        return { drMapping: {} };
    }
}

// ==================== FILTERS ====================

function getDirection(item) {
    if (item.direction) return item.direction;
    if (item.agencyCode && agencyToDR[item.agencyCode]) return agencyToDR[item.agencyCode];
    return '';
}

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
    return data.filter(item => getDirection(item) === dr);
}

function filterByType(data, type) {
    if (!type || type === 'all') return data;
    if (type === 'notice') return data.filter(item => item.isNotice);
    if (type === 'report') return data.filter(item => item.isReport);
    return data;
}

function filterBySearch(data, search) {
    const term = (search || '').trim().toLowerCase();
    if (!term) return data;
    return data.filter(item => {
        return (item.email && item.email.toLowerCase().includes(term))
            || (item.agency && item.agency.toLowerCase().includes(term))
            || (item.contractNumber && item.contractNumber.toLowerCase().includes(term))
            || (item.reportName && item.reportName.toLowerCase().includes(term));
    });
}

// Everything except the "selected user" drill-down: feeds the KPIs and the users table.
function getFilteredData() {
    let filtered = allData;
    if (!cumulToggleEl.checked) {
        filtered = filterByDateRange(filtered, filters.startDate, filters.endDate);
    }
    filtered = filterByDR(filtered, filters.dr);
    filtered = filterByAgence(filtered, filters.agence);
    filtered = filterByType(filtered, filters.type);
    filtered = filterBySearch(filtered, filters.search);
    return filtered;
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
        const dr = getDirection(item);
        if (dr) set.add(dr);
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

// ==================== KPIs ====================

function updateKPIs(data) {
    const uniqueUsers = new Set();
    const uniqueDeliverables = new Set();
    let totalNotices = 0;
    let totalReports = 0;

    data.forEach(item => {
        if (item.email) uniqueUsers.add(item.email);
        if (item.deliverableId) uniqueDeliverables.add(item.deliverableId);
        if (item.isNotice) totalNotices += item.noticesCount || 1;
        if (item.isReport) totalReports++;
    });

    kpiEventsEl.textContent = formatNumber(data.length);
    kpiOperationsEl.textContent = formatNumber(uniqueDeliverables.size);
    kpiNoticesEl.textContent = formatNumber(totalNotices);
    kpiReportsEl.textContent = formatNumber(totalReports);
    kpiUsersEl.textContent = formatNumber(uniqueUsers.size);
}

// ==================== USERS TABLE ====================

function buildUserStats(data) {
    const stats = {};

    data.forEach(item => {
        const email = item.email || '(email inconnu)';
        if (!stats[email]) {
            stats[email] = {
                email,
                agencies: new Set(),
                directions: new Set(),
                operations: new Set(),
                notices: 0,
                reports: 0,
                events: 0,
                firstUse: null,
                lastUse: null,
            };
        }
        const s = stats[email];
        if (item.agency) s.agencies.add(item.agency);
        const dr = getDirection(item);
        if (dr) s.directions.add(dr);
        if (item.deliverableId) s.operations.add(item.deliverableId);
        if (item.isNotice) s.notices += item.noticesCount || 1;
        if (item.isReport) s.reports++;
        s.events++;
        const d = parseDate(item.createdAt);
        if (d) {
            if (!s.firstUse || d < s.firstUse) s.firstUse = d;
            if (!s.lastUse || d > s.lastUse) s.lastUse = d;
        }
    });

    return Object.values(stats).map(s => ({
        email: s.email,
        agency: Array.from(s.agencies).sort().join(', '),
        direction: Array.from(s.directions).sort().join(', '),
        operations: s.operations.size,
        notices: s.notices,
        reports: s.reports,
        events: s.events,
        firstUse: s.firstUse,
        lastUse: s.lastUse,
    }));
}

function sortUsers(column) {
    if (userSortState.column === column) {
        userSortState.ascending = !userSortState.ascending;
    } else {
        userSortState.column = column;
        userSortState.ascending = column === 'email' || column === 'agency' || column === 'direction';
    }
    render();
}
window.sortUsers = sortUsers;

function updateUserSortIcons() {
    ['email', 'agency', 'direction', 'operations', 'notices', 'reports', 'firstUse', 'lastUse'].forEach(col => {
        const icon = document.getElementById(`usort-icon-${col}`);
        if (!icon) return;
        if (userSortState.column === col) {
            icon.textContent = userSortState.ascending ? '↑' : '↓';
            icon.className = 'ml-1 text-blue-600';
        } else {
            icon.textContent = '↕';
            icon.className = 'ml-1 text-gray-400';
        }
    });
}

function renderUsersTable(userStats) {
    const col = userSortState.column;
    const dir = userSortState.ascending ? 1 : -1;

    const sorted = userStats.slice().sort((a, b) => {
        let av = a[col];
        let bv = b[col];
        if (col === 'firstUse' || col === 'lastUse') {
            av = av ? av.getTime() : 0;
            bv = bv ? bv.getTime() : 0;
            return (av - bv) * dir;
        }
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av || '').localeCompare(String(bv || ''), 'fr') * dir;
    });

    if (sorted.length === 0) {
        usersTableBodyEl.innerHTML = `
            <tr>
                <td colspan="8" class="px-6 py-8 text-center text-sm text-gray-500">
                    Aucun utilisateur ne correspond aux filtres sélectionnés.
                </td>
            </tr>`;
        return;
    }

    usersTableBodyEl.innerHTML = sorted.map(u => {
        const isSelected = filters.user === u.email;
        const rowClass = isSelected ? 'bg-blue-50 cursor-pointer' : 'hover:bg-gray-50 cursor-pointer';
        return `
            <tr class="${rowClass}" data-email="${escapeHtml(u.email)}">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${escapeHtml(u.email)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${escapeHtml(u.agency) || '-'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${escapeHtml(u.direction) || '-'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-blue-600">${formatNumber(u.operations)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatNumber(u.notices)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatNumber(u.reports)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${u.firstUse ? formatDateShort(u.firstUse.toISOString()) : '-'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${u.lastUse ? formatDateShort(u.lastUse.toISOString()) : '-'}</td>
            </tr>`;
    }).join('');
}

function selectUser(email) {
    filters.user = filters.user === email ? null : email;
    currentPage = 1;
    render();
    if (filters.user) {
        const section = eventsTableBodyEl.closest('div.mb-10');
        if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Délégation : les lignes sont réécrites à chaque render, un listener sur le tbody suffit
// et évite d'injecter l'email dans un attribut onclick.
usersTableBodyEl.addEventListener('click', e => {
    const row = e.target.closest('tr[data-email]');
    if (row) selectUser(row.dataset.email);
});

// ==================== EVENTS TABLE ====================

function sortEvents(column) {
    if (eventSortState.column === column) {
        eventSortState.ascending = !eventSortState.ascending;
    } else {
        eventSortState.column = column;
        eventSortState.ascending = column !== 'createdAt' && column !== 'noticesCount';
    }
    currentPage = 1;
    render();
}
window.sortEvents = sortEvents;

function updateEventSortIcons() {
    ['createdAt', 'email', 'agency', 'contractNumber', 'noticesCount'].forEach(col => {
        const icon = document.getElementById(`esort-icon-${col}`);
        if (!icon) return;
        if (eventSortState.column === col) {
            icon.textContent = eventSortState.ascending ? '↑' : '↓';
            icon.className = 'ml-1 text-blue-600';
        } else {
            icon.textContent = '↕';
            icon.className = 'ml-1 text-gray-400';
        }
    });
}

function sortEventList(data) {
    const col = eventSortState.column;
    const dir = eventSortState.ascending ? 1 : -1;
    return data.slice().sort((a, b) => {
        if (col === 'createdAt') {
            const ad = parseDate(a.createdAt);
            const bd = parseDate(b.createdAt);
            return ((ad ? ad.getTime() : 0) - (bd ? bd.getTime() : 0)) * dir;
        }
        if (col === 'noticesCount') return ((a.noticesCount || 0) - (b.noticesCount || 0)) * dir;
        return String(a[col] || '').localeCompare(String(b[col] || ''), 'fr') * dir;
    });
}

function renderEventsTable() {
    const totalPages = Math.max(1, Math.ceil(currentEvents.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = currentEvents.slice(start, start + PAGE_SIZE);

    if (pageItems.length === 0) {
        eventsTableBodyEl.innerHTML = `
            <tr>
                <td colspan="7" class="px-6 py-8 text-center text-sm text-gray-500">
                    Aucune génération ne correspond aux filtres sélectionnés.
                </td>
            </tr>`;
    } else {
        eventsTableBodyEl.innerHTML = pageItems.map(item => {
            const badge = item.isNotice
                ? '<span class="px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800">Notice</span>'
                : '<span class="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800">Rapport</span>';
            return `
                <tr class="hover:bg-gray-50">
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${formatDateTime(item.createdAt)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${escapeHtml(item.email) || '-'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${escapeHtml(item.agency) || '-'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm">${badge}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-xs font-mono text-gray-600">${escapeHtml(item.contractNumber) || '-'}</td>
                    <td class="px-6 py-4 text-sm text-gray-600 max-w-xs truncate" title="${escapeHtml(item.reportName)}">${escapeHtml(item.reportName) || '-'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${item.isNotice ? formatNumber(item.noticesCount || 1) : '-'}</td>
                </tr>`;
        }).join('');
    }

    const from = currentEvents.length === 0 ? 0 : start + 1;
    const to = Math.min(start + PAGE_SIZE, currentEvents.length);
    eventsRangeEl.textContent = `${formatNumber(from)} - ${formatNumber(to)} sur ${formatNumber(currentEvents.length)} générations`;
    pageIndicatorEl.textContent = `${currentPage} / ${totalPages}`;
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;
}

// ==================== RENDER ====================

function render() {
    const filtered = getFilteredData();

    updateKPIs(filtered);

    const userStats = buildUserStats(filtered);
    updateUserSortIcons();
    renderUsersTable(userStats);

    const eventsForUser = filters.user
        ? filtered.filter(item => (item.email || '(email inconnu)') === filters.user)
        : filtered;
    currentEvents = sortEventList(eventsForUser);

    if (filters.user) {
        selectedUserLabelEl.textContent = `Filtré sur ${filters.user}`;
        clearUserBtn.classList.remove('hidden');
    } else {
        selectedUserLabelEl.textContent = 'Tous les utilisateurs';
        clearUserBtn.classList.add('hidden');
    }

    updateEventSortIcons();
    renderEventsTable();
}

// ==================== CSV EXPORT ====================

function csvCell(value) {
    const s = value === null || value === undefined ? '' : String(value);
    return `"${s.replace(/"/g, '""')}"`;
}

function exportCsv() {
    const header = ['Date', 'Utilisateur', 'Agence', 'Direction régionale', 'Type', 'Contrat', 'Rapport', 'Notices', 'DeliverableId', 'ReportId'];
    const rows = currentEvents.map(item => [
        item.createdAt,
        item.email,
        item.agency,
        getDirection(item),
        item.isNotice ? 'Notice' : 'Rapport',
        item.contractNumber,
        item.reportName,
        item.isNotice ? (item.noticesCount || 1) : '',
        item.deliverableId,
        item.reportId,
    ].map(csvCell).join(';'));

    const csv = '﻿' + [header.map(csvCell).join(';')].concat(rows).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `generations-geotechnique-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ==================== EVENT LISTENERS ====================

startDateFilterEl.addEventListener('change', e => {
    filters.startDate = e.target.value || null;
    currentPage = 1;
    render();
});

endDateFilterEl.addEventListener('change', e => {
    filters.endDate = e.target.value || null;
    currentPage = 1;
    render();
});

drFilterEl.addEventListener('change', e => {
    filters.dr = e.target.value === 'all' ? null : e.target.value;
    currentPage = 1;
    render();
});

agencyFilterEl.addEventListener('change', e => {
    filters.agence = e.target.value === 'all' ? null : e.target.value;
    currentPage = 1;
    render();
});

typeFilterEl.addEventListener('change', e => {
    filters.type = e.target.value;
    currentPage = 1;
    render();
});

let searchDebounce = null;
searchInputEl.addEventListener('input', e => {
    const value = e.target.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
        filters.search = value;
        currentPage = 1;
        render();
    }, 200);
});

cumulToggleEl.addEventListener('change', () => {
    const disabled = cumulToggleEl.checked;
    startDateFilterEl.disabled = disabled;
    endDateFilterEl.disabled = disabled;
    currentPage = 1;
    render();
});

resetFiltersBtn.addEventListener('click', () => {
    const range = getCurrentMonthRange();
    startDateFilterEl.value = range.startDate;
    endDateFilterEl.value = range.endDate;
    startDateFilterEl.disabled = false;
    endDateFilterEl.disabled = false;
    drFilterEl.value = 'all';
    agencyFilterEl.value = 'all';
    typeFilterEl.value = 'all';
    searchInputEl.value = '';
    cumulToggleEl.checked = false;
    filters.startDate = range.startDate;
    filters.endDate = range.endDate;
    filters.dr = null;
    filters.agence = null;
    filters.type = 'all';
    filters.search = '';
    filters.user = null;
    currentPage = 1;
    render();
});

clearUserBtn.addEventListener('click', () => {
    filters.user = null;
    currentPage = 1;
    render();
});

exportCsvBtn.addEventListener('click', exportCsv);

prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        renderEventsTable();
    }
});

nextPageBtn.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(currentEvents.length / PAGE_SIZE));
    if (currentPage < totalPages) {
        currentPage++;
        renderEventsTable();
    }
});

// ==================== AUTH + INIT ====================

// Returns the GEOTECH_URL via the webhook.
// Pas de cache : les URLs renvoyées sont SIGNÉES (validité 12h), une réponse
// mise en cache servirait des liens expirés.
async function authenticateAndGetURL() {
    const storedPassword = localStorage.getItem('roi_password');
    if (!storedPassword) {
        window.location.href = 'index.html';
        return null;
    }
    localStorage.removeItem('roi_auth_result'); // purge l'ancien cache

    const tryParse = (text) => {
        const m = text.match(/GEOTECH_URL\s*=\s*['"]([^'"]+)['"]/);
        return m ? m[1] : null;
    };

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
        // URL population signée exposée par le webhook
        const popMatch = result.match(/POPULATION_CIBLE_URL\s*=\s*['"]([^'"]+)['"]/);
        if (popMatch) POPULATION_CSV_URL = popMatch[1];
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
            await populationPromise;
            loadingEl.classList.add('hidden');
            errorEl.classList.remove('hidden');
            errorMessageEl.innerHTML = `Aucune URL <code>GEOTECH_URL</code> n'est exposée par le webhook. Ajoute la ligne <code>GEOTECH_URL = '&lt;supabase-url&gt;'</code> à la réponse n8n (cf. <a href="metabase-queries.md" class="underline">metabase-queries.md</a>, card 139).`;
            return;
        }

        const [dataResponse, populationResult] = await Promise.all([
            fetch(DATA_URL),
            populationPromise,
        ]);

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

        firstDateTextEl.textContent = formatFirstDate(getFirstDate(allData));

        const range = getCurrentMonthRange();
        startDateFilterEl.value = range.startDate;
        endDateFilterEl.value = range.endDate;
        filters.startDate = range.startDate;
        filters.endDate = range.endDate;

        render();

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
