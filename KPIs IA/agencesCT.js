// ============================================================================
// Adoption & pertinence d'usage par agence — BTP Consultants, contrôle technique.
//
// Les modules affichés sont ceux de la filiale CT dans le catalogue partagé
// (KPIAdoption.catalogue, shared/adoption.js), chargés par
// loadCatalogueSources (shared/sources.js) : un module ajouté au catalogue
// prend sa colonne, sa courbe et sa place dans l'adoption globale sans
// modifier cette page. Mêmes règles d'usage réel que index et le COPIL.
//
// Adoption = contrôleurs de l'agence ayant utilisé le module sur la période ÷
// effectif de la population cible (carte 136, contrôleurs seuls). Chaque
// utilisateur est rattaché à l'agence majoritaire de ses sessions, comme dans
// KPIAdoption.collect.
// Pertinence = affaires RICT couvertes par un descriptif IA ÷ affaires
// éligibles (description source ≥ 100 mots), Descriptif seulement.
// ============================================================================

const WEBHOOKS = [
    'https://databuildr.app.n8n.cloud/webhook/passwordadoption',
    KPI.WEBHOOK_URL,
];
const STORE_KEY = 'adoption_password';

// Pilote du descriptif IA : gisement éligible compté à partir de juin 2025.
const DESCRIPTIF_AI_START_DATE = new Date(2025, 5, 1);
const ELIGIBLE_MIN_WORDS = 100;

// Couleur fixe par module, la même que sur la page COPIL (MODULE_COLORS de
// copil-ia.js) ; Expert et Chat, réunis là-bas, sont séparés ici. Un module
// sans couleur prend la suivante de la palette catégorielle, en pointillés.
const MODULE_COLORS = {
    'descriptif': '#2a78d6', 'analyse-cctp': '#eb6834', 'autocontact': '#1baf7a', 'expert-ct': '#eda100',
    'comparateur': '#e87ba4', 'analyse-geo': '#008300', 'analyse-acou': '#e34948', 'chat-ct': '#6250d6',
};
const FALLBACK_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const MODULE_HINTS = {
    'descriptif': 'Utilisateurs ayant généré au moins un descriptif IA sur une description source ≥ 100 mots ÷ effectif.',
    'autocontact': 'Utilisateurs ayant importé au moins un contact par l\'IA ÷ effectif.',
    'analyse-cctp': 'Analyse CCTP vs Référentiel, lancée dans S+ ou dans AnalyzTech. Utilisateur = la personne qui a injecté les avis, sinon le chargé d\'affaires.',
    'analyse-geo': 'Analyse d\'étude géotechnique. Utilisateur = chargé d\'affaires du livrable.',
    'analyse-acou': 'Analyse d\'étude acoustique. Utilisateur = chargé d\'affaires du livrable.',
    'expert-ct': 'Sessions de l\'expert technique BTP Consultants.',
    'chat-ct': 'Sessions de chat projet BTP Consultants.',
};

// ==================== ÉTAT ====================

let urls = null;
let modules = [];            // modules CT : {id, label, color, dashed, events: [{email, date, agency}]}
let descriptifRows = [];     // toutes les lignes RICT (gisement de la pertinence)
let population = [];         // [{dr, agencyCode, effectif}]
let drOf = {};               // agence → DR (population cible)
let controllers = new Set(); // contrôleurs de la population cible (carte 136)
let spsEmails = new Set();   // collaborateurs SPS (même domaine que CT) : hors comptage
let homeAgency = new Map();  // email → agence majoritaire de ses sessions CT

let adoptionSort = { column: 'adoptionGlobale', ascending: false };
let pertinenceSort = { column: 'couverture', ascending: false };
let dateFilter = { startDate: null, endDate: null };
let adoptionChartMode = 'monthly'; // 'monthly' | 'cumul'
let usageChartMode = 'monthly';
let current = null;          // résultat de compute() pour les filtres courants

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const mainContentEl = document.getElementById('main-content');
const startDateEl = document.getElementById('start-date');
const endDateEl = document.getElementById('end-date');
const directionFilterEl = document.getElementById('direction-filter');
const agencyFilterEl = document.getElementById('agency-filter');
const loginModal = document.getElementById('login-modal');
const loginForm = document.getElementById('login-form');
const passwordInput = document.getElementById('password-input');
const loginButton = document.getElementById('login-button');
const loginText = document.getElementById('login-text');
const loginError = document.getElementById('login-error');

const esc = KPI.escapeHtml;
const fmt = KPI.formatNumber;

// ==================== ACCÈS ====================

async function authenticate(password) {
    for (const url of WEBHOOKS) {
        try {
            const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: password });
            if (!r.ok) continue;
            const found = KPI.parseUrlsResponse(await r.text());
            if (found.DESCRIPTIF_URL && found.POPULATION_CIBLE_URL) return found;
        } catch (e) {
            console.warn('Webhook indisponible :', url, e);
        }
    }
    return null;
}

function storedPassword() {
    try { return localStorage.getItem(STORE_KEY) || localStorage.getItem('roi_password'); } catch (_) { return null; }
}

async function start() {
    const saved = storedPassword();
    if (saved) {
        urls = await authenticate(saved);
        if (urls) { loginModal.classList.add('hidden'); await loadData(); return; }
        try { localStorage.removeItem(STORE_KEY); } catch (_) {}
    }
    loginModal.classList.remove('hidden');
    passwordInput.focus();
}

loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const password = passwordInput.value.trim();
    if (!password) return;
    loginButton.disabled = true; loginText.textContent = 'Connexion…'; loginError.classList.add('hidden');
    urls = await authenticate(password);
    if (urls) {
        try { localStorage.setItem(STORE_KEY, password); } catch (_) {}
        loginModal.classList.add('hidden');
        await loadData();
    } else {
        loginError.classList.remove('hidden');
        passwordInput.value = '';
        passwordInput.focus();
    }
    loginButton.disabled = false; loginText.textContent = 'Se connecter';
});

document.getElementById('logout-btn').addEventListener('click', () => {
    try { localStorage.removeItem(STORE_KEY); } catch (_) {}
    location.reload();
});

// ==================== DONNÉES ====================

async function loadData() {
    loadingEl.classList.remove('hidden');
    errorEl.classList.add('hidden');
    mainContentEl.classList.add('hidden');
    try {
        const { CT, SPS } = KPIAdoption.FILIALES;
        // Sources SPS : seulement pour reconnaître les collaborateurs SPS, qui
        // partagent le domaine @btp-consultants.fr.
        const keys = KPIAdoption.sourcesFor(CT).concat(KPIAdoption.sourcesFor(SPS));
        const loaded = await loadCatalogueSources(urls, keys, ['POPULATION_CIBLE_URL']);
        const pop = loaded.texts.POPULATION_CIBLE_URL;
        if (!pop) throw new Error('Population cible indisponible');
        if (!loaded.data.descriptif.length) throw new Error('Descriptif indisponible');

        population = parsePopulationRows(pop);
        controllers = parsePopulationControllers(pop);
        drOf = {};
        population.forEach(p => { drOf[p.agencyCode] = p.dr; });
        descriptifRows = loaded.data.descriptif;

        const catalogue = KPIAdoption.catalogue(loaded.data, { isDescriptifRow, isNFHabitatItem });
        spsEmails = new Set();
        catalogue.filter(m => m.filiale === SPS).forEach(m => m.events().forEach(i => {
            const e = (i.email || '').toLowerCase().trim();
            if (e) spsEmails.add(e);
        }));

        let fallback = 0;
        modules = catalogue.filter(m => m.filiale === CT).map(m => {
            const events = [];
            m.events().forEach(item => {
                const email = (item.email || '').toLowerCase().trim();
                if (!email || !email.includes(CT.domain)) return;
                const date = KPI.parseFrenchDate(item.createdAt);
                if (date) events.push({ email, date, agency: KPIAdoption.itemAgency(item) });
            });
            // Module sans couleur attitrée : couleur de repli, en pointillés.
            if (MODULE_COLORS[m.id]) return { id: m.id, label: m.label, events, color: MODULE_COLORS[m.id], dashed: false };
            return { id: m.id, label: m.label, events, color: FALLBACK_COLORS[fallback++ % FALLBACK_COLORS.length], dashed: true };
        });

        // Agence de rattachement : majoritaire sur toutes les sessions CT, toutes
        // périodes confondues (même règle que KPIAdoption.collect).
        const agenciesByEmail = {};
        modules.forEach(m => m.events.forEach(e => { (agenciesByEmail[e.email] = agenciesByEmail[e.email] || []).push(e.agency); }));
        homeAgency = new Map(Object.entries(agenciesByEmail).map(([email, list]) => [email, KPI.mode(list) || '']));

        if (loaded.missing.length) console.warn('Variables absentes du webhook :', loaded.missing.join(', '));

        buildAdoptionHeader();
        populateFilters();
        loadingEl.classList.add('hidden');
        mainContentEl.classList.remove('hidden');
        refreshAll();
        setTimeout(refreshAll, 200); // re-rendu des graphiques après mise en page
    } catch (e) {
        console.error(e);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
    }
}

// ==================== FILTRES ====================

function populateFilters() {
    const drs = [...new Set(population.map(p => p.dr).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    directionFilterEl.innerHTML = '<option value="">Toutes les directions</option>'
        + drs.map(dr => `<option value="${esc(dr)}">${esc(dr)}</option>`).join('');
    populateAgencyFilter();
}

function populateAgencyFilter() {
    const dr = directionFilterEl.value;
    const previous = agencyFilterEl.value;
    const agencies = population.filter(p => !dr || p.dr === dr).map(p => p.agencyCode).sort();
    agencyFilterEl.innerHTML = '<option value="">Toutes les agences</option>'
        + agencies.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
    if (previous && agencies.includes(previous)) agencyFilterEl.value = previous;
}

// Période du filtre de dates, bornes incluses.
function period() {
    return KPIAdoption.periodFromFilter(dateFilter);
}
function inPeriod(date) {
    const p = period();
    return (!p.start || date >= p.start) && (!p.end || date <= p.end);
}

// Agences retenues par les filtres DR / agence ; null = aucun filtre.
function scopeAgencies() {
    const dr = directionFilterEl.value, agency = agencyFilterEl.value;
    if (!dr && !agency) return null;
    return new Set(population.filter(p => (!dr || p.dr === dr) && (!agency || p.agencyCode === agency)).map(p => p.agencyCode));
}

// Compté dans l'adoption : contrôleur de la population cible (carte 136) ;
// sans la colonne Controleurs, tout collaborateur CT hors SPS.
function isCounted(email) {
    if (spsEmails.has(email)) return false;
    return controllers.size ? controllers.has(email) : true;
}

// ==================== CALCUL ====================

function compute() {
    const scope = scopeAgencies();
    const rows = population.filter(p => !scope || scope.has(p.agencyCode));
    const known = new Set(population.map(p => p.agencyCode));

    // --- Adoption : utilisateurs uniques par agence de rattachement ---
    const byAgency = {};
    rows.forEach(p => {
        byAgency[p.agencyCode] = { any: new Set(), perModule: Object.fromEntries(modules.map(m => [m.id, new Set()])) };
    });
    let horsPopulation = new Set();
    modules.forEach(m => m.events.forEach(e => {
        if (!inPeriod(e.date) || !isCounted(e.email)) return;
        const home = homeAgency.get(e.email) || '';
        if (!known.has(home)) { horsPopulation.add(e.email); return; }
        const s = byAgency[home];
        if (!s) return; // agence hors filtre
        s.perModule[m.id].add(e.email);
        s.any.add(e.email);
    }));
    const pct = (n, d) => d > 0 ? Math.min(100, n / d * 100) : null;
    const adoptionRows = rows.map(p => {
        const s = byAgency[p.agencyCode];
        const row = {
            direction: p.dr || 'Non spécifiée', agency: p.agencyCode, effectif: p.effectif,
            usersAny: s.any.size, adoptionGlobale: pct(s.any.size, p.effectif),
        };
        modules.forEach(m => {
            row['users_' + m.id] = s.perModule[m.id].size;
            row['adoption_' + m.id] = pct(s.perModule[m.id].size, p.effectif);
        });
        return row;
    });

    // --- Pertinence du Descriptif : affaires éligibles et couvertes, par agence de l'affaire ---
    const eligible = {}, covered = {};
    descriptifRows.forEach(item => {
        const date = KPI.parseFrenchDate(item.createdAt);
        if (!date || date < DESCRIPTIF_AI_START_DATE || !inPeriod(date)) return;
        const agency = KPIAdoption.itemAgency(item);
        const contract = (item.contractNumber || '').trim();
        if (!agency || !contract || (scope && !scope.has(agency))) return;
        const words = typeof item.descriptionWordCount === 'number' ? item.descriptionWordCount : KPI.countWords(KPI.extractText(item.description || ''));
        if (words < ELIGIBLE_MIN_WORDS) return;
        (eligible[agency] = eligible[agency] || new Set()).add(contract);
        if (isDescriptifRow(item)) (covered[agency] = covered[agency] || new Set()).add(contract);
    });
    const adoptionOf = Object.fromEntries(adoptionRows.map(r => [r.agency, r['adoption_descriptif']]));
    const pertinenceRows = Object.keys(eligible).map(agency => {
        const e = eligible[agency].size, c = covered[agency] ? covered[agency].size : 0;
        return {
            direction: drOf[agency] || 'Non spécifiée', agency, eligibles: e, couvertes: c,
            couverture: e > 0 ? c / e * 100 : null,
            adoptionDescriptif: adoptionOf[agency] === undefined ? null : adoptionOf[agency],
            effectif: (population.find(p => p.agencyCode === agency) || {}).effectif || 0,
        };
    });

    const effectif = rows.reduce((s, p) => s + p.effectif, 0);
    const sum = key => adoptionRows.reduce((s, r) => s + (r[key] || 0), 0);
    const totalEligibles = pertinenceRows.reduce((s, r) => s + r.eligibles, 0);
    const totalCouvertes = pertinenceRows.reduce((s, r) => s + r.couvertes, 0);
    return {
        effectif, adoptionRows, pertinenceRows,
        globale: pct(sum('usersAny'), effectif),
        descriptif: pct(sum('users_descriptif'), effectif),
        couverture: totalEligibles > 0 ? totalCouvertes / totalEligibles * 100 : null,
        horsPopulation: horsPopulation.size,
    };
}

// ==================== AFFICHAGE ====================

// Échelle indicative commune (adoption & couverture). Vert ≥50, jaune ≥30, orange ≥20, sinon rouge.
function badgeHtml(rate) {
    if (rate === null || rate === undefined || isNaN(rate)) return '<span class="text-gray-400">—</span>';
    let bg = 'bg-red-500';
    if (rate >= 50) bg = 'bg-green-500';
    else if (rate >= 30) bg = 'bg-yellow-500';
    else if (rate >= 20) bg = 'bg-orange-500';
    return `<span class="px-3 py-1 rounded-full text-white font-bold ${bg}">${rate.toFixed(1)}%</span>`;
}

function refreshAll() {
    if (!modules.length) return;
    current = compute();
    updatePeriodBadge();
    updateSynthese();
    renderAdoptionTable();
    renderPertinenceTable();
    updateAdoptionTimeChart();
    updateUsageTimeChart();
    updateDescriptifCompareChart();
    updateQuadrantChart();
}

function updatePeriodBadge() {
    const d = s => s ? new Date(s).toLocaleDateString('fr-FR') : null;
    let txt = 'Période : tout l\'historique';
    if (dateFilter.startDate && dateFilter.endDate) txt = `Période : ${d(dateFilter.startDate)} → ${d(dateFilter.endDate)}`;
    else if (dateFilter.startDate) txt = `Période : depuis le ${d(dateFilter.startDate)}`;
    else if (dateFilter.endDate) txt = `Période : jusqu'au ${d(dateFilter.endDate)}`;
    document.getElementById('period-badge').textContent = txt;
    document.getElementById('sps-excluded-badge').textContent = spsEmails.size
        ? `· ${spsEmails.size} collaborateur${spsEmails.size > 1 ? 's' : ''} SPS exclu${spsEmails.size > 1 ? 's' : ''}` : '';
}

function updateSynthese() {
    const cap = v => v === null ? '—' : v.toFixed(1) + '%';
    document.getElementById('kpi-effectif').textContent = current.effectif > 0 ? fmt(current.effectif) : '—';
    document.getElementById('kpi-adoption-globale').textContent = cap(current.globale);
    document.getElementById('kpi-adoption-descriptif').textContent = cap(current.descriptif);
    document.getElementById('kpi-couverture-descriptif').textContent = cap(current.couverture);
    document.getElementById('kpi-modules').textContent = `${modules.length} modules IA : ${modules.map(m => m.label).join(', ')}`;
}

function sortRows(rows, sortState) {
    return rows.slice().sort((a, b) => {
        let va = a[sortState.column], vb = b[sortState.column];
        if (typeof va === 'string' || typeof vb === 'string') {
            va = va || ''; vb = vb || '';
            return sortState.ascending ? va.localeCompare(vb, 'fr') : vb.localeCompare(va, 'fr');
        }
        va = (va === null || va === undefined || isNaN(va)) ? -1 : va;
        vb = (vb === null || vb === undefined || isNaN(vb)) ? -1 : vb;
        return sortState.ascending ? va - vb : vb - va;
    });
}

const TH = 'px-4 py-3 text-xs font-medium text-graphite uppercase tracking-wider cursor-pointer hover:bg-compliant hover:text-ink select-none';
function thHtml(key, label, hint, align, prefix, handler) {
    const tip = hint ? `<div class="relative group ml-1"><span class="text-graphite cursor-help text-xs font-normal">(i)</span>
        <div class="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-2 bg-ink text-off text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 whitespace-normal normal-case">${hint}</div></div>` : '';
    return `<th class="${TH} text-${align}" onclick="${handler}('${key}')">
        <div class="flex items-center${align === 'center' ? ' justify-center' : ''}">${esc(label)}${tip}<span id="${prefix}${key}" class="ml-1 text-gray-400">↕</span></div></th>`;
}

// En-tête du tableau d'adoption : une colonne par module CT du catalogue.
function buildAdoptionHeader() {
    document.getElementById('adoption-head').innerHTML = '<tr>'
        + thHtml('direction', 'Direction', '', 'left', 'ad-sort-', 'sortAdoption')
        + thHtml('agency', 'Agence', '', 'left', 'ad-sort-', 'sortAdoption')
        + thHtml('effectif', 'Effectif', 'Contrôleurs de l\'agence dans la population cible (comptes S+ actifs).', 'center', 'ad-sort-', 'sortAdoption')
        + thHtml('adoptionGlobale', 'Globale', 'Contrôleurs ayant utilisé <strong>au moins un</strong> module IA ÷ effectif de l\'agence.', 'center', 'ad-sort-', 'sortAdoption')
        + modules.map(m => thHtml('adoption_' + m.id, m.label, MODULE_HINTS[m.id] || '', 'center', 'ad-sort-', 'sortAdoption')).join('')
        + '</tr>';
}

function renderAdoptionTable() {
    const body = document.getElementById('adoption-table-body');
    const rows = sortRows(current.adoptionRows.filter(r => r.effectif > 0), adoptionSort);
    body.innerHTML = rows.map((r, i) => `<tr class="${i % 2 ? 'bg-gray-50' : 'bg-white'}">
        <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-600">${esc(r.direction)}</td>
        <td class="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${esc(r.agency)}</td>
        <td class="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-600">${fmt(r.effectif)}</td>
        <td class="px-4 py-4 whitespace-nowrap text-sm text-center font-semibold">${badgeHtml(r.adoptionGlobale)}</td>
        ${modules.map(m => `<td class="px-4 py-4 whitespace-nowrap text-sm text-center" title="${r['users_' + m.id]} utilisateur(s)">${badgeHtml(r['adoption_' + m.id])}</td>`).join('')}
    </tr>`).join('') || `<tr><td colspan="${4 + modules.length}" class="px-6 py-4 text-center text-gray-500">Aucune donnée disponible</td></tr>`;
    document.getElementById('adoption-legend').innerHTML =
        'Échelle indicative : <span class="px-2 py-0.5 rounded-full bg-green-500 text-white">≥ 50%</span> '
        + '<span class="px-2 py-0.5 rounded-full bg-yellow-500 text-white">30–49%</span> '
        + '<span class="px-2 py-0.5 rounded-full bg-orange-500 text-white">20–29%</span> '
        + '<span class="px-2 py-0.5 rounded-full bg-red-500 text-white">&lt; 20%</span>'
        + (controllers.size ? ' · Seuls les contrôleurs de la population cible comptent parmi les utilisateurs.' : '')
        + (current.horsPopulation ? ` · ${current.horsPopulation} utilisateur(s) rattaché(s) à un code absent de la population cible ne comptent dans aucune agence.` : '');
    updateSortIcons('ad-sort-', adoptionSort, ['direction', 'agency', 'effectif', 'adoptionGlobale'].concat(modules.map(m => 'adoption_' + m.id)));
}

function renderPertinenceTable() {
    const body = document.getElementById('pertinence-table-body');
    const rows = sortRows(current.pertinenceRows, pertinenceSort);
    body.innerHTML = rows.map((r, i) => `<tr class="${i % 2 ? 'bg-gray-50' : 'bg-white'}">
        <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-600">${esc(r.direction)}</td>
        <td class="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${esc(r.agency)}</td>
        <td class="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-700">${fmt(r.eligibles)}</td>
        <td class="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-700">${fmt(r.couvertes)}</td>
        <td class="px-4 py-4 whitespace-nowrap text-sm text-center bg-violet-50/40">${badgeHtml(r.couverture)}</td>
        <td class="px-4 py-4 whitespace-nowrap text-sm text-center bg-emerald-50/40">${badgeHtml(r.adoptionDescriptif)}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">Aucune affaire éligible sur la période</td></tr>';
    updateSortIcons('pe-sort-', pertinenceSort, ['direction', 'agency', 'eligibles', 'couvertes', 'couverture', 'adoptionDescriptif']);
}

function updateSortIcons(prefix, sortState, columns) {
    columns.forEach(col => {
        const icon = document.getElementById(prefix + col);
        if (!icon) return;
        if (sortState.column === col) { icon.textContent = sortState.ascending ? '↑' : '↓'; icon.className = 'ml-1 text-blue-600'; }
        else { icon.textContent = '↕'; icon.className = 'ml-1 text-gray-400'; }
    });
}

function sortAdoption(column) {
    if (adoptionSort.column === column) adoptionSort.ascending = !adoptionSort.ascending;
    else adoptionSort = { column, ascending: column === 'direction' || column === 'agency' };
    renderAdoptionTable();
}
function sortPertinence(column) {
    if (pertinenceSort.column === column) pertinenceSort.ascending = !pertinenceSort.ascending;
    else pertinenceSort = { column, ascending: column === 'direction' || column === 'agency' };
    renderPertinenceTable();
}
window.sortAdoption = sortAdoption;
window.sortPertinence = sortPertinence;

// ==================== COURBES PAR MODULE ====================

// Mois couverts par les usages retenus (bornes de la période, sinon de l'historique).
function monthKeys(dates) {
    if (!dates.length) return [];
    let min = dates[0], max = dates[0];
    dates.forEach(d => { if (d < min) min = d; if (d > max) max = d; });
    const keys = [];
    const cur = new Date(min.getFullYear(), min.getMonth(), 1);
    const end = new Date(max.getFullYear(), max.getMonth(), 1);
    while (cur <= end) { keys.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1); }
    return keys;
}
const monthOf = d => d.getFullYear() * 12 + d.getMonth();

// Courbe multi-modules d3 : une série par module, légende cliquable.
function drawModuleChart(el, chartData, opts) {
    d3.select(el).selectAll('*').remove();
    if (!chartData.length) { el.innerHTML = '<p class="text-sm text-gray-400 text-center py-8">Aucune utilisation sur la période.</p>'; return; }
    el.style.width = '100%';
    void el.offsetHeight;
    const containerWidth = el.offsetWidth || el.clientWidth || 800;
    const margin = { top: 20, right: 150, bottom: 60, left: 60 };
    const width = Math.max(400, containerWidth - margin.left - margin.right);
    const height = 320;
    const svg = d3.select(el).append('svg').attr('width', width + margin.left + margin.right).attr('height', height + margin.top + margin.bottom);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleTime().domain(d3.extent(chartData, d => d.date)).range([0, width]);
    const maxValue = d3.max(modules, m => d3.max(chartData, d => d[m.id] || 0)) || 0;
    const y = d3.scaleLinear().domain([0, Math.max(opts.minTop, Math.ceil(maxValue * 1.1))]).nice().range([height, 0]);
    const yTicks = opts.integer
        ? d3.range(0, y.domain()[1] + 0.0001, Math.max(1, Math.ceil(y.domain()[1] / 8)))
        : y.ticks(8);

    g.append('g').attr('class', 'grid').call(d3.axisLeft(y).tickValues(yTicks).tickSize(-width).tickFormat(''))
        .selectAll('line').style('stroke', '#DADACF').style('stroke-dasharray', '3,3');
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${height})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%m/%Y')));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).tickValues(yTicks).tickFormat(opts.format));
    g.append('text').attr('transform', 'rotate(-90)').attr('y', -margin.left).attr('x', -(height / 2)).attr('dy', '1em')
        .style('text-anchor', 'middle').style('font-size', '12px').text(opts.yLabel);

    const visibility = Object.fromEntries(modules.map(m => [m.id, true]));
    modules.forEach(m => {
        const line = d3.line().x(d => x(d.date)).y(d => y(d[m.id] || 0)).curve(d3.curveMonotoneX);
        g.append('path').datum(chartData).attr('class', `line s-${m.id}`).attr('d', line)
            .attr('stroke', m.color).attr('stroke-width', 2).attr('fill', 'none')
            .attr('stroke-dasharray', m.dashed ? '6 4' : null).style('pointer-events', 'none');
        g.selectAll(null).data(chartData).enter().append('circle').attr('class', `s-${m.id}`)
            .attr('cx', d => x(d.date)).attr('cy', d => y(d[m.id] || 0)).attr('r', 3.5)
            .attr('fill', m.dashed ? '#FFFDF6' : m.color).attr('stroke', m.color).attr('stroke-width', 1.5)
            .style('pointer-events', 'none');
    });

    const tooltip = g.append('g').style('opacity', 0).style('pointer-events', 'none');
    const tooltipText = tooltip.append('text').style('font-size', '13px').style('font-weight', 'bold').style('text-anchor', 'middle');
    const highlight = g.append('circle').attr('r', 6).attr('fill', 'none').attr('stroke-width', 2).style('opacity', 0);
    g.append('rect').attr('width', width).attr('height', height).attr('fill', 'transparent').style('cursor', 'crosshair')
        .on('mousemove', function (event) {
            const [mx, my] = d3.pointer(event, g.node());
            let best = null, bestDist = 30;
            modules.forEach(m => {
                if (!visibility[m.id]) return;
                chartData.forEach(d => {
                    const dist = Math.hypot(mx - x(d.date), my - y(d[m.id] || 0));
                    if (dist < bestDist) { bestDist = dist; best = { m, d }; }
                });
            });
            if (!best) { tooltip.style('opacity', 0); highlight.style('opacity', 0); return; }
            const px = x(best.d.date), py = y(best.d[best.m.id] || 0);
            tooltipText.selectAll('tspan').remove();
            tooltipText.append('tspan').attr('x', 0).attr('dy', '-1.2em').style('font-size', '11px').style('font-weight', 'normal')
                .style('fill', '#595959').text(d3.timeFormat('%m/%Y')(best.d.date));
            tooltipText.append('tspan').attr('x', 0).attr('dy', '1.2em').style('fill', '#1A1A1A')
                .text(`${best.m.label} : ${opts.tooltip(best.d[best.m.id] || 0)}`);
            tooltip.attr('transform', `translate(${Math.max(50, Math.min(px, width - 50))}, ${py < 30 ? py + 25 : py - 25})`).style('opacity', 1);
            highlight.attr('cx', px).attr('cy', py).attr('stroke', best.m.color).style('opacity', 1);
        })
        .on('mouseleave', () => { tooltip.style('opacity', 0); highlight.style('opacity', 0); });

    const legend = g.append('g').attr('transform', `translate(${width + 20}, 0)`);
    modules.forEach((m, i) => {
        const row = legend.append('g').attr('transform', `translate(0, ${i * 24})`).style('cursor', 'pointer')
            .on('click', () => {
                visibility[m.id] = !visibility[m.id];
                g.selectAll(`.s-${m.id}`).style('opacity', visibility[m.id] ? 1 : 0.15);
                row.style('opacity', visibility[m.id] ? 1 : 0.4);
            });
        row.append('line').attr('x1', 0).attr('x2', 18).attr('y1', 9).attr('y2', 9).attr('stroke', m.color).attr('stroke-width', 2)
            .attr('stroke-dasharray', m.dashed ? '5 3' : null);
        row.append('circle').attr('cx', 9).attr('cy', 9).attr('r', 3.5).attr('fill', m.dashed ? '#FFFDF6' : m.color).attr('stroke', m.color).attr('stroke-width', 1.5);
        row.append('text').attr('x', 24).attr('y', 9).attr('dy', '.35em').style('font-size', '12px').text(m.label);
    });
}

// Taux d'adoption mensuel ou cumulé par module : utilisateurs comptés de
// l'agence (ou du périmètre filtré) ÷ effectif du périmètre.
function updateAdoptionTimeChart() {
    const scope = scopeAgencies();
    const known = new Set(population.map(p => p.agencyCode));
    const inScope = email => {
        const home = homeAgency.get(email) || '';
        return known.has(home) && (!scope || scope.has(home));
    };
    const kept = modules.map(m => m.events.filter(e => inPeriod(e.date) && isCounted(e.email) && inScope(e.email)));
    const months = monthKeys(kept.flat().map(e => e.date));
    const cumul = adoptionChartMode === 'cumul';
    const seen = modules.map(() => new Set());
    const data = months.map(month => {
        const point = { date: month };
        modules.forEach((m, i) => {
            const users = cumul ? seen[i] : new Set();
            kept[i].forEach(e => { if (monthOf(e.date) === monthOf(month)) users.add(e.email); });
            point[m.id] = current.effectif > 0 ? users.size / current.effectif * 100 : 0;
        });
        return point;
    });
    drawModuleChart(document.getElementById('adoption-chart'), data, {
        minTop: 10, format: d => d + '%', yLabel: 'Taux d\'adoption (%)', tooltip: v => v.toFixed(1) + ' %',
    });
}

// Nombre d'utilisations par module (une ligne d'usage réel = une utilisation),
// SPS exclu, rattachées à l'agence de l'utilisateur.
function updateUsageTimeChart() {
    const scope = scopeAgencies();
    const kept = modules.map(m => m.events.filter(e => inPeriod(e.date) && !spsEmails.has(e.email)
        && (!scope || scope.has(homeAgency.get(e.email) || e.agency))));
    const months = monthKeys(kept.flat().map(e => e.date));
    const cumul = usageChartMode === 'cumul';
    const running = modules.map(() => 0);
    const data = months.map(month => {
        const point = { date: month };
        modules.forEach((m, i) => {
            const n = kept[i].filter(e => monthOf(e.date) === monthOf(month)).length;
            running[i] += n;
            point[m.id] = cumul ? running[i] : n;
        });
        return point;
    });
    drawModuleChart(document.getElementById('usage-chart'), data, {
        minTop: 5, integer: true, format: d3.format('d'), yLabel: 'Nombre d\'utilisations', tooltip: v => fmt(v),
    });
}

// ==================== DESCRIPTIF : ADOPTION vs COUVERTURE ====================

function updateDescriptifCompareChart() {
    const el = document.getElementById('descriptif-compare-chart');
    d3.select(el).selectAll('*').remove();
    const data = current.pertinenceRows.filter(s => s.effectif > 0 && s.adoptionDescriptif !== null)
        .map(s => ({ agency: s.agency, adoption: s.adoptionDescriptif || 0, couverture: s.couverture || 0 }))
        .sort((a, b) => b.couverture - a.couverture);
    if (!data.length) { el.innerHTML = '<p class="text-sm text-gray-400 text-center py-8">Aucune agence avec affaires éligibles et effectif connu.</p>'; return; }

    const margin = { top: 20, right: 20, bottom: 90, left: 50 };
    const width = Math.max(400, (el.offsetWidth || el.clientWidth || 800) - margin.left - margin.right);
    const height = 300;
    const svg = d3.select(el).append('svg').attr('width', width + margin.left + margin.right).attr('height', height + margin.top + margin.bottom);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const x0 = d3.scaleBand().domain(data.map(d => d.agency)).range([0, width]).padding(0.25);
    const x1 = d3.scaleBand().domain(['adoption', 'couverture']).range([0, x0.bandwidth()]).padding(0.08);
    const y = d3.scaleLinear().domain([0, Math.max(10, d3.max(data, d => Math.max(d.adoption, d.couverture)) * 1.1)]).nice().range([height, 0]);
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(6).tickFormat(d => d + '%'));
    g.append('g').attr('transform', `translate(0,${height})`).attr('class', 'axis').call(d3.axisBottom(x0))
        .selectAll('text').attr('transform', 'rotate(-40)').style('text-anchor', 'end').style('font-size', '10px');
    const colors = { adoption: '#BAF266', couverture: '#1A1A1A' };
    const groups = g.selectAll('.grp').data(data).enter().append('g').attr('transform', d => `translate(${x0(d.agency)},0)`);
    ['adoption', 'couverture'].forEach(key => {
        groups.append('rect')
            .attr('x', x1(key)).attr('y', d => y(d[key])).attr('width', x1.bandwidth()).attr('height', d => height - y(d[key]))
            .attr('fill', colors[key]).attr('rx', 2)
            .append('title').text(d => `${d.agency} — ${key === 'adoption' ? 'Adoption' : 'Couverture'} ${d[key].toFixed(1)}%`);
    });
}

function updateQuadrantChart() {
    const el = document.getElementById('descriptif-quadrant-chart');
    d3.select(el).selectAll('*').remove();
    const data = current.pertinenceRows.filter(s => s.effectif > 0 && s.adoptionDescriptif !== null && s.couverture !== null)
        .map(s => ({ agency: s.agency, x: s.adoptionDescriptif, y: s.couverture, effectif: s.effectif }));
    if (!data.length) { el.innerHTML = '<p class="text-sm text-gray-400 text-center py-8">Données insuffisantes pour la cartographie.</p>'; return; }

    const margin = { top: 20, right: 20, bottom: 50, left: 55 };
    const width = Math.max(400, (el.offsetWidth || el.clientWidth || 800) - margin.left - margin.right);
    const height = 360;
    const svg = d3.select(el).append('svg').attr('width', width + margin.left + margin.right).attr('height', height + margin.top + margin.bottom);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const x = d3.scaleLinear().domain([0, Math.max(10, d3.max(data, d => d.x) * 1.15)]).range([0, width]);
    const y = d3.scaleLinear().domain([0, Math.max(10, d3.max(data, d => d.y) * 1.15)]).range([height, 0]);
    const r = d3.scaleSqrt().domain([0, d3.max(data, d => d.effectif) || 1]).range([4, 22]);
    const meanX = d3.mean(data, d => d.x), meanY = d3.mean(data, d => d.y);
    g.append('line').attr('x1', x(meanX)).attr('x2', x(meanX)).attr('y1', 0).attr('y2', height).attr('stroke', '#B6B9AD').attr('stroke-dasharray', '4,4');
    g.append('line').attr('x1', 0).attr('x2', width).attr('y1', y(meanY)).attr('y2', y(meanY)).attr('stroke', '#B6B9AD').attr('stroke-dasharray', '4,4');
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${height})`).call(d3.axisBottom(x).ticks(6).tickFormat(d => d + '%'));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(6).tickFormat(d => d + '%'));
    g.append('text').attr('x', width / 2).attr('y', height + 40).style('text-anchor', 'middle').style('font-size', '12px').style('fill', '#1A1A1A').text('Adoption Descriptif (% contrôleurs) →');
    g.append('text').attr('transform', 'rotate(-90)').attr('x', -height / 2).attr('y', -42).style('text-anchor', 'middle').style('font-size', '12px').style('fill', '#1A1A1A').text('Couverture (% affaires éligibles) →');
    g.selectAll('.bubble').data(data).enter().append('circle')
        .attr('cx', d => x(d.x)).attr('cy', d => y(d.y)).attr('r', d => r(d.effectif))
        .attr('fill', '#BAF266').attr('fill-opacity', 0.35).attr('stroke', '#1A1A1A').attr('stroke-width', 1)
        .append('title').text(d => `${d.agency}\nAdoption ${d.x.toFixed(1)}% · Couverture ${d.y.toFixed(1)}%\nEffectif ${d.effectif}`);
    g.selectAll('.blabel').data(data).enter().append('text')
        .attr('x', d => x(d.x)).attr('y', d => y(d.y) - r(d.effectif) - 3).attr('text-anchor', 'middle')
        .style('font-size', '9px').style('fill', '#595959').text(d => d.agency);
}

// ==================== ÉVÉNEMENTS ====================

startDateEl.addEventListener('change', () => { dateFilter.startDate = startDateEl.value || null; refreshAll(); });
endDateEl.addEventListener('change', () => { dateFilter.endDate = endDateEl.value || null; refreshAll(); });
directionFilterEl.addEventListener('change', () => { populateAgencyFilter(); refreshAll(); });
agencyFilterEl.addEventListener('change', refreshAll);
document.getElementById('reset-filters').addEventListener('click', () => {
    startDateEl.value = ''; endDateEl.value = ''; directionFilterEl.value = ''; agencyFilterEl.value = '';
    dateFilter = { startDate: null, endDate: null };
    populateAgencyFilter(); refreshAll();
});

// Bascules Mensuel / Cumulé des deux courbes.
function bindModeToggle(toggleId, subtitleId, getMode, setMode, texts, redraw) {
    const toggle = document.getElementById(toggleId);
    const sync = () => {
        toggle.querySelectorAll('span[data-mode]').forEach(span => {
            span.className = span.dataset.mode === getMode()
                ? 'px-3 py-1 rounded-md text-sm font-medium bg-white text-emerald-700 shadow-sm transition-all'
                : 'px-3 py-1 rounded-md text-sm font-medium text-gray-500 hover:text-gray-700 transition-all';
        });
        document.getElementById(subtitleId).textContent = texts[getMode()];
    };
    toggle.addEventListener('click', e => {
        const span = e.target.closest('span[data-mode]');
        if (!span || span.dataset.mode === getMode()) return;
        setMode(span.dataset.mode);
        sync();
        if (current) redraw();
    });
}
bindModeToggle('adoption-mode-toggle', 'adoption-chart-subtitle', () => adoptionChartMode, m => { adoptionChartMode = m; }, {
    monthly: 'Taux mensuel (% de contrôleurs actifs sur le mois / effectif). Cliquer sur la légende pour isoler un module.',
    cumul: 'Taux cumulé (% de contrôleurs ayant utilisé le module depuis le début / effectif). Cliquer sur la légende pour isoler un module.',
}, updateAdoptionTimeChart);
bindModeToggle('usage-mode-toggle', 'usage-chart-subtitle', () => usageChartMode, m => { usageChartMode = m; }, {
    monthly: 'Nombre d\'utilisations enregistrées sur le mois, par module. Cliquer sur la légende pour isoler un module.',
    cumul: 'Nombre cumulé d\'utilisations depuis le début, par module. Cliquer sur la légende pour isoler un module.',
}, updateUsageTimeChart);

let resizeTimeout;
window.addEventListener('resize', () => { clearTimeout(resizeTimeout); resizeTimeout = setTimeout(refreshAll, 250); });

start();
