// Configuration
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordROI';

// Gain de temps : minutes économisées par AO analysé (= lead créé)
const MINUTES_PER_AO_ANALYSE = 15;

// Data URL : ANALYSE_AO_URL est exposée par le webhook passwordROI APRÈS auth.
// Pas de fallback hardcodé — sinon l'URL fuiterait dans le JS et bypasserait le mot de passe.
let DATA_URL = '';

// State
let allMarches = [];     // [{marcheId, refMarche, typeAvis, dateDetection, leads:[...]}]
let allLeads = [];       // flattened leads with marché meta
let availableTypeAvis = [];
let availableAgencies = [];
let funnelChart = null;
let dateChart = null;
let tableSortState = { column: 'analyses', ascending: false };
let isCumulativeMode = false;

const filters = {
    startDate: null,
    endDate: null,
    typeAvis: null,
    agence: null,
};

// DOM
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const errorMessageEl = document.getElementById('error-message');
const mainContentEl = document.getElementById('main-content');
const startDateFilterEl = document.getElementById('start-date-filter');
const endDateFilterEl = document.getElementById('end-date-filter');
const typeAvisFilterEl = document.getElementById('type-avis-filter');
const agencyFilterEl = document.getElementById('agency-filter');
const resetFiltersBtn = document.getElementById('reset-filters');
const agencyTableBodyEl = document.getElementById('agency-table-body');
const firstDateTextEl = document.getElementById('first-date-text');
const cumulToggleEl = document.getElementById('cumul-toggle');

// KPI Elements
const kpiCaptesEl = document.getElementById('kpi-captes');
const kpiFiltresEl = document.getElementById('kpi-filtres');
const kpiAnalysesEl = document.getElementById('kpi-analyses');
const kpiOpportunitesEl = document.getElementById('kpi-opportunites');
const kpiFiltresRateEl = document.getElementById('kpi-filtres-rate');
const kpiOppRateEl = document.getElementById('kpi-opp-rate');
const kpiGainHeuresEl = document.getElementById('kpi-gain-heures');
const kpiGainMinutesEl = document.getElementById('kpi-gain-minutes');
const kpiGainJoursEl = document.getElementById('kpi-gain-jours');

// ==================== UTILS ====================

function parseDate(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
}

function formatNumber(num) {
    return new Intl.NumberFormat('fr-FR').format(Math.round(num));
}

function formatPercent(num, decimals = 1) {
    if (!isFinite(num)) return '—';
    return `${num.toFixed(decimals)}%`;
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

function getFirstDate(marches) {
    let earliest = null;
    marches.forEach(m => {
        const d = parseDate(m.dateDetection);
        if (d && (!earliest || d < earliest)) earliest = d;
    });
    return earliest;
}

// ==================== PARSING ====================

// Parses {count, data:[...]} from the XPL Funnel API and produces two arrays:
// - marches (one entry per marché with its leads array)
// - leads   (flattened, each lead carries its parent marché ref/typeAvis/dateDetection)
function parseFunnelPayload(payload) {
    if (!payload || !Array.isArray(payload.data)) {
        console.warn('Invalid funnel payload — expected {count, data:[]}');
        return { marches: [], leads: [] };
    }

    const marches = [];
    const leads = [];

    payload.data.forEach(m => {
        const marche = {
            marcheId: m.marcheId || '',
            refMarche: m.refMarche || '',
            typeAvis: m.typeAvis || '',
            dateDetection: m.dateDetection || '',
            leads: Array.isArray(m.leads) ? m.leads : [],
        };
        marches.push(marche);

        marche.leads.forEach(l => {
            leads.push({
                id: l.id || '',
                dateCreation: l.dateCreation || '',
                ownerName: l.ownerName || '',
                agence: l.agence || '',
                dateConvertedOpp: l.dateConvertedOpp || null,
                opportunity: l.opportunity || null,
                // parent marché meta:
                marcheId: marche.marcheId,
                refMarche: marche.refMarche,
                typeAvis: marche.typeAvis,
                dateDetection: marche.dateDetection,
            });
        });
    });

    console.log('Parsed', marches.length, 'marchés and', leads.length, 'leads');
    return { marches, leads };
}

// ==================== FILTERS ====================

function filterMarchesByDate(marches, startDate, endDate) {
    if (!startDate && !endDate) return marches;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (end) end.setHours(23, 59, 59, 999);
    return marches.filter(m => {
        const d = parseDate(m.dateDetection);
        if (!d) return false;
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
    });
}

function filterMarchesByTypeAvis(marches, typeAvis) {
    if (!typeAvis || typeAvis === 'all') return marches;
    return marches.filter(m => m.typeAvis === typeAvis);
}

// Pour l'agence : on filtre les marchés dont AU MOINS un lead a cette agence,
// ET on filtre les leads sur l'agence. C'est cohérent avec la lecture "funnel par agence".
function filterMarchesByAgence(marches, agence) {
    if (!agence || agence === 'all') return marches;
    return marches.filter(m => (m.leads || []).some(l => l.agence === agence));
}

function applyFilters(marches, currentFilters, skipDateFilter = false) {
    let filtered = marches;
    if (!skipDateFilter) {
        filtered = filterMarchesByDate(filtered, currentFilters.startDate, currentFilters.endDate);
    }
    filtered = filterMarchesByTypeAvis(filtered, currentFilters.typeAvis);
    filtered = filterMarchesByAgence(filtered, currentFilters.agence);
    return filtered;
}

// ==================== KPI ====================

function computeKPIs(filteredMarches, agenceFilter) {
    const captes = filteredMarches.length;

    // Marchés ayant au moins un lead (filtre IA passé)
    const filtres = filteredMarches.filter(m => (m.leads || []).length > 0).length;

    // Leads : si une agence est sélectionnée, on ne compte QUE les leads de cette agence
    let leadsCount = 0;
    let oppCount = 0;
    filteredMarches.forEach(m => {
        (m.leads || []).forEach(l => {
            if (agenceFilter && agenceFilter !== 'all' && l.agence !== agenceFilter) return;
            leadsCount++;
            if (l.opportunity) oppCount++;
        });
    });

    return {
        captes,
        filtres,
        analyses: leadsCount,
        opportunites: oppCount,
    };
}

// ==================== DROPDOWNS ====================

function getAvailableTypeAvis(marches) {
    const set = new Set();
    marches.forEach(m => { if (m.typeAvis) set.add(m.typeAvis); });
    return Array.from(set).sort();
}

function getAvailableAgencies(marches) {
    const set = new Set();
    marches.forEach(m => {
        (m.leads || []).forEach(l => { if (l.agence) set.add(l.agence); });
    });
    return Array.from(set).sort();
}

function populateTypeAvisFilter() {
    typeAvisFilterEl.innerHTML = '<option value="all">Tous les types</option>';
    availableTypeAvis.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        typeAvisFilterEl.appendChild(opt);
    });
}

function populateAgencyFilter() {
    agencyFilterEl.innerHTML = '<option value="all">Toutes les agences</option>';
    availableAgencies.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
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
    const columns = ['agency', 'analyses', 'opportunites', 'owners', 'rate'];
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

function updateAgencyTable(filteredMarches) {
    const stats = {};

    filteredMarches.forEach(m => {
        (m.leads || []).forEach(l => {
            const ag = l.agence || '(sans agence)';
            // Si filtre agence actif, ne montrer que cette ligne
            if (filters.agence && filters.agence !== 'all' && ag !== filters.agence) return;

            if (!stats[ag]) {
                stats[ag] = { analyses: 0, opportunites: 0, owners: new Set() };
            }
            stats[ag].analyses++;
            if (l.opportunity) stats[ag].opportunites++;
            if (l.ownerName) stats[ag].owners.add(l.ownerName);
        });
    });

    const agences = Object.keys(stats);
    const sorted = agences.sort((a, b) => {
        let cmp = 0;
        switch (tableSortState.column) {
            case 'agency':       cmp = a.localeCompare(b); break;
            case 'analyses':     cmp = stats[a].analyses - stats[b].analyses; break;
            case 'opportunites': cmp = stats[a].opportunites - stats[b].opportunites; break;
            case 'owners':       cmp = stats[a].owners.size - stats[b].owners.size; break;
            case 'rate': {
                const rA = stats[a].analyses > 0 ? stats[a].opportunites / stats[a].analyses : 0;
                const rB = stats[b].analyses > 0 ? stats[b].opportunites / stats[b].analyses : 0;
                cmp = rA - rB;
                break;
            }
            default: cmp = stats[a].analyses - stats[b].analyses;
        }
        return tableSortState.ascending ? cmp : -cmp;
    });

    agencyTableBodyEl.innerHTML = '';
    if (sorted.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="5" class="px-6 py-4 text-center text-gray-500">Aucun lead pour cette période</td>`;
        agencyTableBodyEl.appendChild(row);
        return;
    }

    sorted.forEach((ag, index) => {
        const s = stats[ag];
        const tauxConv = s.analyses > 0 ? ((s.opportunites / s.analyses) * 100).toFixed(1) : '-';

        const row = document.createElement('tr');
        row.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${ag}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-amber-600 font-semibold">${s.analyses}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-purple-600 font-semibold">${s.opportunites}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${s.owners.size}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${s.analyses > 0 ? 'text-blue-600 font-semibold' : 'text-gray-500'}">
                ${s.analyses > 0 ? `${tauxConv}%` : '-'}
            </td>
        `;
        agencyTableBodyEl.appendChild(row);
    });
}

// ==================== CHARTS ====================

function updateFunnelChart(kpis) {
    const canvas = document.getElementById('funnelChart');
    if (!canvas) return;
    if (funnelChart) funnelChart.destroy();

    funnelChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['1. AO Captés', '2. AO Filtrés', '3. AO Analysés', '4. AO Opportunité'],
            datasets: [{
                label: 'Nombre',
                data: [kpis.captes, kpis.filtres, kpis.analyses, kpis.opportunites],
                backgroundColor: [
                    'rgba(59, 130, 246, 0.85)',   // blue
                    'rgba(16, 185, 129, 0.85)',   // emerald
                    'rgba(245, 158, 11, 0.85)',   // amber
                    'rgba(139, 92, 246, 0.85)',   // purple
                ],
                borderColor: [
                    'rgba(37, 99, 235, 1)',
                    'rgba(5, 150, 105, 1)',
                    'rgba(217, 119, 6, 1)',
                    'rgba(109, 40, 217, 1)',
                ],
                borderWidth: 2,
                borderRadius: 8,
            }],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    titleColor: '#F9FAFB',
                    bodyColor: '#E5E7EB',
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: ctx => {
                            const v = ctx.parsed.x;
                            const total = kpis.captes || 1;
                            const pct = ((v / total) * 100).toFixed(1);
                            return `${formatNumber(v)}  (${pct}% des captés)`;
                        },
                    },
                },
            },
            scales: {
                x: { beginAtZero: true, ticks: { precision: 0 } },
                y: { grid: { display: false } },
            },
        },
    });
}

function updateMonthlyChart(filteredMarches) {
    const monthGroups = {};

    filteredMarches.forEach(m => {
        const d = parseDate(m.dateDetection);
        if (!d) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthGroups[key]) {
            monthGroups[key] = { captes: 0, filtres: 0, analyses: 0, opportunites: 0 };
        }
        monthGroups[key].captes++;
        const hasLeads = (m.leads || []).length > 0;
        if (hasLeads) monthGroups[key].filtres++;
        (m.leads || []).forEach(l => {
            if (filters.agence && filters.agence !== 'all' && l.agence !== filters.agence) return;
            monthGroups[key].analyses++;
            if (l.opportunity) monthGroups[key].opportunites++;
        });
    });

    const sortedMonths = Object.keys(monthGroups).sort();
    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const labels = sortedMonths.map(k => {
        const [y, mo] = k.split('-');
        return `${monthNames[parseInt(mo) - 1]} ${y}`;
    });

    const captesData = sortedMonths.map(k => monthGroups[k].captes);
    const filtresData = sortedMonths.map(k => monthGroups[k].filtres);
    const analysesData = sortedMonths.map(k => monthGroups[k].analyses);
    const oppData = sortedMonths.map(k => monthGroups[k].opportunites);

    const canvas = document.getElementById('dateChart');
    if (!canvas) return;
    if (dateChart) dateChart.destroy();

    dateChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Captés',       data: captesData,   backgroundColor: 'rgba(59, 130, 246, 0.85)',  borderColor: 'rgba(37, 99, 235, 1)',  borderWidth: 2, borderRadius: 6 },
                { label: 'Filtrés',      data: filtresData,  backgroundColor: 'rgba(16, 185, 129, 0.85)',  borderColor: 'rgba(5, 150, 105, 1)',  borderWidth: 2, borderRadius: 6 },
                { label: 'Analysés',     data: analysesData, backgroundColor: 'rgba(245, 158, 11, 0.85)',  borderColor: 'rgba(217, 119, 6, 1)',  borderWidth: 2, borderRadius: 6 },
                { label: 'Opportunités', data: oppData,      backgroundColor: 'rgba(139, 92, 246, 0.85)',  borderColor: 'rgba(109, 40, 217, 1)', borderWidth: 2, borderRadius: 6 },
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
                    backgroundColor: 'rgba(17, 24, 39, 0.95)', titleColor: '#F9FAFB', bodyColor: '#E5E7EB',
                    padding: 12, cornerRadius: 8,
                    callbacks: { label: ctx => `${ctx.dataset.label} : ${formatNumber(ctx.parsed.y)}` },
                },
            },
            scales: {
                x: { grid: { display: false }, title: { display: true, text: 'Mois de détection', font: { size: 14, weight: 'bold' }, color: '#374151' } },
                y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Comptes', font: { size: 14, weight: 'bold' }, color: '#374151' } },
            },
        },
    });
}

// ==================== ORCHESTRATION ====================

function updateKPIs() {
    const filtered = applyFilters(allMarches, filters, isCumulativeMode);
    const kpis = computeKPIs(filtered, filters.agence);

    kpiCaptesEl.textContent = formatNumber(kpis.captes);
    kpiFiltresEl.textContent = formatNumber(kpis.filtres);
    kpiAnalysesEl.textContent = formatNumber(kpis.analyses);
    kpiOpportunitesEl.textContent = formatNumber(kpis.opportunites);

    const filtresRate = kpis.captes > 0 ? (kpis.filtres / kpis.captes) * 100 : 0;
    const oppRate = kpis.analyses > 0 ? (kpis.opportunites / kpis.analyses) * 100 : 0;
    kpiFiltresRateEl.textContent = formatPercent(filtresRate);
    kpiOppRateEl.textContent = formatPercent(oppRate);

    // Gain de temps : 15 min × nb AO analysés
    const totalMinutes = kpis.analyses * MINUTES_PER_AO_ANALYSE;
    const totalHours = totalMinutes / 60;
    const totalDays = totalHours / 7;
    if (kpiGainHeuresEl)  kpiGainHeuresEl.textContent  = `${formatNumber(totalHours)} h`;
    if (kpiGainMinutesEl) kpiGainMinutesEl.textContent = formatNumber(totalMinutes);
    if (kpiGainJoursEl)   kpiGainJoursEl.textContent   = `${formatNumber(totalDays)} j`;

    const firstDate = getFirstDate(allMarches);
    if (firstDate) firstDateTextEl.textContent = formatFirstDate(firstDate);

    updateFunnelChart(kpis);
    updateAgencyTable(filtered);
    updateSortIcons();
    updateMonthlyChart(filtered);
}

// ==================== EVENTS ====================

startDateFilterEl.addEventListener('change', e => {
    filters.startDate = e.target.value || null;
    updateKPIs();
});
endDateFilterEl.addEventListener('change', e => {
    filters.endDate = e.target.value || null;
    updateKPIs();
});
typeAvisFilterEl.addEventListener('change', e => {
    filters.typeAvis = e.target.value === 'all' ? null : e.target.value;
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
    typeAvisFilterEl.value = 'all';
    agencyFilterEl.value = 'all';
    filters.startDate = range.startDate;
    filters.endDate = range.endDate;
    filters.typeAvis = null;
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

// Returns the AO_URL via the webhook (uses cached response if available).
async function authenticateAndGetURL() {
    const storedPassword = localStorage.getItem('roi_password');
    if (!storedPassword) {
        window.location.href = 'index.html';
        return null;
    }

    const cached = localStorage.getItem('roi_auth_result');
    const tryParse = (text) => {
        // Look for ANALYSE_AO_URL = '...' (n8n webhook passwordROI response)
        const m = text.match(/ANALYSE_AO_URL\s*=\s*['"]([^'"]+)['"]/);
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

async function fetchAOData() {
    DATA_URL = await authenticateAndGetURL();
    if (!DATA_URL) {
        throw new Error('ANALYSE_AO_URL non exposée par le webhook passwordROI.');
    }

    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status} on ${DATA_URL}`);
    const rawText = await response.text();

    let payload = null;
    try { payload = JSON.parse(rawText); } catch (_) {
        throw new Error('Réponse non JSON');
    }

    // n8n envelope variants (à dérouler avant le parse) :
    //   [{ data: "json-string" }]      → ancien format n8n (data sérialisée)
    //   [{ data: [...], count: N }]    → n8n upload direct sans unwrap (cas actuel)
    //   { data: "json-string" }        → single-item après flatten
    //   { count, data: [...] }         → format API SF natif
    if (Array.isArray(payload) && payload.length && payload[0] && typeof payload[0] === 'object') {
        const first = payload[0];
        if (typeof first.data === 'string') {
            try { payload = JSON.parse(first.data); } catch (_) {}
        } else if (first.data !== undefined) {
            // déjà un objet/array, on prend juste l'item interne
            payload = first;
        }
    } else if (payload && typeof payload.data === 'string') {
        try { payload = JSON.parse(payload.data); } catch (_) {}
    }

    return payload;
}

async function init() {
    try {
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');
        mainContentEl.classList.add('hidden');

        const payload = await fetchAOData();
        const parsed = parseFunnelPayload(payload);
        allMarches = parsed.marches;
        allLeads = parsed.leads;

        if (allMarches.length === 0) {
            throw new Error('Aucun marché reçu de l\'API.');
        }

        availableTypeAvis = getAvailableTypeAvis(allMarches);
        availableAgencies = getAvailableAgencies(allMarches);
        populateTypeAvisFilter();
        populateAgencyFilter();

        const range = getCurrentMonthRange();
        startDateFilterEl.value = range.startDate;
        endDateFilterEl.value = range.endDate;
        filters.startDate = range.startDate;
        filters.endDate = range.endDate;

        updateKPIs();

        loadingEl.classList.add('hidden');
        mainContentEl.classList.remove('hidden');
    } catch (error) {
        console.error('Error loading AO data:', error);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
        const hint = `Vérifie que le webhook <code>passwordROI</code> renvoie bien la ligne <code>ANALYSE_AO_URL = '&lt;supabase-url&gt;'</code> dans sa réponse, et que le fichier <code>analyse_ao.json</code> est bien présent sur Supabase.`;
        errorMessageEl.innerHTML = `${error.message}<br><br><span class="text-xs">${hint}</span>`;
    }
}

init();
