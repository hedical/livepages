// ============================================================================
// Appropriation de l'IA par agence — BTP Consultants, contrôle technique.
//
// Taux d'appropriation = collaborateurs de l'agence avec une note d'adoption
// ≥ 60 (profil Régulier ou Adopté) ÷ effectif de la population cible, sur les
// N derniers mois (6 par défaut). Même lecture des sources (shared/sources.js)
// et même calcul (shared/adoption.js) que la popup Utilisateurs de index :
// les chiffres sont identiques.
//
// Accès : mot de passe agences (webhook passwordadoption) ou mot de passe du
// tableau de bord (passwordROI). Les données se mettent à jour quand n8n
// régénère les fichiers (ROI Global, planification quotidienne).
// ============================================================================

const WEBHOOKS = [
    'https://databuildr.app.n8n.cloud/webhook/passwordadoption',
    KPI.WEBHOOK_URL,
];
const STORE_KEY = 'adoption_password';
const SMALL_AGENCY = 5; // en dessous, une personne fait basculer le taux

const loginModal = document.getElementById('login-modal');
const loginForm = document.getElementById('login-form');
const passwordInput = document.getElementById('password-input');
const loginButton = document.getElementById('login-button');
const loginText = document.getElementById('login-text');
const loginError = document.getElementById('login-error');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const mainEl = document.getElementById('main-content');

let urls = null;
let data = null;        // items parsés par source
let population = [];    // [{dr, agencyCode, effectif}]
let state = { months: 6, dr: '', search: '', sort: { key: 'taux', asc: false } };

// Profils dans l'ordre de lecture, mêmes couleurs que la popup Utilisateurs
// (index) ; « Sans usage » = effectif sans aucune session sur la période.
const PROFILES = [
    { key: 'Adopté',      label: 'Adopté',      short: 'adopté(s)',      color: '#059669', range: '80-100' },
    { key: 'Régulier',    label: 'Régulier',    short: 'régulier(s)',    color: '#6366f1', range: '60-79' },
    { key: 'Occasionnel', label: 'Occasionnel', short: 'occasionnel(s)', color: '#f59e0b', range: '40-59' },
    { key: 'Découverte',  label: 'Découverte',  short: 'découverte',     color: '#9ca3af', range: '0-39' },
    { key: 'sansUsage',   label: 'Sans usage',  short: 'sans usage',     color: '#EDEAE0', range: '' },
];
const LEVEL_BADGE = {
    'Adopté':      'bg-emerald-100 text-emerald-800',
    'Régulier':    'bg-indigo-100 text-indigo-800',
    'Occasionnel': 'bg-amber-100 text-amber-800',
    'Découverte':  'bg-gray-100 text-gray-600',
};

const fmtDate = d =>d ? new Intl.DateTimeFormat('fr-FR').format(d) : '—';
const pct = v => v === null || v === undefined ? '—' : Math.round(v * 100) + ' %';
const esc = KPI.escapeHtml;

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
        if (urls) { await load(); return; }
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
        await load();
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
document.getElementById('retry-btn').addEventListener('click', () => load());

// ==================== DONNÉES ====================

async function fetchText(url, required) {
    if (!url) {
        if (required) throw new Error('Lien de données manquant');
        return '';
    }
    const r = await fetch(url);
    if (!r.ok) {
        if (required) throw new Error(`Chargement impossible (${r.status})`);
        console.warn('Source indisponible :', r.status, url);
        return '';
    }
    return r.text();
}

async function load() {
    loadingEl.classList.remove('hidden');
    errorEl.classList.add('hidden');
    mainEl.classList.add('hidden');
    try {
        const [pop, desc, auto, comp, geo, acou, cctp, expert, chat] = await Promise.all([
            fetchText(urls.POPULATION_CIBLE_URL, true),
            fetchText(urls.DESCRIPTIF_URL, true),
            fetchText(urls.AUTOCONTACT_URL, true),
            fetchText(urls.COMPARATEUR_URL, true),
            fetchText(urls.GEOTECH_URL, false),
            fetchText(urls.ANALYSE_ACOUSTIQUE_URL, false),
            fetchText(urls.ANALYSE_CCTP_URL, false),
            fetchText(urls.EXPERT_BTP_URL, false),
            fetchText(urls.CHAT_BTP_URL, false),
        ]);
        population = parsePopulationRows(pop);
        const json = text => { try { return JSON.parse(text); } catch (_) { return []; } };
        data = {
            descriptif: decodeTabularPayload(desc, parseDescriptifJSON, parseDescriptifCSV),
            autocontact: decodeTabularPayload(auto, parseAutocontactJSON, parseAutocontactCSV),
            comparateur: decodeTabularPayload(comp, parseComparateurJSON, parseComparateurCSV),
            geotech: decodeTabularPayload(geo, parseGeotechJSON, parseGeotechCSV),
            acoustique: decodeTabularPayload(acou, parseAcoustiqueJSON, parseAcoustiqueCSV),
            cctp: KPI.parseCctpPayload(cctp),
            expertCT: parseChatSessions(json(expert)),
            chatCT: parseChatSessions(json(chat)),
        };
        // Comme loadData (app.js) : le type ne filtre que s'il est renseigné.
        descriptifTypePresent = data.descriptif.some(item => item.type && item.type.trim() !== '');

        const drs = [...new Set(population.map(p => p.dr).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
        document.getElementById('dr-filter').innerHTML = '<option value="">Toutes</option>'
            + drs.map(dr => `<option value="${esc(dr)}">${esc(dr)}</option>`).join('');

        loadingEl.classList.add('hidden');
        mainEl.classList.remove('hidden');
        render();
    } catch (e) {
        console.error(e);
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
        document.getElementById('error-message').textContent = 'Les données n\'ont pas pu être chargées : ' + e.message + '.';
    }
}

// ==================== CALCUL ====================

function compute(months) {
    const modules = KPIAdoption.catalogue(data, { isDescriptifRow, isNFHabitatItem });
    // Date de référence = dernier usage observé ; la période remonte de N mois.
    const ref = KPIAdoption.collect(modules, { start: null, end: null }).refDate;
    const period = KPIAdoption.lastMonths(ref, months);
    const result = KPIAdoption.collect(modules, period);
    return { ref, period, ...KPIAdoption.agencyAppropriation(result.users, population) };
}

// ==================== AFFICHAGE ====================

function render() {
    const r = compute(state.months);
    document.getElementById('period-badge').textContent = `${state.months} derniers mois : du ${fmtDate(r.period.start)} au ${fmtDate(r.period.end)}`;
    document.getElementById('ref-badge').textContent = `Données au ${fmtDate(r.ref)}`;

    const zero = r.rows.filter(x => x.taux === 0).length;
    const tile = (label, value, sub) => `<div class="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
        <p class="text-xs text-gray-500">${label}</p>
        <p class="text-3xl font-semibold text-gray-900 tabular mt-1">${value}</p>
        <p class="text-xs text-gray-400 mt-1">${sub}</p></div>`;
    document.getElementById('tiles').innerHTML =
        tile('Médiane des agences', pct(r.medianTaux), `sur ${r.rows.length} agences CT`)
        + tile('Ensemble des agences', pct(r.totals.taux), `${r.totals.appropries} collaborateurs sur ${r.totals.effectif}`)
        + tile('Agences à 0 %', String(zero), 'aucun collaborateur au profil Régulier ou Adopté');

    const search = state.search.trim().toUpperCase();
    const rows = r.rows
        .filter(x => (!state.dr || x.dr === state.dr) && (!search || x.agency.includes(search)))
        .sort((a, b) => {
            const k = state.sort.key, dir = state.sort.asc ? 1 : -1;
            const va = a[k], vb = b[k];
            if (va === null || va === undefined) return 1;
            if (vb === null || vb === undefined) return -1;
            const cmp = typeof va === 'string' ? va.localeCompare(vb, 'fr') : va - vb;
            return cmp * dir || a.agency.localeCompare(b.agency);
        });

    document.getElementById('profile-legend').innerHTML = '<span class="font-medium text-gray-700">Profils :</span>'
        + PROFILES.map(p => `<span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm" style="background:${p.color}"></span>${p.label}${p.range ? ` <span class="text-gray-400">${p.range}</span>` : ''}</span>`).join('');

    document.getElementById('table-body').innerHTML = rows.map(x => {
        const small = x.effectif < SMALL_AGENCY;
        const above = x.taux !== null && x.taux > r.medianTaux;
        // Taux mis en avant : pastille pleine au-dessus de la médiane des agences.
        const tauxPill = x.taux === null ? '—'
            : `<span class="inline-flex items-center px-3 py-1 rounded-full text-base font-bold tabular ${above ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-900'}"
                     title="${above ? 'Au-dessus' : 'À la médiane ou en dessous'} de la médiane des agences (${pct(r.medianTaux)})">${pct(x.taux)}</span>`;
        // Effectif découpé par profil ; les collaborateurs sans usage en fin de barre.
        const total = Math.max(x.effectif, x.actifs) || 1;
        const counts = PROFILES.map(p => ({ p, n: p.key === 'sansUsage' ? x.sansUsage : (x.levels[p.key] || 0) }));
        const bar = counts.filter(c => c.n > 0).map(c =>
            `<div style="width:${c.n / total * 100}%;background:${c.p.color}" title="${c.p.label} : ${c.n}"></div>`).join('');
        const detail = counts.filter(c => c.n > 0).map(c => `${c.n} ${c.p.short}`).join(' · ');
        const medianBadge = x.mediane === null ? '<span class="text-gray-400">—</span>'
            : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-semibold ${LEVEL_BADGE[x.niveauMediane] || 'bg-gray-100 text-gray-700'}">
                   <span class="tabular">${x.mediane}</span><span class="font-normal text-xs">${esc(x.niveauMediane)}</span></span>`;
        return `<tr class="hover:bg-indigo-50/30">
            <td class="px-4 py-3 font-mono font-medium text-indigo-700">${esc(x.agency)}</td>
            <td class="px-4 py-3 text-gray-600">${esc(x.dr)}</td>
            <td class="px-4 py-3 whitespace-nowrap">
                <div class="flex items-center gap-3">
                    ${tauxPill}
                    <span class="tabular text-xs text-gray-500">${x.appropries} sur ${x.effectif}${small ? '<br>effectif < 5' : ''}</span>
                </div>
            </td>
            <td class="px-4 py-3">
                <div class="flex gap-[2px] h-2.5 w-44 rounded-full overflow-hidden bg-gray-100">${bar}</div>
                <p class="mt-1 text-xs text-gray-500 tabular">${detail || 'aucun collaborateur'}</p>
            </td>
            <td class="px-4 py-3 text-right whitespace-nowrap">${medianBadge}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">Aucune agence ne correspond.</td></tr>';

    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.textContent = th.textContent.replace(/ [↑↓]$/, '');
        if (th.dataset.sort === state.sort.key) th.textContent += state.sort.asc ? ' ↑' : ' ↓';
    });

    const h = r.horsPopulation;
    document.getElementById('table-note').textContent =
        `Effectif : population cible du tableau de bord, par agence, sans distinction de poste. `
        + `Chaque utilisateur est rattaché à l'agence où il a le plus de sessions. `
        + (h.utilisateurs ? `${h.utilisateurs} utilisateur(s) rattaché(s) à un code absent de la population cible ne comptent dans aucune agence.` : '');
}

document.getElementById('dr-filter').addEventListener('change', e => { state.dr = e.target.value; render(); });
document.getElementById('period-select').addEventListener('change', e => { state.months = parseInt(e.target.value, 10); render(); });
document.getElementById('search').addEventListener('input', e => { state.search = e.target.value; render(); });
document.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const key = th.dataset.sort;
    state.sort = { key, asc: state.sort.key === key ? !state.sort.asc : (key === 'agency' || key === 'dr') };
    render();
}));

start();
