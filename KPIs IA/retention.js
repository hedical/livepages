// ==================== CONFIG ====================
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordROI';
const EXPERT_BTP_URL    = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_btpconsultants_ct.json';
const CHAT_BTP_URL      = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_btpconsultants_ct.json';
const EXPERT_CITAE_URL  = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_citae.json';
const CHAT_CITAE_URL    = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_citae.json';
const EXPERT_BTPDIAG_URL= 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/expert_btpdiagnostics.json';
const CHAT_BTPDIAG_URL  = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/chat_btpdiagnostics.json';

const DAY = 24 * 3600 * 1000;
const HISTORY_START = new Date('2025-01-01').getTime();
// Type des "vrais" descriptifs IA. Les lignes au type vide (RICT sans génération
// IA, hasAi=false) ne sont PAS des usages et ne doivent pas compter en rétention.
const DESCRIPTIF_TYPE = 'DESCRIPTIF_SOMMAIRE_DES_TRAVAUX';
// Mise en place effective du module Analyse AO (UTC minuit) : les marchés détectés
// avant cette date (test / backfill) ne comptent pas. Cf. app.js / analyse-ao.js.
const AO_MODULE_START = new Date('2026-06-06');

const loadingEl = document.getElementById('loading');
const errorEl   = document.getElementById('error');
const mainEl    = document.getElementById('main-content');
const loadingTextEl = document.getElementById('loading-text');
const errorMsgEl    = document.getElementById('error-message');

// ==================== UTILITIES ====================
function showError(msg) {
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    errorMsgEl.textContent = msg;
}

function parseDate(s) {
    if (!s) return null;
    const d = new Date(typeof s === 'string' ? s.replace(/\\/g, '') : s);
    return isNaN(d.getTime()) ? null : d;
}

function formatPct(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return (v * 100).toFixed(1) + '%';
}

function monthKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function monthLabel(key) {
    const [y, m] = key.split('-');
    const months = ['Jan','Fév','Mars','Avr','Mai','Juin','Juil','Août','Sept','Oct','Nov','Déc'];
    return `${months[parseInt(m)-1]} ${y}`;
}

// ==================== CSV PARSER (light) ====================
function parseCSVLine(line) {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        const n = line[i+1];
        if (c === '"') {
            if (q && n === '"') { cur += '"'; i++; }
            else q = !q;
        } else if (c === ',' && !q) {
            out.push(cur); cur = '';
        } else {
            cur += c;
        }
    }
    out.push(cur);
    return out;
}

// Detect column index by lowercase substring match (priority = pattern order)
function findIdx(headers, ...patterns) {
    for (const pat of patterns) {
        for (let i = 0; i < headers.length; i++) {
            const h = headers[i].toLowerCase();
            let ok = true;
            for (const sub of pat) {
                if (sub.startsWith('!')) {
                    if (h.includes(sub.substring(1))) { ok = false; break; }
                } else {
                    if (!h.includes(sub)) { ok = false; break; }
                }
            }
            if (ok) return i;
        }
    }
    return -1;
}

// Like findIdx but returns the matching KEY name (for JSON objects). null if none.
function findKey(keys, ...patterns) {
    for (const pat of patterns) {
        for (const k of keys) {
            const lk = k.toLowerCase();
            let ok = true;
            for (const sub of pat) {
                if (sub.startsWith('!')) { if (lk.includes(sub.substring(1))) { ok = false; break; } }
                else if (!lk.includes(sub)) { ok = false; break; }
            }
            if (ok) return k;
        }
    }
    return null;
}

// ==================== EVENT EXTRACTION ====================
// Each source returns an array of { email, date } events.

function extractCSVEvents(csvText, datePatterns, opts = {}) {
    const { typeMatch, truthyPatterns } = opts;
    if (!csvText) return [];
    const lines = csvText.split('\n').filter(l => l.trim() !== '');
    if (lines.length < 2) return [];
    const headers = parseCSVLine(lines[0]);
    const emailIdx = findIdx(headers, ['user','email']);
    const dateIdx  = findIdx(headers, ...datePatterns);
    if (emailIdx === -1 || dateIdx === -1) {
        console.warn('Missing email/date column. Headers sample:', headers.slice(0, 8));
        return [];
    }
    // Filtre de type optionnel (ex. descriptif : ne garder que AIDeliverable_type = DESCRIPTIF_TYPE)
    const typeIdx = typeMatch ? findIdx(headers, ['aideliver','type'], ['reporttype'], ['report','type','!diffusedat']) : -1;
    // Filtre booléen optionnel (ex. autocontact : ne garder que fromAI = true)
    const boolIdx = truthyPatterns ? findIdx(headers, ...truthyPatterns) : -1;
    if (truthyPatterns && boolIdx === -1) console.warn('Truthy column not found, no filter applied. Headers:', headers.slice(0, 8));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const vals = parseCSVLine(lines[i]);
        if (vals.length < 2) continue;
        rows.push(vals);
    }
    // Garde-fou : si aucune ligne n'a de type renseigné, on ne filtre pas (query déjà filtrée en amont).
    const anyHasType = typeIdx !== -1 && rows.some(v => (v[typeIdx] || '').trim() !== '');
    const events = [];
    rows.forEach(vals => {
        if (typeMatch && anyHasType && !(vals[typeIdx] || '').includes(typeMatch)) return;
        if (boolIdx !== -1 && (vals[boolIdx] || '').trim().toLowerCase() !== 'true') return;
        const email = (vals[emailIdx] || '').trim().toLowerCase();
        const d = parseDate(vals[dateIdx]);
        if (email && d) events.push({ email, date: d });
    });
    return events;
}

function extractJSONArrayEvents(arr, datePatterns, opts = {}) {
    const { typeMatch, truthyPatterns } = opts;
    if (!Array.isArray(arr) || arr.length === 0) return [];
    const keys = Object.keys(arr[0]);
    const kEmail = (function(){
        for (const k of keys) {
            const lk = k.toLowerCase();
            if (lk.includes('user') && lk.includes('email')) return k;
        }
        return null;
    })();
    const kDate = (function(){
        for (const pat of datePatterns) {
            for (const k of keys) {
                const lk = k.toLowerCase();
                let ok = true;
                for (const sub of pat) {
                    if (sub.startsWith('!')) { if (lk.includes(sub.substring(1))) { ok=false; break; } }
                    else if (!lk.includes(sub)) { ok=false; break; }
                }
                if (ok) return k;
            }
        }
        return null;
    })();
    if (!kEmail || !kDate) {
        console.warn('Missing email/date keys. Sample keys:', keys.slice(0, 8));
        return [];
    }
    // Clé de type optionnelle pour filtrer (ex. descriptif : AIDeliverable_type)
    const kType = typeMatch ? findKey(keys, ['aideliver','type'], ['reporttype'], ['report','type','!diffusedat']) : null;
    // Clé booléenne optionnelle (ex. autocontact : fromAI)
    const kBool = truthyPatterns ? findKey(keys, ...truthyPatterns) : null;
    if (truthyPatterns && !kBool) console.warn('Truthy key not found, no filter applied. Keys:', keys.slice(0, 8));
    // Garde-fou : si aucune ligne n'a de type renseigné, on ne filtre pas.
    const anyHasType = kType ? arr.some(it => ((it[kType] || '') + '').trim() !== '') : false;
    const events = [];
    arr.forEach(item => {
        if (typeMatch && anyHasType && !((item[kType] || '') + '').includes(typeMatch)) return;
        if (kBool) { const v = item[kBool]; if (!(v === true || v === 'true' || v === 'TRUE')) return; }
        const email = ((item[kEmail] || '') + '').trim().toLowerCase();
        const d = parseDate(item[kDate]);
        if (email && d) events.push({ email, date: d });
    });
    return events;
}

// Generic file → events (handles legacy CSV-in-JSON + new direct JSON)
function eventsFromMixedFile(rawText, datePatterns, opts) {
    let csv = null;
    try {
        const j = JSON.parse(rawText);
        if (Array.isArray(j) && j.length > 0 && j[0].data && typeof j[0].data === 'string') {
            csv = j[0].data;
        } else if (Array.isArray(j) && j.length > 0) {
            return extractJSONArrayEvents(j, datePatterns, opts);
        }
    } catch(e) {}
    if (!csv && rawText.includes('{data:')) {
        const s = rawText.indexOf('{data:') + 6;
        const e = rawText.lastIndexOf('}');
        if (s < e) csv = rawText.substring(s, e).trim();
    }
    if (!csv) csv = rawText;
    // Clean wrapping
    csv = csv.trim();
    while (csv.startsWith('[') || csv.startsWith('{')) csv = csv.substring(1).trim();
    while (csv.endsWith(']') || csv.endsWith('}')) csv = csv.substring(0, csv.length - 1).trim();
    return extractCSVEvents(csv, datePatterns, opts);
}

// Analyse AO : payload {count, data:[{dateDetection, leads:[{ownerName, dateCreation, ...}]}]}.
// Les leads n'ont pas d'email → on identifie l'utilisateur par ownerName.
// Floor de mise en place : on ignore les marchés détectés avant le go-live (cf. AO_MODULE_START).
function eventsFromAO(rawText) {
    let payload;
    try { payload = JSON.parse(rawText); } catch(e) { return []; }
    if (!payload || !Array.isArray(payload.data)) return [];
    const events = [];
    payload.data.forEach(m => {
        const det = parseDate(m.dateDetection);
        if (det && det < AO_MODULE_START) return; // marché détecté avant le go-live → ignoré
        (Array.isArray(m.leads) ? m.leads : []).forEach(l => {
            const owner = ((l.ownerName || '') + '').trim().toLowerCase();
            const d = parseDate(l.dateCreation);
            if (owner && d) events.push({ email: owner, date: d });
        });
    });
    return events;
}

// Chat/Expert JSON dumps from BTP S+ — direct array of {email, createdAt}
function eventsFromChatExpert(rawText) {
    try {
        const j = JSON.parse(rawText);
        if (!Array.isArray(j)) return [];
        const events = [];
        j.forEach(item => {
            const email = ((item.email || (item.metadata && item.metadata.email) || '') + '').trim().toLowerCase();
            const d = parseDate(item.createdAt);
            if (email && d) events.push({ email, date: d });
        });
        return events;
    } catch(e) {
        return [];
    }
}

// ==================== AUTH + FETCH ====================
async function loadAllData() {
    const password = localStorage.getItem('roi_password');
    if (!password) {
        window.location.href = 'index.html';
        return null;
    }

    loadingTextEl.textContent = 'Authentification…';
    let urls;
    try {
        const r = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: password
        });
        if (!r.ok) {
            localStorage.removeItem('roi_password');
            window.location.href = 'index.html';
            return null;
        }
        const body = await r.text();
        urls = {
            DESCRIPTIF:   (body.match(/DESCRIPTIF_URL = '([^']+)'/)   || [])[1],
            AUTOCONTACT:  (body.match(/AUTOCONTACT_URL = '([^']+)'/)  || [])[1],
            COMPARATEUR:  (body.match(/COMPARATEUR_URL = '([^']+)'/)  || [])[1],
            ANALYSE_AO:   (body.match(/ANALYSE_AO_URL = '([^']+)'/)   || [])[1]
        };
    } catch(e) {
        showError('Échec authentification webhook : ' + e.message);
        return null;
    }

    loadingTextEl.textContent = 'Chargement des données IA (9 sources en parallèle)…';

    const fetchText = url => url
        ? fetch(url).then(r => r.ok ? r.text() : '').catch(() => '')
        : Promise.resolve('');

    const [
        descRaw, autoRaw, compRaw, aoRaw,
        expBtpRaw, chatBtpRaw,
        expCitaeRaw, chatCitaeRaw,
        expBtpDiagRaw, chatBtpDiagRaw
    ] = await Promise.all([
        fetchText(urls.DESCRIPTIF),
        fetchText(urls.AUTOCONTACT),
        fetchText(urls.COMPARATEUR),
        fetchText(urls.ANALYSE_AO),
        fetchText(EXPERT_BTP_URL),
        fetchText(CHAT_BTP_URL),
        fetchText(EXPERT_CITAE_URL),
        fetchText(CHAT_CITAE_URL),
        fetchText(EXPERT_BTPDIAG_URL),
        fetchText(CHAT_BTPDIAG_URL)
    ]);

    loadingTextEl.textContent = 'Parsing et agrégation…';

    const events = [];
    // Descriptif: date = Report__diffusedAt ; ne compter que les vraies générations IA (AIDeliverable_type)
    events.push(...eventsFromMixedFile(descRaw, [['report','diffusedat'], ['diffusedat'], ['createdat']], { typeMatch: DESCRIPTIF_TYPE }).map(e => ({...e, feature: 'descriptif'})));
    // Autocontact: date = Contact → CreatedAt or createdat ; ne compter que les contacts générés par IA (fromAI)
    events.push(...eventsFromMixedFile(autoRaw, [['contact','createdat'], ['createdat'], ['created_at']], { truthyPatterns: [['fromai'], ['from_ai']] }).map(e => ({...e, feature: 'autocontact'})));
    // Comparateur: date = AIDeliverable → CreatedAt or createdat
    events.push(...eventsFromMixedFile(compRaw, [['aideliverable','createdat'], ['createdat'], ['created_at']]).map(e => ({...e, feature: 'comparateur'})));
    // Analyse AO: 1 événement par lead (date = lead.dateCreation, utilisateur = ownerName)
    events.push(...eventsFromAO(aoRaw).map(e => ({...e, feature: 'analyse-ao'})));
    // Chat/Expert
    events.push(...eventsFromChatExpert(expBtpRaw).map(e => ({...e, feature: 'expert-btp'})));
    events.push(...eventsFromChatExpert(chatBtpRaw).map(e => ({...e, feature: 'chat-btp'})));
    events.push(...eventsFromChatExpert(expCitaeRaw).map(e => ({...e, feature: 'expert-citae'})));
    events.push(...eventsFromChatExpert(chatCitaeRaw).map(e => ({...e, feature: 'chat-citae'})));
    events.push(...eventsFromChatExpert(expBtpDiagRaw).map(e => ({...e, feature: 'expert-btpdiag'})));
    events.push(...eventsFromChatExpert(chatBtpDiagRaw).map(e => ({...e, feature: 'chat-btpdiag'})));

    // Filter by global history start
    const filtered = events.filter(e => e.date.getTime() >= HISTORY_START);
    console.log('Total events loaded:', events.length, '/ since 2025-01-01:', filtered.length);

    return filtered;
}

// ==================== ANALYTICS ====================
function computeUserStats(events) {
    // Group events by user
    const byUser = new Map();
    events.forEach(e => {
        if (!byUser.has(e.email)) byUser.set(e.email, []);
        byUser.get(e.email).push(e);
    });
    // Sort each user's events by date
    byUser.forEach(arr => arr.sort((a,b) => a.date - b.date));

    const stats = [];
    byUser.forEach((evts, email) => {
        const firstDate = evts[0].date;
        const lastDate  = evts[evts.length-1].date;
        stats.push({
            email,
            firstDate,
            lastDate,
            totalEvents: evts.length,
            events: evts
        });
    });
    return stats;
}

function computeKPIs(stats) {
    const now = Date.now();
    const cutoff30 = now - 30 * DAY;

    // KPI 1: Active users last 30 days
    const active30 = stats.filter(u => u.lastDate.getTime() >= cutoff30).length;
    const totalUsers = stats.length;

    // KPI 2: Activation J+7 — among users whose first event was 7-30 days ago,
    // % who had ≥2 events within 7 days of first event.
    const activationPool = stats.filter(u => {
        const dt = now - u.firstDate.getTime();
        return dt >= 7 * DAY && dt <= 30 * DAY;
    });
    const activated = activationPool.filter(u => {
        const cutoff = u.firstDate.getTime() + 7 * DAY;
        const eventsIn7 = u.events.filter(e => e.date.getTime() <= cutoff).length;
        return eventsIn7 >= 2;
    });

    // KPI 3: Retention Day 30 — users whose first event was >30 days ago,
    // % with at least one event in [first+25, first+35].
    const retentionPool = stats.filter(u => {
        return now - u.firstDate.getTime() >= 30 * DAY;
    });
    const retained = retentionPool.filter(u => {
        const w0 = u.firstDate.getTime() + 25 * DAY;
        const w1 = u.firstDate.getTime() + 35 * DAY;
        return u.events.some(e => e.date.getTime() >= w0 && e.date.getTime() <= w1);
    });

    return {
        totalUsers,
        active30,
        activePct: totalUsers ? active30 / totalUsers : null,
        activationPoolSize: activationPool.length,
        activatedSize: activated.length,
        activationPct: activationPool.length ? activated.length / activationPool.length : null,
        retentionPoolSize: retentionPool.length,
        retainedSize: retained.length,
        retentionPct: retentionPool.length ? retained.length / retentionPool.length : null
    };
}

// Cohort retention by signup month: %actifs at J0/J7/J14/J30
function computeCohortRetention(stats) {
    const cohorts = new Map(); // monthKey → [{user, firstDate}, ...]
    stats.forEach(u => {
        const k = monthKey(u.firstDate);
        if (!cohorts.has(k)) cohorts.set(k, []);
        cohorts.get(k).push(u);
    });

    const keys = [...cohorts.keys()].sort();
    const result = keys
        .filter(k => cohorts.get(k).length >= 5) // ignore cohorts too small
        .map(k => {
            const users = cohorts.get(k);
            const milestones = [0, 7, 14, 30];
            const data = milestones.map(d => {
                const window0 = d === 0 ? -1 : (d - 3);
                const window1 = d === 0 ? 1 : (d + 3);
                const stillActive = users.filter(u => {
                    const t0 = u.firstDate.getTime() + window0 * DAY;
                    const t1 = u.firstDate.getTime() + window1 * DAY;
                    return u.events.some(e => e.date.getTime() >= t0 && e.date.getTime() <= t1);
                });
                return users.length ? (stillActive.length / users.length) * 100 : 0;
            });
            return { monthKey: k, label: monthLabel(k), size: users.length, data };
        });

    return result;
}

// Activation per month: % activated (≥2 events in 7j) vs not
function computeActivationByMonth(stats) {
    const cohorts = new Map();
    stats.forEach(u => {
        const k = monthKey(u.firstDate);
        if (!cohorts.has(k)) cohorts.set(k, []);
        cohorts.get(k).push(u);
    });

    const keys = [...cohorts.keys()].sort();
    return keys.map(k => {
        const users = cohorts.get(k);
        const activated = users.filter(u => {
            const cutoff = u.firstDate.getTime() + 7 * DAY;
            return u.events.filter(e => e.date.getTime() <= cutoff).length >= 2;
        }).length;
        return {
            monthKey: k,
            label: monthLabel(k),
            activated,
            notActivated: users.length - activated,
            total: users.length,
            activatedPct: users.length ? (activated / users.length) * 100 : 0
        };
    });
}

// Segmentation: Champions / Engagés / À risque / Fantômes
// Returns counts AND the lists of users per segment.
function computeSegmentation(stats) {
    const now = Date.now();
    const buckets = { champions: [], engages: [], aRisque: [], fantomes: [] };
    stats.forEach(u => {
        const inactiveDays = (now - u.lastDate.getTime()) / DAY;
        const enriched = {
            email: u.email,
            totalEvents: u.totalEvents,
            lastDate: u.lastDate,
            firstDate: u.firstDate,
            inactiveDays: Math.floor(inactiveDays)
        };
        if (inactiveDays > 60) {
            buckets.fantomes.push(enriched);
        } else if (inactiveDays > 14) {
            buckets.aRisque.push(enriched);
        } else if (u.totalEvents >= 10) {
            buckets.champions.push(enriched);
        } else {
            // 1-9 events, dernier event <14j
            buckets.engages.push(enriched);
        }
    });
    return {
        champions: buckets.champions.length,
        engages: buckets.engages.length,
        aRisque: buckets.aRisque.length,
        fantomes: buckets.fantomes.length,
        buckets: buckets
    };
}

// ==================== RENDERING ====================
function computeSourceBreakdown(events) {
    // Map feature → { events: count, users: Set, minDate, maxDate }
    const map = new Map();
    events.forEach(e => {
        if (!map.has(e.feature)) {
            map.set(e.feature, { count: 0, users: new Set(), minDate: e.date, maxDate: e.date });
        }
        const s = map.get(e.feature);
        s.count++;
        s.users.add(e.email);
        if (e.date < s.minDate) s.minDate = e.date;
        if (e.date > s.maxDate) s.maxDate = e.date;
    });
    return map;
}

const FEATURE_LABELS = {
    'descriptif':      { label: 'Descriptif sommaire des travaux', org: 'BTP Consultants' },
    'autocontact':     { label: 'Auto Contacts',                    org: 'BTP Consultants' },
    'comparateur':     { label: 'Comparateur d\'indices',           org: 'BTP Consultants' },
    'analyse-ao':      { label: 'Analyse AO',                       org: 'BTP Consultants' },
    'expert-btp':      { label: 'Expert technique',                 org: 'BTP Consultants' },
    'chat-btp':        { label: 'Chat projet',                      org: 'BTP Consultants' },
    'expert-citae':    { label: 'Expert technique',                 org: 'Citae' },
    'chat-citae':      { label: 'Chat projet',                      org: 'Citae' },
    'expert-btpdiag':  { label: 'Expert technique',                 org: 'BTP Diagnostics' },
    'chat-btpdiag':    { label: 'Chat projet',                      org: 'BTP Diagnostics' }
};

const ORG_BADGE = {
    'BTP Consultants': 'bg-blue-50 text-blue-700 border-blue-200',
    'Citae':           'bg-emerald-50 text-emerald-700 border-emerald-200',
    'BTP Diagnostics': 'bg-amber-50 text-amber-700 border-amber-200'
};

function renderSourceBreakdown(breakdown, totalEvents, totalUniqueUsers) {
    const body = document.getElementById('source-breakdown-body');
    if (!body) return;
    const fmt = (d) => d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

    // Order features as declared in FEATURE_LABELS
    const orderedFeatures = Object.keys(FEATURE_LABELS);
    const rows = orderedFeatures.map(f => {
        const meta = FEATURE_LABELS[f];
        const s = breakdown.get(f);
        const orgClass = ORG_BADGE[meta.org] || 'bg-gray-50 text-gray-700 border-gray-200';
        if (!s || s.count === 0) {
            return `<tr class="border-b border-gray-100 text-gray-400">
                <td class="py-2 px-3">${meta.label} <span class="ml-1 text-[10px] uppercase px-1.5 py-0.5 rounded border ${orgClass}">${meta.org}</span></td>
                <td class="py-2 px-3 text-right">0</td>
                <td class="py-2 px-3 text-right">0</td>
                <td class="py-2 px-3 text-xs italic">aucune donnée</td>
            </tr>`;
        }
        return `<tr class="border-b border-gray-100">
            <td class="py-2 px-3 text-gray-700">${meta.label} <span class="ml-1 text-[10px] uppercase px-1.5 py-0.5 rounded border ${orgClass}">${meta.org}</span></td>
            <td class="py-2 px-3 text-right text-gray-700">${s.count.toLocaleString('fr-FR')}</td>
            <td class="py-2 px-3 text-right text-gray-700">${s.users.size.toLocaleString('fr-FR')}</td>
            <td class="py-2 px-3 text-xs text-gray-500">${fmt(s.minDate)} → ${fmt(s.maxDate)}</td>
        </tr>`;
    }).join('');
    body.innerHTML = rows;

    const totalEl = document.getElementById('total-events');
    const totalUsersEl = document.getElementById('total-unique-users');
    if (totalEl) totalEl.textContent = totalEvents.toLocaleString('fr-FR');
    if (totalUsersEl) totalUsersEl.textContent = totalUniqueUsers.toLocaleString('fr-FR');
}

function renderKPIs(kpi) {
    document.getElementById('kpi-active-users').textContent = kpi.active30.toLocaleString('fr-FR');
    document.getElementById('kpi-active-pct').textContent   = formatPct(kpi.activePct);
    document.getElementById('kpi-activation-pct').textContent = formatPct(kpi.activationPct);
    document.getElementById('kpi-activation-num').textContent = `${kpi.activatedSize} / ${kpi.activationPoolSize}`;
    document.getElementById('kpi-retention-pct').textContent  = formatPct(kpi.retentionPct);
    document.getElementById('kpi-retention-num').textContent  = `${kpi.retainedSize} / ${kpi.retentionPoolSize}`;
}

function renderCohortChart(cohorts) {
    const ctx = document.getElementById('chart-cohort');
    const datasets = cohorts.map((c, i) => ({
        label: `${c.label} (n=${c.size})`,
        data: c.data,
        borderColor: `hsl(${(i * 47) % 360}, 70%, 50%)`,
        backgroundColor: 'transparent',
        tension: 0.2
    }));
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['J0', 'J7', 'J14', 'J30'],
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, max: 100, title: { display: true, text: '% encore actifs' } },
                x: { title: { display: true, text: 'Jours depuis le premier event' } }
            },
            plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } }
        }
    });
}

function renderActivationChart(perMonth) {
    const ctx = document.getElementById('chart-activation');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: perMonth.map(m => m.label),
            datasets: [
                { label: 'Activés (≥2 events en 7j)', data: perMonth.map(m => m.activated), backgroundColor: '#8b5cf6' },
                { label: 'Non activés', data: perMonth.map(m => m.notActivated), backgroundColor: '#e9d5ff' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true },
                y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Nouveaux users' } }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        afterBody: (items) => {
                            const idx = items[0].dataIndex;
                            return `Taux activation: ${perMonth[idx].activatedPct.toFixed(1)}%`;
                        }
                    }
                }
            }
        }
    });
}

// Holds the segmentation buckets so the modal can access them after click.
let __segBuckets = null;

const SEGMENT_META = [
    { key: 'champions', label: 'Champions  (≥10 events, actif <14j)',     color: '#10b981', short: 'Champions' },
    { key: 'engages',   label: 'Engagés  (1-9 events, actif <14j)',       color: '#8b5cf6', short: 'Engagés' },
    { key: 'aRisque',   label: 'À risque  (dernier event 14j-60j)',       color: '#f59e0b', short: 'À risque' },
    { key: 'fantomes',  label: 'Fantômes  (dernier event >60j)',          color: '#ef4444', short: 'Fantômes' }
];

function renderSegmentationChart(seg) {
    __segBuckets = seg.buckets;
    const ctx = document.getElementById('chart-segmentation');
    const total = seg.champions + seg.engages + seg.aRisque + seg.fantomes;
    const pct = (n) => total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '0%';
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: SEGMENT_META.map(s => s.label),
            datasets: [{
                label: 'Users',
                data: SEGMENT_META.map(s => seg[s.key]),
                backgroundColor: SEGMENT_META.map(s => s.color)
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            onClick: (evt, elems) => {
                if (elems && elems.length > 0) {
                    const idx = elems[0].index;
                    openSegmentModal(SEGMENT_META[idx]);
                }
            },
            onHover: (evt, elems) => {
                evt.native.target.style.cursor = elems.length ? 'pointer' : 'default';
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.raw} users  (${pct(ctx.raw)} de la base) — clic pour voir la liste`
                    }
                },
                title: {
                    display: true,
                    text: 'Seuil "actif" : dernier event IA dans les 14 derniers jours  •  Clique sur une barre pour voir les emails',
                    font: { size: 11, weight: 'normal' },
                    color: '#6b7280',
                    padding: { bottom: 10 }
                }
            },
            scales: {
                x: { beginAtZero: true, title: { display: true, text: 'Nombre d\'utilisateurs' } },
                y: { ticks: { font: { size: 11 } } }
            }
        }
    });
}

// ==================== SEGMENT MODAL ====================
let __segModalState = {
    users: [],         // current segment users
    sortBy: 'totalEvents',
    sortDesc: true,
    filter: '',
    title: ''
};

function openSegmentModal(segMeta) {
    if (!__segBuckets) return;
    const users = __segBuckets[segMeta.key] || [];
    __segModalState = {
        users: users,
        sortBy: 'totalEvents',
        sortDesc: true,
        filter: '',
        title: segMeta.short,
        color: segMeta.color
    };
    document.getElementById('segment-modal-title').textContent = `${segMeta.short} — ${users.length} user${users.length !== 1 ? 's' : ''}`;
    document.getElementById('segment-modal-subtitle').textContent = segMeta.label.replace(segMeta.short, '').trim();
    document.getElementById('segment-modal-title').style.color = segMeta.color;
    document.getElementById('segment-search').value = '';
    document.getElementById('segment-copy-text').textContent = 'Copier les emails';
    document.getElementById('segment-modal').classList.remove('hidden');
    renderSegmentModalRows();
}

function closeSegmentModal() {
    document.getElementById('segment-modal').classList.add('hidden');
}

function formatRelativeDate(d) {
    if (!d) return '—';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderSegmentModalRows() {
    const body  = document.getElementById('segment-modal-body');
    const empty = document.getElementById('segment-modal-empty');
    if (!body) return;

    const filter = __segModalState.filter.toLowerCase().trim();
    let rows = __segModalState.users.filter(u => !filter || u.email.includes(filter));

    // Sort
    const { sortBy, sortDesc } = __segModalState;
    rows.sort((a, b) => {
        let av = a[sortBy], bv = b[sortBy];
        if (av instanceof Date) av = av.getTime();
        if (bv instanceof Date) bv = bv.getTime();
        if (typeof av === 'string') return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
        return sortDesc ? (bv - av) : (av - bv);
    });

    if (rows.length === 0) {
        body.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    body.innerHTML = rows.map(u => `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="py-2 px-3 text-gray-900">${u.email}</td>
            <td class="py-2 px-3 text-right text-gray-700">${u.totalEvents}</td>
            <td class="py-2 px-3 text-gray-600">${formatRelativeDate(u.lastDate)}</td>
            <td class="py-2 px-3 text-right text-gray-500 text-xs">il y a ${u.inactiveDays}j</td>
        </tr>
    `).join('');
}

function copySegmentEmails() {
    const filter = __segModalState.filter.toLowerCase().trim();
    const emails = __segModalState.users
        .filter(u => !filter || u.email.includes(filter))
        .map(u => u.email)
        .join('\n');
    if (!emails) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(emails).then(() => {
            const btn = document.getElementById('segment-copy-text');
            const prev = btn.textContent;
            btn.textContent = '✓ Copié !';
            setTimeout(() => { btn.textContent = prev; }, 2000);
        });
    } else {
        // Fallback (e.g., file:// in some browsers)
        const ta = document.createElement('textarea');
        ta.value = emails;
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            const btn = document.getElementById('segment-copy-text');
            btn.textContent = '✓ Copié !';
            setTimeout(() => { btn.textContent = 'Copier les emails'; }, 2000);
        } catch(e) {}
        document.body.removeChild(ta);
    }
}

// Modal event wiring (runs once on DOMContentLoaded)
function wireSegmentModal() {
    const modal = document.getElementById('segment-modal');
    if (!modal) return;

    document.getElementById('segment-modal-close').addEventListener('click', closeSegmentModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target === modal.firstElementChild) closeSegmentModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeSegmentModal();
    });
    document.getElementById('segment-search').addEventListener('input', (e) => {
        __segModalState.filter = e.target.value;
        renderSegmentModalRows();
    });
    document.getElementById('segment-copy-emails').addEventListener('click', copySegmentEmails);
    document.querySelectorAll('#segment-modal th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.getAttribute('data-sort');
            if (__segModalState.sortBy === col) {
                __segModalState.sortDesc = !__segModalState.sortDesc;
            } else {
                __segModalState.sortBy = col;
                __segModalState.sortDesc = (col !== 'email'); // email asc by default
            }
            renderSegmentModalRows();
        });
    });
}

// ==================== MAIN ====================
(async function init() {
    wireSegmentModal();
    const events = await loadAllData();
    if (!events) return; // redirected or showed error

    if (events.length === 0) {
        showError('Aucun événement IA trouvé depuis 2025-01-01.');
        return;
    }

    const stats     = computeUserStats(events);
    const kpis      = computeKPIs(stats);
    const cohorts   = computeCohortRetention(stats);
    const monthly   = computeActivationByMonth(stats);
    const seg       = computeSegmentation(stats);
    const breakdown = computeSourceBreakdown(events);

    console.log('Stats:', { totalUsers: stats.length, ...kpis, cohortsCount: cohorts.length, monthlyCount: monthly.length, seg });
    console.log('Source breakdown:', Array.from(breakdown.entries()).map(([f, s]) => ({
        feature: f, events: s.count, uniqueUsers: s.users.size, min: s.minDate, max: s.maxDate
    })));

    renderKPIs(kpis);
    renderSourceBreakdown(breakdown, events.length, stats.length);
    renderCohortChart(cohorts);
    renderActivationChart(monthly);
    renderSegmentationChart(seg);

    loadingEl.classList.add('hidden');
    mainEl.classList.remove('hidden');
})();
