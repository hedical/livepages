// ============================================================================
// claude-ia.js — Page « Claude — Usage et adoption ».
//
// Lit claude_kpis.json (URL signée CLAUDE_KPIS_URL du webhook passwordROI),
// calculé par le workflow n8n « KPIs IA — Dépôt exports Claude » à partir des
// exports hebdomadaires de la console Claude (Team Groupe et Pôle PPI).
// Toute la composition des chiffres vit dans shared/claude.js (KPIClaude),
// testé en Node ; ce fichier ne fait que charger et peindre.
// ============================================================================

const TEAM_KEY = 'claude_team';
const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0));
const pct = (x) => new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 }).format(x || 0);
const dec = (x) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(x || 0);
const dateFr = (iso) => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

let kpis = null;
let team = 'tous';
let evolutionChart = null;

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

// ==================== TUILES ====================

function deltaText(cur, prev, unit) {
    const d = KPIClaude.delta(cur, prev);
    if (!d) return { text: 'Évolution : dès le prochain relevé', cls: 'text-graphite' };
    if (d.abs === 0) return { text: '= par rapport au relevé précédent', cls: 'text-graphite' };
    const sign = d.abs > 0 ? '+' : '−';
    const rel = d.pct != null ? ` (${sign}${pct(Math.abs(d.pct))})` : '';
    return { text: `${sign}${fmt(Math.abs(d.abs))}${unit || ''}${rel} vs relevé précédent`, cls: d.abs > 0 ? 'delta-up' : 'delta-down' };
}

function renderTiles(m, mp, s, sp) {
    const box = $('tiles');
    box.replaceChildren();
    if (!m) { box.append(el('p', 'text-sm text-graphite', 'Aucun export membres pour ce périmètre.')); return; }
    const tiles = [
        { lbl: 'Sièges actifs, 7 derniers jours', v: m.actifs_7j, p: mp && mp.actifs_7j, sur: m.sieges, det: pct(m.sieges ? m.actifs_7j / m.sieges : 0) + ' des sièges attribués', hero: true },
        { lbl: 'Usagers réguliers', v: m.reguliers, p: mp && mp.reguliers, det: '10 jours actifs ou plus sur 30' },
        { lbl: 'Artefacts créés', v: m.artefacts, p: mp && mp.artefacts, det: 'Chat, Cowork et Claude Code' },
        { lbl: 'Sessions Cowork', v: m.sessions_cowork, p: mp && mp.sessions_cowork, det: fmt(m.utilisateurs_cowork) + ' utilisateurs' },
        { lbl: 'Invocations de skills', v: s ? s.invocations : null, p: sp && sp.invocations, det: s ? fmt(s.skills_distincts) + ' skills distincts' : 'Export skills manquant' },
        { lbl: 'Pull requests', v: m.pull_requests, p: mp && mp.pull_requests, det: fmt(m.utilisateurs_code) + ' utilisateurs de Claude Code' },
    ];
    tiles.forEach((t) => {
        const card = el('div', (t.hero ? 'at-hero' : 'at-card') + ' p-6 flex flex-col gap-1.5');
        card.append(el('span', 'text-sm ' + (t.hero ? 'text-stone' : 'text-graphite'), t.lbl));
        const n = el('span', 'at-num text-5xl', t.v == null ? '—' : fmt(t.v));
        if (t.sur != null) n.append(el('span', 'text-xl ' + (t.hero ? 'text-stone' : 'text-graphite'), ' / ' + fmt(t.sur)));
        card.append(n, el('span', 'text-xs ' + (t.hero ? 'text-stone' : 'text-graphite'), t.det));
        const d = deltaText(t.v, t.p);
        card.append(el('span', 'text-xs mt-2 pt-2 border-t ' + (t.hero ? 'border-graphite text-stone' : 'border-stone ' + d.cls), d.text));
        box.append(card);
    });
}

// ==================== BARRES ====================

function bars(id, rows, opts) {
    const o = opts || {};
    const box = $(id);
    box.replaceChildren();
    if (!rows.length) { box.append(el('p', 'text-sm text-graphite', o.empty || 'Pas de données.')); return; }
    const max = o.max || Math.max(...rows.map((r) => r.v), 1);
    rows.forEach((r) => {
        const row = el('div', 'grid items-center gap-3 text-sm');
        row.style.gridTemplateColumns = 'minmax(7rem, 13rem) minmax(0, 1fr) auto';
        const name = el('span', 'truncate', r.label); name.title = r.label;
        const track = el('div', 'bar-track');
        const fill = el('div', 'bar-fill' + (r.alt ? ' alt' : ''));
        fill.style.width = Math.max(0, Math.min(100, (r.v / max) * 100)) + '%';
        track.append(fill);
        const val = el('span', 'num text-right text-graphite whitespace-nowrap');
        val.append(el('b', 'font-medium text-ink', o.pct ? pct(r.v) : fmt(r.v)));
        if (r.extra) val.append(document.createTextNode(' · ' + r.extra));
        row.append(name, track, val);
        box.append(row);
    });
}

const FEATURE_LABELS = { 'Plugins': 'Plugins', 'MCP servers': 'Serveurs MCP', 'Cloud sessions': 'Sessions cloud', 'Skills': 'Skills', 'Sub-agents': 'Sous-agents', 'Hooks': 'Hooks', 'Plan mode': 'Mode plan' };

function renderProduction(m, f) {
    bars('bars-artefacts', m ? [
        { label: 'Artefacts Cowork', v: m.artefacts_cowork },
        { label: 'Artefacts Chat', v: m.artefacts_chat },
        { label: 'Artefacts Claude Code', v: m.artefacts_code },
    ] : []);
    bars('bars-messages', m ? [
        { label: 'Messages Cowork', v: m.messages_cowork },
        { label: 'Messages Chat', v: m.messages_chat },
    ] : []);
    const adoption = f ? f.adoption.filter((a) => a.actifs > 0) : [];
    const actifs = adoption.length ? Math.max(...adoption.map((a) => a.actifs)) : 0;
    $('feat-hint').textContent = f
        ? `Part des ${fmt(actifs)} utilisateurs actifs du ${dateFr(f.periode && f.periode.debut)} à aujourd'hui`
        : 'Export Claude Code usage manquant';
    bars('bars-feat', adoption.map((a) => ({ label: FEATURE_LABELS[a.fonction] || a.fonction, v: a.part, extra: fmt(a.utilisateurs) + ' util.' })), { pct: true, max: 1 });
}

function renderSkills(s) {
    const note = $('skills-note');
    const split = $('skills-split');
    split.replaceChildren();
    if (!s) {
        note.textContent = 'Export skills manquant pour ce périmètre.';
        bars('bars-skills', []);
        $('skills-split-legend').textContent = '';
        return;
    }
    const prives = s.skills_distincts - s.skills_nommes;
    note.textContent = `${fmt(s.skills_distincts)} skills distincts sur 30 jours, dont ${fmt(prives)} skills privés que l'export ne nomme pas.`;
    bars('bars-skills', s.top.slice(0, 10).map((k) => ({ label: k.nom, v: k.invocations, alt: k.origine === 'anthropic', extra: k.utilisateurs + ' util.' })));
    const pa = s.invocations ? s.invocations_anthropic / s.invocations : 0;
    const a = el('div'); a.style.cssText = `width:${(1 - pa) * 100}%;background:#1A1A1A`;
    const b = el('div'); b.style.cssText = `width:${pa * 100}%;background:#B6B9AD`;
    split.append(a, b);
    split.setAttribute('aria-label', `Invocations : ${pct(1 - pa)} skills maison, ${pct(pa)} skills Anthropic`);
    $('skills-split-legend').textContent = `Invocations : ${pct(1 - pa)} skills maison (${fmt(s.invocations - s.invocations_anthropic)}) · ${pct(pa)} skills Anthropic (${fmt(s.invocations_anthropic)})`;
}

// ==================== TABLEAUX ====================

// Couleurs de filiale de shared/analyztech-theme.css (.at-fil-*).
const FIL = { 'BTP Consultants': '#62B5E5', 'Citae': '#78BE20', 'BTP Diagnostics': '#01021D' };

function table(id, head, rows) {
    const t = $(id);
    t.replaceChildren();
    const hr = t.createTHead().insertRow();
    head.forEach(([label, right]) => {
        const th = el('th', 'py-2 px-3 font-medium text-graphite border-b border-stone whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), label);
        hr.append(th);
    });
    const tb = t.createTBody();
    rows.forEach((cells) => {
        const tr = tb.insertRow();
        cells.forEach((c, i) => {
            const td = tr.insertCell();
            td.className = 'py-2 px-3 border-b border-off whitespace-nowrap ' + (head[i][1] ? 'text-right' : '');
            if (c instanceof Node) td.append(c); else td.textContent = c;
        });
    });
}

function renderEntites(m) {
    const ents = m ? Object.entries(m.entites || {}).sort((a, b) => b[1].messages - a[1].messages) : [];
    table('t-ent', [['Entité'], ['Sièges', 1], ['Messages / siège', 1], ['Artefacts / siège', 1], ['Jours actifs moyens', 1]],
        ents.map(([nom, e]) => {
            const cell = el('span', 'inline-flex items-center gap-2.5');
            const fil = el('i', 'inline-block w-1 h-4 rounded-sm');
            fil.style.background = FIL[nom] || '#DADACF';
            cell.append(fil, document.createTextNode(nom));
            return [cell, fmt(e.sieges), fmt(e.sieges ? e.messages / e.sieges : 0), dec(e.sieges ? e.artefacts / e.sieges : 0), dec(e.sieges ? e.jours / e.sieges : 0)];
        }));
}

function renderTop(m) {
    const users = m ? m.top_utilisateurs || [] : [];
    $('top-note').textContent = m
        ? `Messages Chat et Cowork sur 30 jours. Ces 20 comptes portent ${pct(m.part_top20)} des messages. Les sessions Claude Code ne comptent pas comme des messages.`
        : 'Aucun export membres pour ce périmètre.';
    table('t-top', [['Rang', 1], ['Nom'], ['Entité'], ['Siège'], ['Messages', 1], ['Jours actifs', 1], ['Sessions Code', 1]],
        users.map((u, i) => [fmt(i + 1), u.nom, u.entite, u.siege === 'Premium' ? 'Premium' : 'Standard', fmt(u.messages), fmt(u.jours), fmt(u.sessions_code)]));
}

// ==================== ÉVOLUTION ====================

function renderEvolution() {
    const actifs = KPIClaude.series(kpis, team, 'actifs_7j');
    const artefacts = KPIClaude.series(kpis, team, 'artefacts');
    const enough = actifs.length >= 2;
    $('evolution-empty').classList.toggle('hidden', enough);
    $('evolution-box').classList.toggle('hidden', !enough);
    if (evolutionChart) { evolutionChart.destroy(); evolutionChart = null; }
    if (!enough) return;
    evolutionChart = new Chart($('evolution-chart'), {
        type: 'line',
        data: {
            labels: actifs.map((p) => dateFr(p.date)),
            datasets: [
                { label: 'Sièges actifs (7 j)', data: actifs.map((p) => p.value), yAxisID: 'y', tension: 0, pointRadius: 3 },
                { label: 'Artefacts créés (30 j)', data: artefacts.map((p) => p.value), yAxisID: 'y1', tension: 0, pointRadius: 3 },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'bottom' } },
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Sièges actifs' } },
                y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Artefacts' } },
            },
        },
    });
}

// ==================== RENDU ====================

function renderAll() {
    document.querySelectorAll('#team-tabs [data-team]').forEach((b) => {
        const on = b.dataset.team === team;
        b.classList.toggle('seg-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const m = KPIClaude.view(kpis, team, 'membres');
    const s = KPIClaude.view(kpis, team, 'skills');
    const f = KPIClaude.view(kpis, team, 'fonctionnalites');
    const p = m.cur && m.cur.periode;
    $('periodes').textContent = `${KPIClaude.LABELS[team]} · dernier export du ${dateFr(m.date || s.date || f.date)}`
        + (p ? ` · membres du ${dateFr(p.debut)} au ${dateFr(p.fin)}` : '');
    renderTiles(m.cur, m.prev, s.cur, s.prev);
    renderEvolution();
    renderProduction(m.cur, f.cur);
    renderSkills(s.cur);
    renderEntites(m.cur);
    renderTop(m.cur);
}

document.querySelectorAll('#team-tabs [data-team]').forEach((b) => {
    b.addEventListener('click', () => {
        team = b.dataset.team;
        try { localStorage.setItem(TEAM_KEY, team); } catch (e) { /* stockage indisponible */ }
        renderAll();
    });
});

function showError(message) {
    $('loading').classList.add('hidden');
    $('main-content').classList.add('hidden');
    $('error-message').textContent = message;
    $('error').classList.remove('hidden');
}

async function init() {
    try {
        // URLs SIGNÉES (12 h), jamais mises en cache.
        const urls = await KPI.fetchDataUrls();
        if (!urls) return; // redirigé vers index.html
        if (!urls.CLAUDE_KPIS_URL) {
            showError("Le webhook n'expose pas encore CLAUDE_KPIS_URL : ajouter claude_kpis.json au nœud « Sign URLs » et au mapping du nœud « Build signed response » (workflow ROI Global).");
            return;
        }
        const r = await fetch(urls.CLAUDE_KPIS_URL);
        if (!r.ok) { showError(`claude_kpis.json illisible (HTTP ${r.status}). Le premier export n'a peut-être pas encore été déposé.`); return; }
        kpis = await r.json();
        const teams = KPIClaude.teamsAvailable(kpis);
        if (teams.length === 0) { showError('claude_kpis.json ne contient encore aucun relevé.'); return; }
        // Onglets des Teams absentes du fichier masqués ; « tous » seulement s'il y a deux Teams.
        document.querySelectorAll('#team-tabs [data-team]').forEach((b) => {
            const t = b.dataset.team;
            b.hidden = t === 'tous' ? teams.length < 2 : !teams.includes(t);
        });
        let saved = null;
        try { saved = localStorage.getItem(TEAM_KEY); } catch (e) { /* stockage indisponible */ }
        team = (saved === 'tous' && teams.length > 1) || teams.includes(saved) ? saved : (teams.length > 1 ? 'tous' : teams[0]);
        $('loading').classList.add('hidden');
        $('main-content').classList.remove('hidden');
        renderAll();
    } catch (e) {
        console.error(e);
        showError('Erreur au chargement des indicateurs Claude : ' + e.message);
    }
}

init();
