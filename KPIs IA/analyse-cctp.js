// Analyse CCTP vs Référentiel — brique qualité, source AIDeliverable type
// CCTP_VS_REFERENTIEL (card Metabase 160, 1 ligne = 1 livrable, avis agrégés en SQL).
// Parsing et agrégats dans shared/utils.js (KPI.parseCctpPayload / KPI.aggregateCctp),
// partagés avec la tuile du dashboard (app.js).

// URL population : remplacée par l'URL signée du webhook après auth
// (fallback public conservé le temps de la transition bucket privé).
let POPULATION_CSV_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/population_cible.csv';

// Data URL fetched from the webhook after authentication (n8n must expose ANALYSE_CCTP_URL).
let DATA_URL = '';

// State
let allData = [];
let availableAgencies = [];
let availableDRs = [];
let agencyPopulation = {};
let agencyToDR = {};
let dateChart = null;
let verdictChart = null;
let missionChart = null;
let tableSortState = { column: 'operations', ascending: false };
// Brique lancée mi-septembre 2026 : on ouvre sur « Depuis le début », sinon le
// mois en cours n'en montre qu'une fraction.
let isCumulativeMode = true;

const filters = {
    startDate: null,
    endDate: null,
    dr: null,
    agence: null,
};

const MISSION_LABELS = {
    L: 'L — Solidité des ouvrages',
    P1: 'P1 — Équipements dissociables',
    S: 'S — Sécurité des personnes',
    F: 'F — Fonctionnement des installations',
    PV: "PV — PV d'essais",
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
const recentTableBodyEl = document.getElementById('recent-table-body');
const firstDateTextEl = document.getElementById('first-date-text');
const cumulToggleEl = document.getElementById('cumul-toggle');

const $ = id => document.getElementById(id);

// ==================== UTILITY FUNCTIONS ====================

function parseDate(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
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

// Pourcentage lisible, « — » quand le dénominateur est nul (pas « 0 % »).
function pct(part, total) {
    if (!total) return '—';
    return `${(part / total * 100).toFixed(0)} %`;
}

function plural(n, word) {
    return `${formatNumber(n)} ${word}${n > 1 ? 's' : ''}`;
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
    if (start) start.setHours(0, 0, 0, 0);
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
        if (item.direction) return item.direction === dr;
        if (!item.agencyCode) return false;
        return agencyToDR[item.agencyCode] === dr;
    });
}

function getFilteredData(skipDateFilter) {
    let filtered = allData;
    if (!skipDateFilter) {
        filtered = filterByDateRange(filtered, filters.startDate, filters.endDate);
    }
    filtered = filterByDR(filtered, filters.dr);
    filtered = filterByAgence(filtered, filters.agence);
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
        if (item.direction) set.add(item.direction);
        else if (item.agencyCode && agencyToDR[item.agencyCode]) set.add(agencyToDR[item.agencyCode]);
    });
    return Array.from(set).sort();
}

function populateSelect(el, allLabel, values) {
    el.innerHTML = `<option value="all">${allLabel}</option>`;
    values.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        el.appendChild(opt);
    });
}

// ==================== KPI CARDS ====================

function updateCards(s) {
    $('total-operations').textContent = formatNumber(s.totalOperations);
    $('total-errors').textContent = s.totalErrors
        ? `+ ${plural(s.totalErrors, 'lancement')} en erreur`
        : 'Aucun lancement en erreur';
    $('total-contracts').textContent = formatNumber(s.uniqueContracts);
    $('total-agencies').textContent = formatNumber(s.uniqueAgencies);
    $('total-users').textContent = formatNumber(s.uniqueUsers);

    $('total-avis').textContent = formatNumber(s.totalAvis);
    // La criticité « critique » n'a plus sa carte : elle passe en sous-titre.
    $('avis-per-analysis').textContent = s.totalOperations
        ? `${(s.totalAvis / s.totalOperations).toFixed(1).replace('.', ',')} par analyse · ${formatNumber(s.critique)} critiques (${pct(s.critique, s.totalAvis)})`
        : '—';
    const nonFav = s.suspendu + s.defavorable;
    $('total-non-favorable').textContent = formatNumber(nonFav);
    $('non-favorable-rate').textContent = s.totalAvis
        ? `${pct(nonFav, s.totalAvis)} des avis (${formatNumber(s.defavorable)} défavorables)`
        : '—';
    $('total-avis-repris').textContent = formatNumber(s.avisRepris);
    $('avis-repris-rate').textContent = s.totalAvis ? `${pct(s.avisRepris, s.totalAvis)} des avis émis` : '—';
    $('total-exploitees').textContent = formatNumber(s.analysesExploitees);
    $('exploitees-sub').textContent = s.totalOperations
        ? `${pct(s.analysesExploitees, s.totalOperations)} des analyses (≥ 1 avis repris ou rapport créé)`
        : '—';
}

// ==================== TABLES ====================

function sortTable(column) {
    if (tableSortState.column === column) {
        tableSortState.ascending = !tableSortState.ascending;
    } else {
        tableSortState.column = column;
        tableSortState.ascending = false;
    }
    updateKPIs();
}
window.sortTable = sortTable;

function updateSortIcons() {
    ['dr', 'agency', 'operations', 'contracts', 'users', 'avis', 'exploitees', 'rate'].forEach(col => {
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
    // Regroupement par agence, puis agrégats par le même moteur que les KPIs.
    const groups = {};
    data.forEach(item => {
        if (!item.agency) return;
        if (!groups[item.agency]) {
            groups[item.agency] = {
                items: [],
                agencyCode: item.agencyCode,
                direction: item.direction || (item.agencyCode ? agencyToDR[item.agencyCode] : ''),
            };
        }
        groups[item.agency].items.push(item);
    });
    const rows = Object.keys(groups).map(agency => {
        const g = groups[agency];
        const s = KPI.aggregateCctp(g.items);
        const effectif = g.agencyCode ? agencyPopulation[g.agencyCode] || 0 : 0;
        return {
            agency, direction: g.direction || '-', effectif,
            operations: s.totalOperations, contracts: s.uniqueContracts, users: s.uniqueUsers,
            avis: s.totalAvis, exploitees: s.analysesExploitees,
            rate: effectif > 0 ? s.uniqueUsers / effectif : 0,
        };
    });

    const col = tableSortState.column;
    rows.sort((a, b) => {
        let cmp;
        if (col === 'dr') cmp = a.direction.localeCompare(b.direction);
        else if (col === 'agency') cmp = a.agency.localeCompare(b.agency);
        else cmp = (a[col] || 0) - (b[col] || 0);
        return tableSortState.ascending ? cmp : -cmp;
    });

    agencyTableBodyEl.innerHTML = '';
    if (rows.length === 0) {
        agencyTableBodyEl.innerHTML = `<tr><td colspan="8" class="px-6 py-4 text-center text-gray-500">Aucune donnée disponible pour cette période</td></tr>`;
        return;
    }
    rows.forEach((r, index) => {
        const tr = document.createElement('tr');
        tr.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${KPI.escapeHtml(r.direction)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${KPI.escapeHtml(r.agency)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-blue-600 font-semibold">${r.operations}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${r.contracts}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${r.users}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${formatNumber(r.avis)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-emerald-700">${r.exploitees}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${r.effectif > 0 ? 'text-blue-600 font-semibold' : 'text-gray-500'}">
                ${r.effectif > 0 ? `${(r.rate * 100).toFixed(1)}%` : '-'}
            </td>
        `;
        agencyTableBodyEl.appendChild(tr);
    });
}

function updateRecentTable(data) {
    const recent = data
        .filter(item => item.status !== 'ERROR')
        .slice()
        .sort((a, b) => (parseDate(b.createdAt) || 0) - (parseDate(a.createdAt) || 0))
        .slice(0, 15);
    recentTableBodyEl.innerHTML = '';
    if (recent.length === 0) {
        recentTableBodyEl.innerHTML = `<tr><td colspan="9" class="px-4 py-4 text-center text-gray-500">Aucune analyse sur cette période</td></tr>`;
        return;
    }
    recent.forEach((it, index) => {
        const d = parseDate(it.createdAt);
        const tr = document.createElement('tr');
        tr.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        tr.innerHTML = `
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600">${d ? d.toLocaleDateString('fr-FR') : '-'}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${KPI.escapeHtml(it.agency || '-')}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-600 font-mono">${KPI.escapeHtml(it.contractNumber || '-')}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${KPI.escapeHtml(it.missions.join(', ') || '-')}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm font-semibold text-blue-600">${it.totalAvis}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-emerald-700">${it.avisFavorable}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-amber-700">${it.avisSuspendu}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-red-700">${it.avisDefavorable}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm">${it.exploitee
                ? '<span class="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800">Oui</span>'
                : '<span class="text-gray-400">—</span>'}</td>
        `;
        recentTableBodyEl.appendChild(tr);
    });
}

// ==================== CHARTS ====================

const TOOLTIP = {
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    titleColor: '#F9FAFB', bodyColor: '#E5E7EB',
    padding: 12, cornerRadius: 8,
};

function updateVerdictChart(s) {
    const canvas = document.getElementById('verdictChart');
    if (!canvas) return;
    if (verdictChart) verdictChart.destroy();
    const labels = ['Favorable', 'Suspendu', 'Défavorable'];
    const values = [s.favorable, s.suspendu, s.defavorable];
    const colors = ['rgba(16, 185, 129, 0.85)', 'rgba(245, 158, 11, 0.85)', 'rgba(239, 68, 68, 0.85)'];
    if (s.autre) {
        labels.push('À vérifier / autre');
        values.push(s.autre);
        colors.push('rgba(156, 163, 175, 0.85)');
    }
    verdictChart = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: { position: 'right', labels: { font: { size: 13 }, color: '#1F2937', usePointStyle: true, padding: 14 } },
                tooltip: {
                    ...TOOLTIP,
                    callbacks: { label: ctx => `${ctx.label} : ${formatNumber(ctx.parsed)} (${pct(ctx.parsed, s.totalAvis)})` },
                },
            },
        },
    });
}

function updateMissionChart(s) {
    const canvas = document.getElementById('missionChart');
    if (!canvas) return;
    if (missionChart) missionChart.destroy();
    const codes = Object.keys(s.byMission).sort((a, b) => s.byMission[b].avis - s.byMission[a].avis);
    missionChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: codes.map(c => MISSION_LABELS[c] || c),
            datasets: [
                {
                    label: 'Avis émis',
                    data: codes.map(c => s.byMission[c].avis),
                    backgroundColor: 'rgba(59, 130, 246, 0.85)',
                    borderRadius: 6,
                },
                {
                    label: 'Analyses couvrant la mission',
                    data: codes.map(c => s.byMission[c].analyses),
                    backgroundColor: 'rgba(16, 185, 129, 0.75)',
                    borderRadius: 6,
                },
            ],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { font: { size: 12 }, color: '#1F2937', usePointStyle: true, pointStyle: 'rectRounded' } },
                tooltip: { ...TOOLTIP, callbacks: { label: ctx => `${ctx.dataset.label} : ${formatNumber(ctx.parsed.x)}` } },
            },
            scales: {
                x: { beginAtZero: true, ticks: { precision: 0 } },
                y: { grid: { display: false } },
            },
        },
    });
}

// Lundi de la semaine (heure locale), clé YYYY-MM-DD.
function weekKey(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function updateChart(data) {
    const weeks = {};
    data.forEach(item => {
        if (item.status === 'ERROR') return;
        const date = parseDate(item.createdAt);
        if (!date) return;
        const key = weekKey(date);
        if (!weeks[key]) weeks[key] = { ops: new Set(), exploitees: new Set() };
        weeks[key].ops.add(item.deliverableId);
        if (item.exploitee) weeks[key].exploitees.add(item.deliverableId);
    });
    const keys = Object.keys(weeks).sort();
    const labels = keys.map(k => {
        const [y, m, d] = k.split('-');
        return `Sem. du ${d}/${m}`;
    });

    const canvas = document.getElementById('dateChart');
    if (!canvas) return;
    if (dateChart) dateChart.destroy();
    dateChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Analyses réalisées',
                    data: keys.map(k => weeks[k].ops.size),
                    backgroundColor: 'rgba(59, 130, 246, 0.85)',
                    borderColor: 'rgba(37, 99, 235, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                },
                {
                    label: 'Dont exploitées dans S+',
                    data: keys.map(k => weeks[k].exploitees.size),
                    backgroundColor: 'rgba(16, 185, 129, 0.75)',
                    borderColor: 'rgba(5, 150, 105, 1)',
                    borderWidth: 2,
                    borderRadius: 6,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true, position: 'top',
                    labels: { font: { size: 13, weight: '500' }, color: '#1F2937', padding: 15, usePointStyle: true, pointStyle: 'rectRounded' },
                },
                tooltip: { ...TOOLTIP, callbacks: { label: ctx => `${ctx.dataset.label} : ${formatNumber(ctx.parsed.y)}` } },
            },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Analyses', font: { size: 14, weight: 'bold' }, color: '#374151' } },
            },
        },
    });
}

// ==================== ORCHESTRATION ====================

function updateKPIs() {
    const filtered = getFilteredData(isCumulativeMode);
    const stats = KPI.aggregateCctp(filtered);

    updateCards(stats);
    const firstDate = getFirstDate(allData);
    if (firstDate) firstDateTextEl.textContent = formatFirstDate(firstDate);

    updateAgencyTable(filtered);
    updateSortIcons();
    updateRecentTable(filtered);
    updateVerdictChart(stats);
    updateMissionChart(stats);
    // L'évolution ignore la période (comme les autres briques) : on veut voir la tendance.
    updateChart(getFilteredData(true));
}

function applyInitialFilters() {
    const range = getCurrentMonthRange();
    startDateFilterEl.value = range.startDate;
    endDateFilterEl.value = range.endDate;
    filters.startDate = range.startDate;
    filters.endDate = range.endDate;
    drFilterEl.value = 'all';
    agencyFilterEl.value = 'all';
    filters.dr = null;
    filters.agence = null;
    isCumulativeMode = true;
    cumulToggleEl.checked = true;
}

// ==================== EVENT LISTENERS ====================

startDateFilterEl.addEventListener('change', e => {
    filters.startDate = e.target.value || null;
    // Choisir une date vaut sortie du mode « depuis le début ».
    isCumulativeMode = false;
    cumulToggleEl.checked = false;
    updateKPIs();
});
endDateFilterEl.addEventListener('change', e => {
    filters.endDate = e.target.value || null;
    isCumulativeMode = false;
    cumulToggleEl.checked = false;
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
    applyInitialFilters();
    updateKPIs();
});
cumulToggleEl.addEventListener('change', e => {
    isCumulativeMode = e.target.checked;
    updateKPIs();
});

// ==================== AUTH + INIT ====================

async function init() {
    try {
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');
        mainContentEl.classList.add('hidden');

        // URLs SIGNÉES (12 h), jamais mises en cache.
        const urls = await KPI.fetchDataUrls();
        if (!urls) return; // redirigé vers index.html
        DATA_URL = urls.ANALYSE_CCTP_URL || '';
        if (urls.POPULATION_CIBLE_URL) POPULATION_CSV_URL = urls.POPULATION_CIBLE_URL;

        const populationPromise = loadAgencyPopulation();

        if (!DATA_URL) {
            const populationResult = await populationPromise;
            agencyPopulation = populationResult.population;
            agencyToDR = populationResult.drMapping;
            loadingEl.classList.add('hidden');
            errorEl.classList.remove('hidden');
            errorMessageEl.innerHTML = `Aucune URL <code>ANALYSE_CCTP_URL</code> n'est exposée par le webhook. Ajoute le fichier <code>analyse_cctp.json</code> au nœud <code>Sign URLs</code> et le mapping au nœud <code>Build signed response</code> (cf. <a href="metabase-queries.md" class="underline">metabase-queries.md</a>, card 160).`;
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

        allData = KPI.parseCctpPayload(await dataResponse.text());
        console.log('Loaded', allData.length, 'CCTP deliverables');

        availableAgencies = getAvailableAgencies(allData);
        availableDRs = getAvailableDRs(allData);
        populateSelect(agencyFilterEl, 'Toutes les agences', availableAgencies);
        populateSelect(drFilterEl, 'Toutes les directions', availableDRs);

        applyInitialFilters();
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
