// ============================================================================
// copil-ia.js — Page « COPIL IA ».
//
// Lit l'instantané kpi_snapshot_copil publié par le dashboard (app.js,
// publishCopilSnapshot) dans le MÊME onglet. Page de décision : adoption
// MENSUELLE avec sa cible, carte des hausses et baisses, variations à
// expliquer. Le détail par fonctionnalité reste sur les pages dédiées.
//
// La page est lue par un agent qui fait la mise en forme du deck : tous les
// chiffres affichés sont aussi publiés en JSON (#copil-json et
// window.COPIL_DATA). Aucun LLM ici : les variations sont détectées par les
// seuils de shared/copil.js.
// ============================================================================

const PLATFORM_URL = 'https://hedical.github.io/livepages/KPIs%20IA/index.html';

// Palettes catégorielles validées (dataviz), une par famille d'entités.
const MODULE_COLORS = {
    'descriptif': '#2a78d6', 'analyse-cctp': '#eb6834', 'autocontact': '#1baf7a',
    'libre-ct': '#eda100', 'autocontact-sps': '#e87ba4',
};
const METIER_COLORS = { CT: '#4a3aa7', SPS: '#e87ba4', DIAG: '#008300', PPI: '#eda100' };
const INK = { secondary: '#52514e', muted: '#898781', grid: '#e5e7eb', target: '#52514e' };

// Divergent bleu (hausse) ↔ rouge (baisse), milieu gris neutre.
const HEAT = {
    neutral: '#f0efec',
    up: ['#cde2fb', '#9ec5f4', '#6da7ec'],
    down: ['#fbdcdb', '#f5adac', '#ee8180'],
};

// Modules CT tracés sur le graphe d'adoption (les autres sont dans la carte).
const CT_ADOPTION_MODULES = ['descriptif', 'analyse-cctp', 'autocontact', 'libre-ct'];
const SYS_MODULES = ['descriptif', 'autocontact', 'autocontact-sps'];

const HEAT_METRICS = [
    { id: 'activeUsers', label: 'Utilisateurs actifs' },
    { id: 'adoption', label: 'Adoption' },
    { id: 'requests', label: 'Requêtes' },
    { id: 'rpu', label: 'Requêtes / utilisateur' },
    { id: 'sys', label: 'Systématisation' },
];

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_COURTS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

// ==================== STATE ====================
let snapshot = null;
let selectedMonth = null;
let heatMetric = 'activeUsers';
let libreView = 'libre'; // 'libre' | 'chat' | 'expert'
const charts = {};

// ==================== HELPERS ====================

const $ = id => document.getElementById(id);
const esc = s => KPI.escapeHtml(s);
const fmt = n => KPI.formatNumber(n);

function monthLabel(key, court) {
    const [y, m] = key.split('-').map(Number);
    return court ? `${MOIS_COURTS[m - 1]} ${String(y).slice(2)}` : `${MOIS[m - 1]} ${y}`;
}

function pct(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return `${(v * 100).toFixed(digits || 0).replace('.', ',')} %`;
}

function dec(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return v.toFixed(digits === undefined ? 1 : digits).replace('.', ',');
}

function signed(v, unit) {
    if (v === null || v === undefined) return '—';
    if (!isFinite(v)) return 'nouveau';
    const r = Math.round(v * 100);
    return `${r > 0 ? '+' : ''}${r}${unit}`;
}

function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function rowAt(item, month) {
    return (item && item.series || []).find(r => r.month === month) || null;
}

// Libellé hors contexte : « Chat projet » seul ne dit pas qu'il s'agit du
// détail de l'usage libre.
function displayLabel(item) {
    return item.kind === 'libre-detail' ? `Usage libre › ${item.label}` : item.label;
}

function moduleById(id) {
    return snapshot.modules.find(m => m.id === id) || null;
}

function populationOf(metier) {
    const v = snapshot.populations ? snapshot.populations[metier] : null;
    return v ? Number(v) : null;
}

// 12 derniers mois jusqu'au mois présenté, bornés au début des données.
function lastMonths(n, upTo) {
    const all = KPICopil.monthRange(snapshot.months[0], upTo || selectedMonth);
    return all.slice(Math.max(0, all.length - n));
}

// Valeur d'un indicateur pour une ligne de série.
function metricValue(metric, row, item) {
    if (!row) return null;
    switch (metric) {
        case 'activeUsers': return row.activeUsers;
        case 'adoption': return KPICopil.adoption(row, populationOf(item.metier));
        case 'requests': return item.isMetier ? null : row.requests; // unités mêlées au niveau métier
        case 'rpu': return item.isMetier ? null : KPICopil.requestsPerUser(row);
        case 'sys': return item.hasParc ? KPICopil.systematisation(row) : null;
        default: return null;
    }
}

function metricFormat(metric, v) {
    if (v === null || v === undefined) return '—';
    if (metric === 'adoption' || metric === 'sys') return pct(v);
    if (metric === 'rpu') return dec(v);
    return fmt(v);
}

// ==================== 1. SYNTHÈSE ====================

function tile(label, value, sub, progress, note) {
    const bar = progress === null || progress === undefined ? ''
        : `<div class="mt-3 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div class="h-full bg-indigo-500 rounded-full" style="width:${Math.min(100, progress * 100)}%"></div></div>`;
    return `<div class="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
        <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">${label}</p>
        <p class="text-3xl font-bold text-gray-900 mt-2 num">${value}</p>
        <p class="text-xs text-gray-500 mt-1">${sub}</p>${bar}
        ${note ? `<p class="text-xs text-gray-400 mt-2">${note}</p>` : ''}
    </div>`;
}

function computeSynthese() {
    const m = selectedMonth;
    const cibleM = KPICopil.CIBLES.gainMensuelHeures;
    const cibleA = KPICopil.CIBLES.gainAnnuelHeures;
    const year = m.slice(0, 4);
    const heures = (snapshot.hoursByMonth[m] || {}).total || 0;
    const ytd = Object.keys(snapshot.hoursByMonth)
        .filter(k => k.startsWith(year) && k <= m)
        .reduce((s, k) => s + (snapshot.hoursByMonth[k].total || 0), 0);

    const dr = rowAt(moduleById('descriptif'), m);
    const ct = rowAt(snapshot.metiers.find(x => x.id === 'CT'), m);
    const cr = rowAt(moduleById('analyse-cctp'), m);
    const popCT = populationOf('CT');
    const cible = KPICopil.CIBLES.adoption;

    return {
        heures: Math.round(heures), cibleMensuelle: cibleM, atteinteMensuelle: heures / cibleM,
        cumulAnnee: Math.round(ytd), cibleAnnuelle: cibleA, atteinteAnnuelle: ytd / cibleA,
        descriptif: dr ? {
            rictAvecIA: dr.dossiersIA, rictTotal: dr.dossiersTotal, partRictAvecIA: KPICopil.penetration(dr),
            utilisateurs: dr.activeUsers, systematisation: KPICopil.systematisation(dr), seuilMots: 100,
        } : null,
        adoptionCT: {
            ctActifs: ct ? ct.activeUsers : 0, populationCT: popCT,
            adoption: ct ? KPICopil.adoption(ct, popCT) : null,
            cible: cible.value, echeance: cible.month,
            // « Plus de » 50 % : strictement au-dessus (97 CT sur 192, pas 96).
            ctActifsNecessaires: popCT ? Math.floor(cible.value * popCT) + 1 : null,
            analyseCctp: { ctActifs: cr ? cr.activeUsers : 0, adoption: cr ? KPICopil.adoption(cr, popCT) : null },
        },
    };
}

function renderSynthese(s) {
    $('synthese-month').textContent = monthLabel(selectedMonth);
    $('partial-banner').classList.toggle('hidden', selectedMonth !== currentMonthKey());
    const d = s.descriptif;
    const c = s.adoptionCT;
    $('synthese').innerHTML = [
        tile('Heures gagnées du mois', `${fmt(s.heures)} h`,
            `${pct(s.atteinteMensuelle)} de la cible (${fmt(s.cibleMensuelle)} h / mois)`, s.atteinteMensuelle),
        tile(`Cumul ${selectedMonth.slice(0, 4)}`, `${fmt(s.cumulAnnee)} h`,
            `${pct(s.atteinteAnnuelle)} de la cible annuelle (${fmt(s.cibleAnnuelle)} h)`, s.atteinteAnnuelle),
        tile("Descriptifs RICT avec l'IA", d ? fmt(d.rictAvecIA) : '—',
            d ? `sur ${fmt(d.rictTotal)} RICT (${pct(d.partRictAvecIA)}) · ${fmt(d.utilisateurs)} utilisateurs uniques` : 'aucun ce mois-ci',
            null, 'Seuil retenu : plus de 100 mots'),
        tile('Adoption CT du mois', pct(c.adoption),
            `${fmt(c.ctActifs)} CT actifs sur ${fmt(c.populationCT)} (tous modules) · il en faut ${fmt(c.ctActifsNecessaires)}`,
            c.adoption !== null ? c.adoption / c.cible : null,
            `Cible d'adoption : plus de ${pct(c.cible)} fin ${c.echeance.slice(0, 4)} · cible fin mars à fixer · dont analyse CCTP : ${pct(c.analyseCctp.adoption)}`),
    ].join('');
}

// ==================== 2. ADOPTION ====================

function renderAdoption() {
    const cible = KPICopil.CIBLES.adoption;
    // Axe : 12 derniers mois, prolongé jusqu'à l'échéance de la cible pour
    // qu'on voie la distance à parcourir.
    const base = lastMonths(12);
    const end = cible && cible.month > selectedMonth ? cible.month : selectedMonth;
    const months = KPICopil.monthRange(base[0], end);
    const labels = months.map(k => monthLabel(k, true));
    const popCT = populationOf('CT');

    // Tous modules CT d'abord : c'est la courbe que la cible d'adoption juge.
    const ctTotal = Object.assign({}, snapshot.metiers.find(x => x.id === 'CT'),
        { label: 'Tous modules CT', color: METIER_COLORS.CT });
    const series = [ctTotal].concat(CT_ADOPTION_MODULES.map(moduleById).filter(Boolean)
        .map(mod => Object.assign({ color: MODULE_COLORS[mod.id] }, mod)));
    const datasets = series.map(item => Object.assign(lineDataset(
        item.label,
        months.map(k => {
            if (k > selectedMonth || !item.startMonth || k < item.startMonth) return null;
            return popCT ? KPICopil.adoption(rowAt(item, k) || { activeUsers: 0 }, popCT) : (rowAt(item, k) || {}).activeUsers || 0;
        }),
        item.color), item === ctTotal ? { borderWidth: 3 } : {}));

    if (popCT) {
        datasets.push({
            label: `Cible d'adoption : plus de ${pct(cible.value)} (fin ${cible.month.slice(0, 4)})`,
            data: months.map(() => cible.value),
            borderColor: INK.target, borderDash: [6, 4], borderWidth: 1.5,
            pointRadius: months.map(k => (k === cible.month ? 5 : 0)), pointHoverRadius: 0,
            pointBackgroundColor: INK.target, fill: false,
        });
    }
    $('adoption-ct-unit').textContent = popCT ? `actifs du mois ÷ ${fmt(popCT)} CT` : 'actifs du mois';
    drawChart('adoptionCt', 'adoption-ct-chart', {
        type: 'line', data: { labels, datasets },
        options: popCT ? pctOptions(0.6) : countOptions(),
    });

    const mMonths = lastMonths(12);
    const prevKey = KPICopil.previousMonth(selectedMonth);
    $('metiers-grid').innerHTML = snapshot.metiers.map(mt => {
        const cur = (rowAt(mt, selectedMonth) || {}).activeUsers || 0;
        const prev = rowAt(mt, prevKey) ? rowAt(mt, prevKey).activeUsers : null;
        const d = KPICopil.change(prev, cur);
        const delta = d === null ? '' : `<span class="text-xs ${d < 0 ? 'text-red-700' : 'text-green-700'}">${d < 0 ? '▼' : '▲'} ${signed(d, ' %')}</span>`;
        return `<div>
            <p class="text-sm text-gray-700"><span class="font-medium">${esc(mt.label)}</span>
                <span class="text-xs text-gray-400">${esc(KPICopil.METIERS[mt.id].pole)}</span></p>
            <p class="text-lg font-semibold text-gray-900 num">${fmt(cur)} ${delta}</p>
            <div class="relative h-28"><canvas id="metier-${mt.id}" role="img" aria-label="Utilisateurs actifs par mois, ${esc(mt.label)}"></canvas></div>
        </div>`;
    }).join('');
    snapshot.metiers.forEach(mt => {
        const pop = populationOf(mt.id);
        const o = countOptions();
        o.plugins.legend.display = false;
        o.scales.x.ticks.maxTicksLimit = 4;
        o.scales.y.ticks.maxTicksLimit = 4;
        drawChart(`metier-${mt.id}`, `metier-${mt.id}`, {
            type: 'line',
            data: {
                labels: mMonths.map(k => monthLabel(k, true)),
                datasets: [Object.assign(lineDataset('Utilisateurs actifs',
                    mMonths.map(k => (mt.startMonth && k >= mt.startMonth ? (rowAt(mt, k) || {}).activeUsers || 0 : null)),
                    METIER_COLORS[mt.id]), { pointRadius: 2 })].concat(pop ? [{
                    // Cible d'adoption traduite en utilisateurs, quand la population est connue.
                    label: `Cible d'adoption (${pct(cible.value)} de ${fmt(pop)})`,
                    data: mMonths.map(() => Math.floor(cible.value * pop) + 1),
                    borderColor: INK.target, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0,
                }] : []),
            },
            options: o,
        });
    });
}

// ==================== 3. CARTE DES HAUSSES ET BAISSES ====================

function heatColor(metric, prev, curr) {
    if (prev === null || curr === null) return '#ffffff';
    const isRate = metric === 'adoption' || metric === 'sys';
    const d = isRate ? (curr - prev) : KPICopil.change(prev, curr);
    if (d === null) return HEAT.up[0];
    const steps = isRate ? [0.02, 0.05, 0.1] : [0.05, 0.2, 0.4];
    const a = Math.abs(d);
    if (a < steps[0]) return HEAT.neutral;
    const lvl = a >= steps[2] ? 2 : a >= steps[1] ? 1 : 0;
    return d > 0 ? HEAT.up[lvl] : HEAT.down[lvl];
}

function heatDelta(metric, prev, curr) {
    if (prev === null || curr === null) return '';
    const isRate = metric === 'adoption' || metric === 'sys';
    const d = isRate ? (curr - prev) : KPICopil.change(prev, curr);
    if (d === null) return 'nouveau';
    if (Math.abs(d) < (isRate ? 0.005 : 0.005)) return '=';
    const arrow = d > 0 ? '▲' : '▼';
    return `${arrow} ${signed(d, isRate ? ' pts' : ' %')}`;
}

function heatRows() {
    const rows = [];
    KPICopil.METIER_ORDER.forEach(k => {
        const mt = snapshot.metiers.find(x => x.id === k);
        if (mt) rows.push(Object.assign({ isMetier: true }, mt));
        snapshot.modules.filter(mod => mod.metier === k).forEach(mod => rows.push(mod));
    });
    return rows;
}

function renderHeat() {
    $('heat-metric').innerHTML = HEAT_METRICS.map(x =>
        `<button data-metric="${x.id}" aria-pressed="${x.id === heatMetric}" class="px-3 py-1.5 text-sm font-medium rounded-md text-gray-600 ${x.id === heatMetric ? 'seg-active' : ''}">${x.label}</button>`).join('');
    $('heat-metric').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        heatMetric = b.dataset.metric;
        renderHeat();
    }));

    const months = lastMonths(6);
    const head = `<thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide"><tr>
        <th class="px-4 py-3 text-left font-medium">Métier / série</th>
        ${months.map(k => `<th class="px-3 py-3 text-right font-medium ${k === selectedMonth ? 'text-gray-900' : ''}">${monthLabel(k, true)}</th>`).join('')}
    </tr></thead>`;

    const body = heatRows().map(item => {
        const label = item.isMetier
            ? `<span class="font-semibold text-gray-900">${esc(item.label)}</span> <span class="text-xs text-gray-400">${esc(KPICopil.METIERS[item.id].pole)} · tous modules</span>`
            : item.kind === 'libre-detail'
                ? `<span class="pl-10 text-gray-500">↳ ${esc(item.label)}</span>`
                : `<span class="pl-4 text-gray-700">${esc(item.label)}</span>`;
        const cells = months.map(k => {
            const started = item.startMonth && k >= item.startMonth;
            const v = started ? metricValue(heatMetric, rowAt(item, k) || zeroRow(k), item) : null;
            const pk = KPICopil.previousMonth(k);
            const pv = started && item.startMonth <= pk ? metricValue(heatMetric, rowAt(item, pk) || zeroRow(pk), item) : null;
            const bg = v === null ? '#ffffff' : heatColor(heatMetric, pv, v);
            const delta = v === null ? '' : heatDelta(heatMetric, pv, v);
            return `<td class="cell px-3 py-2 text-right num ${k === selectedMonth ? 'font-semibold' : ''}" style="background:${bg}">
                <div class="text-gray-900">${metricFormat(heatMetric, v)}</div>
                <div class="text-[11px] text-gray-600">${delta}</div></td>`;
        }).join('');
        return `<tr class="${item.isMetier ? 'border-t-2 border-gray-200' : 'border-t border-gray-100'}">
            <th scope="row" class="px-4 py-2 text-left font-normal whitespace-nowrap">${label}</th>${cells}</tr>`;
    }).join('');

    $('heat-table').innerHTML = head + `<tbody>${body}</tbody>`;
}

function zeroRow(month) {
    return { month, activeUsers: 0, newUsers: 0, requests: 0, dossiersIA: 0, dossiersUsers: null, dossiersTotal: null };
}

// ==================== 4. VARIATIONS ====================

function computeVariations() {
    const m = selectedMonth;
    // Un métier à un seul module répéterait la ligne de ce module (le détail
    // chat / expert de l'usage libre ne compte pas comme un module).
    const multi = snapshot.metiers.filter(mt =>
        snapshot.modules.filter(mod => mod.metier === mt.id && mod.startMonth && mod.kind !== 'libre-detail').length > 1);
    const metiers = KPICopil.detectFluctuations(multi, m)
        .filter(f => f.metric === 'activeUsers')
        .map(f => Object.assign(f, { label: `${f.label} — tous modules` }));
    const modules = KPICopil.detectFluctuations(snapshot.modules, m).map(f => {
        const mod = moduleById(f.id);
        return Object.assign(f, { label: mod ? displayLabel(mod) : f.label });
    });
    return metiers.concat(modules).sort((a, b) => a.delta - b.delta);
}

function renderVariations(list) {
    const m = selectedMonth;
    const prev = KPICopil.previousMonth(m);
    $('fluct-prev-h').textContent = monthLabel(prev, true);
    $('fluct-curr-h').textContent = monthLabel(m, true);
    $('fluct-intro').textContent = `${monthLabel(m)} comparé à ${monthLabel(prev)}. Détection par seuils fixes (±20 % sur un volume, ±10 points sur la systématisation, volumes inférieurs à 5 ignorés), sans IA. Baisses en tête : ce sont elles qu'il faut expliquer.`;
    if (!list.length) {
        $('fluct-body').innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-gray-400">Aucune variation au-dessus des seuils.</td></tr>';
        return;
    }
    $('fluct-body').innerHTML = list.map(f => {
        const isPts = f.kind === 'points';
        const down = f.delta < 0;
        const v = x => (isPts ? pct(x) : fmt(x));
        return `<tr>
            <td class="px-4 py-2 text-gray-700">${esc(KPICopil.METIERS[f.metier].label)}</td>
            <td class="px-4 py-2 text-gray-900">${esc(f.label)}</td>
            <td class="px-4 py-2 text-gray-700">${esc(f.metricLabel)}</td>
            <td class="px-4 py-2 text-right num">${v(f.prev)}</td>
            <td class="px-4 py-2 text-right num">${v(f.curr)}</td>
            <td class="px-4 py-2 text-right num font-semibold ${down ? 'text-red-700' : 'text-green-700'}">${down ? '▼' : '▲'} ${signed(f.delta, isPts ? ' pts' : ' %')}</td>
        </tr>`;
    }).join('');
}

// ==================== 5. SYSTÉMATISATION ====================

function renderSystematisation() {
    const m = selectedMonth;
    const d = rowAt(moduleById('descriptif'), m);
    $('sys-example').innerHTML = d && d.dossiersUsers ? [
        `En ${monthLabel(m)}, <strong>${fmt(d.activeUsers)}</strong> CT ont produit au moins un descriptif IA de plus de 100 mots.`,
        `Ces ${fmt(d.activeUsers)} CT ont émis <strong>${fmt(d.dossiersUsers)}</strong> RICT dans le mois, dont <strong>${fmt(d.dossiersIA)}</strong> avec le descriptif IA :`,
        `systématisation de <strong>${pct(KPICopil.systematisation(d))}</strong>.`,
        `<br><br>Rapporté à l'ensemble des ${fmt(d.dossiersTotal)} RICT du mois (utilisateurs ou non), la part IA est de ${pct(KPICopil.penetration(d))}.`,
    ].join(' ') : `Pas de descriptif IA en ${monthLabel(m)}.`;

    const months = lastMonths(12);
    drawChart('sys', 'sys-chart', {
        type: 'line',
        data: {
            labels: months.map(k => monthLabel(k, true)),
            datasets: SYS_MODULES.map(moduleById).filter(Boolean).map(mod => lineDataset(
                mod.label, months.map(k => KPICopil.systematisation(rowAt(mod, k))), MODULE_COLORS[mod.id])),
        },
        options: pctOptions(1),
    });
}

// ==================== 6. USAGE LIBRE ====================

function renderLibre() {
    const views = [['libre', 'Chat + expert'], ['chat', 'Chat projet'], ['expert', 'Expert technique']];
    $('libre-view').innerHTML = views.map(([id, label]) =>
        `<button data-view="${id}" aria-pressed="${id === libreView}" class="px-3 py-1.5 text-sm font-medium rounded-md text-gray-600 ${id === libreView ? 'seg-active' : ''}">${label}</button>`).join('');
    $('libre-view').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        libreView = b.dataset.view;
        renderLibre();
    }));

    const months = lastMonths(12);
    drawChart('libre', 'libre-chart', {
        type: 'line',
        data: {
            labels: months.map(k => monthLabel(k, true)),
            datasets: KPICopil.METIER_ORDER.map(k => {
                const mod = moduleById(`${libreView}-${k.toLowerCase()}`);
                if (!mod || !mod.startMonth) return null;
                return lineDataset(KPICopil.METIERS[k].label,
                    months.map(mk => (mk >= mod.startMonth ? KPICopil.requestsPerUser(rowAt(mod, mk)) : null)),
                    METIER_COLORS[k]);
            }).filter(Boolean),
        },
        options: countOptions(1),
    });
}

// ==================== 7. HEURES ====================

function renderHours() {
    const year = selectedMonth.slice(0, 4);
    const months = KPICopil.monthRange(`${year}-01`, selectedMonth).filter(k => k >= snapshot.months[0]);
    const cible = KPICopil.CIBLES.gainMensuelHeures;
    const o = baseOptions();
    o.scales.x.stacked = true;
    o.scales.y.stacked = true;
    o.scales.y.ticks.callback = v => `${fmt(v)} h`;
    o.plugins.tooltip.callbacks = {
        label: c => `${c.dataset.label} : ${fmt(c.raw)} h`,
        footer: items => {
            const t = (snapshot.hoursByMonth[months[items[0].dataIndex]] || {}).total || 0;
            return `Total : ${fmt(t)} h (${pct(t / cible)} de la cible)`;
        },
    };
    drawChart('hours', 'hours-chart', {
        type: 'bar',
        data: {
            labels: months.map(k => monthLabel(k, true)),
            datasets: [
                ...KPICopil.METIER_ORDER.map(k => ({
                    label: KPICopil.METIERS[k].label,
                    data: months.map(mk => Math.round((snapshot.hoursByMonth[mk] || {})[k] || 0)),
                    backgroundColor: METIER_COLORS[k],
                    borderColor: '#ffffff', borderWidth: { top: 2 }, borderSkipped: 'bottom',
                    maxBarThickness: 36, stack: 'h',
                })),
                {
                    type: 'line', label: `Cible (${fmt(cible)} h / mois)`, data: months.map(() => cible),
                    borderColor: INK.target, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0,
                },
            ],
        },
        options: o,
    });
}

// ==================== JSON POUR L'AGENT ====================

function seriesExport(item, months) {
    return months.map(k => {
        const r = rowAt(item, k) || (item.startMonth && k >= item.startMonth ? zeroRow(k) : null);
        if (!r) return { mois: k, actif: false };
        const out = { mois: k, utilisateursActifs: r.activeUsers, nouveauxUtilisateurs: r.newUsers };
        const pop = populationOf(item.metier);
        if (pop) out.adoption = round(KPICopil.adoption(r, pop));
        if (!item.isMetier) {
            out.requetes = r.requests;
            if (item.kind === 'libre' || item.kind === 'libre-detail') out.uniteRequete = 'message';
            out.requetesParUtilisateur = round(KPICopil.requestsPerUser(r), 2);
            if (item.kind === 'module') out.dossiersTraitesIA = r.dossiersIA;
            if (item.hasParc) {
                out.dossiersDesUtilisateurs = r.dossiersUsers;
                out.systematisation = round(KPICopil.systematisation(r));
                out.dossiersTotal = r.dossiersTotal;
                out.partDossiersTotalAvecIA = round(KPICopil.penetration(r));
            }
        }
        return out;
    });
}

function round(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return null;
    const f = Math.pow(10, d === undefined ? 3 : d);
    return Math.round(v * f) / f;
}

function renderJson(synthese, variations) {
    const months = lastMonths(6);
    const data = {
        mois: selectedMonth,
        moisEnCours: selectedMonth === currentMonthKey(),
        donneesDu: snapshot.generatedAt,
        source: PLATFORM_URL,
        definitions: {
            adoption: 'utilisateurs actifs du mois / population concernée',
            systematisation: 'dossiers du mois traités avec le module / dossiers du mois des utilisateurs actifs du module',
            requetesParUtilisateur: 'usages du mois / utilisateurs actifs (usage libre : messages)',
            variations: 'seuils fixes : ±20 % volume, ±10 pts taux, base minimale 5 ; pas de LLM',
        },
        metiers: Object.fromEntries(KPICopil.METIER_ORDER.map(k => [k, Object.assign({ population: populationOf(k) }, KPICopil.METIERS[k])])),
        cibles: KPICopil.CIBLES,
        synthese: Object.assign({}, synthese, {
            atteinteMensuelle: round(synthese.atteinteMensuelle),
            atteinteAnnuelle: round(synthese.atteinteAnnuelle),
        }),
        variationsAExpliquer: variations.map(f => ({
            metier: f.metier, serie: f.label, indicateur: f.metricLabel,
            precedent: f.kind === 'points' ? round(f.prev) : f.prev,
            courant: f.kind === 'points' ? round(f.curr) : f.curr,
            variation: isFinite(f.delta) ? round(f.delta) : 'nouveau',
            unite: f.kind === 'points' ? 'points de taux' : 'relatif',
        })),
        parMetier: snapshot.metiers.map(mt => ({ metier: mt.id, libelle: mt.label, series: seriesExport(Object.assign({ isMetier: true }, mt), months) })),
        parModule: snapshot.modules.map(mod => ({ id: mod.id, libelle: displayLabel(mod), metier: mod.metier,
            detailDe: mod.parent || undefined, depuis: mod.startMonth, series: seriesExport(mod, months) })),
    };
    window.COPIL_DATA = data;
    $('copil-json').textContent = JSON.stringify(data, null, 2);
}

// ==================== CHART HELPERS ====================

function lineDataset(label, data, color) {
    return {
        label, data,
        borderColor: color, backgroundColor: color,
        borderWidth: 2, tension: 0.25, spanGaps: false,
        pointRadius: 3, pointHoverRadius: 5, pointBorderColor: '#ffffff', pointBorderWidth: 2,
    };
}

function baseOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { position: 'bottom', labels: { color: INK.secondary, boxWidth: 12, boxHeight: 12, usePointStyle: true } },
            tooltip: { backgroundColor: '#111827', padding: 10, filter: c => c.raw !== null },
        },
        scales: {
            x: { grid: { display: false }, ticks: { color: INK.muted } },
            y: { beginAtZero: true, grid: { color: INK.grid }, border: { display: false }, ticks: { color: INK.muted } },
        },
    };
}

function pctOptions(suggestedMax) {
    const o = baseOptions();
    o.scales.y.suggestedMax = suggestedMax;
    o.scales.y.ticks.callback = v => pct(v);
    o.plugins.tooltip.callbacks = { label: c => `${c.dataset.label} : ${pct(c.raw, 1)}` };
    return o;
}

function countOptions(digits) {
    const o = baseOptions();
    if (!digits) o.scales.y.ticks.precision = 0;
    o.plugins.tooltip.callbacks = { label: c => `${c.dataset.label} : ${digits ? dec(c.raw, digits) : fmt(c.raw)}` };
    return o;
}

function drawChart(key, canvasId, config) {
    if (charts[key]) charts[key].destroy();
    charts[key] = new Chart($(canvasId), config);
}

// ==================== ORCHESTRATION ====================

function renderAll() {
    const synthese = computeSynthese();
    const variations = computeVariations();
    renderSynthese(synthese);
    renderAdoption();
    renderHeat();
    renderVariations(variations);
    renderSystematisation();
    renderLibre();
    renderHours();
    renderJson(synthese, variations);
}

function initMonthSelect() {
    // Par défaut : le dernier mois COMPLET (le COPIL présente un mois clos).
    const cur = currentMonthKey();
    const months = snapshot.months.slice().reverse();
    const prev = KPICopil.previousMonth(cur);
    selectedMonth = months.includes(prev) ? prev : months[0];
    $('month-select').innerHTML = months.map(k =>
        `<option value="${k}" ${k === selectedMonth ? 'selected' : ''}>${monthLabel(k)}${k === cur ? ' (en cours)' : ''}</option>`).join('');
    $('month-select').addEventListener('change', e => {
        selectedMonth = e.target.value;
        renderAll();
    });
}

(function init() {
    try {
        const raw = sessionStorage.getItem('kpi_snapshot_copil');
        snapshot = raw ? JSON.parse(raw) : null;
    } catch (e) {
        snapshot = null;
    }
    $('loading').classList.add('hidden');
    if (!snapshot || !Array.isArray(snapshot.modules) || !Array.isArray(snapshot.metiers) || !(snapshot.months || []).length) {
        $('no-snapshot').classList.remove('hidden');
        return;
    }
    $('generated-at').textContent = `données du ${new Date(snapshot.generatedAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}`;
    $('copy-link').addEventListener('click', async () => {
        const btn = $('copy-link');
        try {
            await navigator.clipboard.writeText(PLATFORM_URL);
            btn.textContent = 'Lien copié';
        } catch (e) {
            window.prompt('Lien de la plateforme KPIs :', PLATFORM_URL);
        }
        setTimeout(() => { btn.textContent = 'Copier le lien plateforme'; }, 2000);
    });
    initMonthSelect();
    $('main-content').classList.remove('hidden');
    renderAll();
})();
