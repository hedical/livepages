/**
 * Interface d'analyse des avis défavorables - Contacts & Entreprises
 * VERSION AGRÉGÉE (B2) : consomme 2 fichiers pré-agrégés côté SQL
 *   - risk_contacts.json     : 1 ligne par contact (carte Metabase 144)
 *   - risk_entreprises.json   : 1 ligne par entreprise (carte Metabase 145)
 * L'agrégation (totaux, nb d'affaires, types de bâtiments) est faite en SQL,
 * le front se contente de calculer le score de risque et d'afficher.
 *
 * + Onglets d'analyses complémentaires (taux, risque ouvert, collaborateurs,
 *   agences, missions, départements) avec tri, graphiques et détail au clic.
 */

// Données consolidées
let contactsByEmail = {};
let entreprisesByName = {};
let allContacts = [];
let allEntreprises = [];

// Constantes
const PAGE_SIZE = 50;
const SANS_SOCIETE = '(Sans société)';

// Webhook de vérification du mot de passe (retourne les URLs si OK)
const WEBHOOK_AUTH = 'https://databuildr.app.n8n.cloud/webhook/risk-data';

// URLs des données (fichiers agrégés, secours si webhook non appelé)
const DATA_URLS = {
  contacts: 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/risk_contacts.json',
  entreprises: 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/risk_entreprises.json'
};

// Helpers
function num(v) {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  if (v === '' || v == null) return 0;
  const n = parseInt(String(v).replace(/\s/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

function str(v) {
  return (v == null ? '' : String(v)).trim();
}

// BuildingTypes arrive en chaîne JSON ("{\"ERP\":12}") ou déjà en objet
function parseBuildingTypes(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try {
    const o = JSON.parse(v);
    return (o && typeof o === 'object') ? o : {};
  } catch {
    return {};
  }
}

/**
 * Score de risque : échelle logarithmique sur la moyenne par affaire.
 * Log compresse l'écart tout en gardant la cohérence du classement.
 */
function riskRawOf(avgPerOp) {
  return Math.log(1 + (avgPerOp || 0));
}

function parseUrlsFromResponse(text) {
  const mC = (text || '').match(/CONTACTS_URL\s*=\s*['"]([^'"]+)['"]/i);
  const mE = (text || '').match(/ENTREPRISES_URL\s*=\s*['"]([^'"]+)['"]/i);
  if (mC && mE) return { contacts: mC[1], entreprises: mE[1] };
  try {
    const o = JSON.parse(text);
    const c = o.CONTACTS_URL || o.contacts_url || o.contacts;
    const e = o.ENTREPRISES_URL || o.entreprises_url || o.entreprises;
    if (c && e) return { contacts: c, entreprises: e };
  } catch (_) {}
  return null;
}

// Chargement d'un fichier JSON depuis une URL
// Cache-buster + cache:'no-store' pour toujours récupérer la dernière version
// (évite le cache CDN Supabase / navigateur).
async function loadJsonFromUrl(url) {
  const bustUrl = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
  const res = await fetch(bustUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

function escapeHtml(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function fmtNum(v) {
  if (typeof v !== 'number') {
    const n = Number(v);
    if (v === '' || v == null || isNaN(n)) return escapeHtml(String(v ?? ''));
    v = n;
  }
  return Number.isInteger(v) ? v.toLocaleString('fr-FR') : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}

function debounce(fn, ms) {
  let t;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

// Construction des structures à partir des 2 fichiers agrégés
function buildAll(contactsRaw, entreprisesRaw) {
  // --- Contacts ---
  contactsByEmail = {};
  for (const row of (contactsRaw || [])) {
    const email = str(row.Email);
    if (!email) continue;
    const avis = num(row.Avis);
    const obs = num(row.Observations);
    const hand = num(row.HAND);
    const nbOps = Math.max(1, num(row.NbOperations));
    const total = avis + obs + hand;
    contactsByEmail[email] = {
      email,
      lastName: str(row.LastName),
      firstName: str(row.FirstName),
      company: str(row.Company) || SANS_SOCIETE,
      position: str(row.Position),
      role: str(row.Role),
      avis,
      observations: obs,
      statements: hand,
      nbOperations: nbOps,
      totalDefavorables: total,
      avgPerOperation: total / nbOps,
      buildingTypes: parseBuildingTypes(row.BuildingTypes)
    };
  }
  allContacts = Object.values(contactsByEmail).filter(c => c.totalDefavorables > 0);

  // --- Entreprises (totaux exacts depuis la carte 145) ---
  entreprisesByName = {};
  for (const row of (entreprisesRaw || [])) {
    const name = str(row.Company) || SANS_SOCIETE;
    const avis = num(row.Avis);
    const obs = num(row.Observations);
    const hand = num(row.HAND);
    const nbOps = Math.max(1, num(row.NbOperations));
    const total = avis + obs + hand;
    entreprisesByName[name] = {
      name,
      avis,
      observations: obs,
      statements: hand,
      nbOperations: nbOps,
      totalDefavorables: total,
      avgPerOperation: total / nbOps,
      contacts: []
    };
  }

  // Rattacher la liste des contacts à chaque entreprise (pour la modale)
  for (const c of allContacts) {
    let e = entreprisesByName[c.company];
    if (!e) {
      e = entreprisesByName[c.company] = {
        name: c.company, avis: 0, observations: 0, statements: 0,
        nbOperations: 1, totalDefavorables: 0, avgPerOperation: 0, contacts: []
      };
    }
    e.contacts.push({
      email: c.email, lastName: c.lastName, firstName: c.firstName,
      avis: c.avis, observations: c.observations, statements: c.statements
    });
  }
  allEntreprises = Object.values(entreprisesByName).filter(e => e.totalDefavorables > 0);

  // --- Scores de risque (normalisés sur le max de chaque population) ---
  // NB: max par boucle (Math.max(...array) dépasse la pile au-delà de ~100k).
  let refContact = 0.001;
  for (const c of allContacts) {
    c.riskRaw = riskRawOf(c.avgPerOperation);
    if (c.riskRaw > refContact) refContact = c.riskRaw;
  }
  for (const c of allContacts) {
    c.riskScore = Math.min(100, Math.round((c.riskRaw / refContact) * 100));
  }
  let refEnt = 0.001;
  for (const e of allEntreprises) {
    e.riskRaw = riskRawOf(e.avgPerOperation);
    if (e.riskRaw > refEnt) refEnt = e.riskRaw;
  }
  for (const e of allEntreprises) {
    e.riskScore = Math.min(100, Math.round((e.riskRaw / refEnt) * 100));
  }

  allContacts.sort((a, b) => b.riskScore - a.riskScore);
  allEntreprises.sort((a, b) => b.riskScore - a.riskScore);
}

// UI: Chargement depuis les URLs
async function loadAllDataFromUrls(urls) {
  const urlsToUse = urls || DATA_URLS;
  const overlay = document.getElementById('loadingOverlay');
  const progress = document.getElementById('loadProgress');
  const progressText = document.getElementById('progressText');
  const progressFill = document.getElementById('progressFill');
  const statusContacts = document.getElementById('statusAvis');       // relabellé "Contacts"
  const statusEntreprises = document.getElementById('statusObservations'); // relabellé "Entreprises"

  if (overlay) overlay.style.display = 'flex';
  if (progress) progress.style.display = 'flex';
  if (progressFill) progressFill.style.width = '0%';
  const overlayText = document.getElementById('loadingOverlayText');
  if (overlayText) overlayText.textContent = 'Chargement des données...';
  [statusContacts, statusEntreprises].forEach(s => {
    if (!s) return;
    s.textContent = 'En attente';
    s.classList.remove('loaded');
  });

  function setStatus(el, text, ok) {
    if (!el) return;
    el.textContent = text;
    if (ok) el.classList.add('loaded');
  }

  try {
    if (progressText) progressText.textContent = 'Chargement des 2 fichiers...';
    let done = 0;
    const onDone = (el, d) => {
      done++;
      if (progressFill) progressFill.style.width = `${(done / 2) * 100}%`;
      setStatus(el, `Chargé (${(Array.isArray(d) ? d : [d]).length.toLocaleString('fr-FR')} lignes)`, true);
    };
    const [contactsData, entData] = await Promise.all([
      loadJsonFromUrl(urlsToUse.contacts).then(d => { onDone(statusContacts, d); return d; }),
      loadJsonFromUrl(urlsToUse.entreprises).then(d => { onDone(statusEntreprises, d); return d; })
    ]);
    if (progressFill) progressFill.style.width = '100%';
    if (progressText) progressText.textContent = 'Traitement en cours...';
    if (overlayText) overlayText.textContent = 'Traitement en cours...';
    buildAll(Array.isArray(contactsData) ? contactsData : [contactsData],
             Array.isArray(entData) ? entData : [entData]);
    renderKpiBand();
    renderContacts();
    renderEntreprises();
    if (progressText) progressText.textContent = 'Chargement terminé';
    if (overlayText) overlayText.textContent = 'Chargement terminé';
  } catch (err) {
    if (progressText) progressText.textContent = `Erreur: ${err.message}`;
    [statusContacts, statusEntreprises].forEach(s => setStatus(s, 'Erreur', false));
    console.error(err);
  } finally {
    if (overlay) overlay.style.display = 'none';
    setTimeout(() => { if (progress) progress.style.display = 'none'; }, 2000);
  }
}

// ============================================================================
// Bandeau KPI + répartition du risque (graphiques globaux)
// ============================================================================
function riskDist(list) {
  let lo = 0, me = 0, hi = 0;
  for (const x of list) {
    const s = x.riskScore || 0;
    if (s >= 70) hi++; else if (s >= 40) me++; else lo++;
  }
  return { lo, me, hi, total: list.length };
}

function distBarHtml(title, d) {
  const t = d.total || 1;
  const pct = n => (n / t) * 100;
  return `<div class="dist">
    <div class="dist-title">${escapeHtml(title)}</div>
    <div class="dist-bar">
      <div class="seg seg-low"  style="width:${pct(d.lo)}%" title="Faible : ${d.lo}"></div>
      <div class="seg seg-med"  style="width:${pct(d.me)}%" title="Moyen : ${d.me}"></div>
      <div class="seg seg-high" style="width:${pct(d.hi)}%" title="Élevé : ${d.hi}"></div>
    </div>
    <div class="dist-legend">
      <span><i class="dot dot-low"></i>Faible <b>${fmtNum(d.lo)}</b></span>
      <span><i class="dot dot-med"></i>Moyen <b>${fmtNum(d.me)}</b></span>
      <span><i class="dot dot-high"></i>Élevé <b>${fmtNum(d.hi)}</b></span>
    </div>
  </div>`;
}

function renderKpiBand() {
  const band = document.getElementById('kpiBand');
  if (!band) return;
  const dc = riskDist(allContacts);
  const de = riskDist(allEntreprises);
  band.innerHTML = `
    <div class="kpi-cards">
      <div class="kpi-card kpi-a"><span class="kpi-value">${fmtNum(allContacts.length)}</span><span class="kpi-label">Contacts analysés</span></div>
      <div class="kpi-card kpi-b"><span class="kpi-value">${fmtNum(allEntreprises.length)}</span><span class="kpi-label">Entreprises analysées</span></div>
      <div class="kpi-card kpi-c"><span class="kpi-value">${fmtNum(de.hi)}</span><span class="kpi-label">Entreprises à risque élevé</span></div>
      <div class="kpi-card kpi-d"><span class="kpi-value">${fmtNum(dc.hi)}</span><span class="kpi-label">Contacts à risque élevé</span></div>
    </div>
    <div class="kpi-charts">
      ${distBarHtml('Répartition du risque — Entreprises', de)}
      ${distBarHtml('Répartition du risque — Contacts', dc)}
    </div>`;
}

// ============================================================================
// Tri générique de tableaux (colonnes typées)
// ============================================================================
function isNumCol(c) { return c.type === 'num' || c.type === 'numf' || c.type === 'score'; }
function valOf(c, row) { return c.get ? c.get(row) : row[c.key]; }

function buildHead(theadEl, cols, sort, onSort) {
  if (!theadEl) return;
  theadEl.innerHTML = '<tr>' + cols.map(c => {
    const active = sort.key === c.key;
    const arrow = active ? (sort.dir > 0 ? ' ▲' : ' ▼') : '';
    return `<th class="sortable${isNumCol(c) ? ' num' : ''}${active ? ' sorted' : ''}" data-key="${escapeHtml(c.key)}" title="Trier">${escapeHtml(c.label)}<span class="sort-ind">${arrow}</span></th>`;
  }).join('') + '</tr>';
  theadEl.querySelectorAll('th').forEach(th => th.addEventListener('click', () => onSort(th.dataset.key)));
}

function sortRows(arr, cols, sort) {
  const col = cols.find(c => c.key === sort.key);
  if (!col) return arr;
  const numeric = isNumCol(col);
  return arr.slice().sort((a, b) => {
    let xa = valOf(col, a), ya = valOf(col, b);
    if (numeric) { xa = Number(xa) || 0; ya = Number(ya) || 0; return (xa - ya) * sort.dir; }
    return String(xa ?? '').localeCompare(String(ya ?? ''), 'fr') * sort.dir;
  });
}

function nextSort(sort, key, cols) {
  if (sort.key === key) { sort.dir = -sort.dir; return; }
  const c = cols.find(x => x.key === key);
  sort.key = key;
  sort.dir = (c && (c.type === 'text' || c.type === 'email')) ? 1 : -1; // texte: A→Z, nombre: décroissant
}

// UI: Recherche
function filterContacts(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return allContacts;
  return allContacts.filter(c => {
    return (
      (c.lastName && c.lastName.toLowerCase().includes(q)) ||
      (c.firstName && c.firstName.toLowerCase().includes(q)) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.company && c.company.toLowerCase().includes(q))
    );
  });
}

function filterEntreprises(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return allEntreprises;
  return allEntreprises.filter(e => e.name.toLowerCase().includes(q));
}

// UI: Pagination
function paginate(arr, page) {
  const start = (page - 1) * PAGE_SIZE;
  return arr.slice(start, start + PAGE_SIZE);
}

function renderPagination(containerId, total, currentPage, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
  const cp = Math.max(1, Math.min(currentPage, totalPages));
  let html = '';
  html += `<button ${cp <= 1 ? 'disabled' : ''} data-page="${cp - 1}">← Préc.</button>`;
  html += `<span class="page-info">Page ${cp} / ${totalPages} (${total.toLocaleString('fr-FR')} résultats)</span>`;
  html += `<button ${cp >= totalPages ? 'disabled' : ''} data-page="${cp + 1}">Suiv. →</button>`;
  container.innerHTML = html;
  container.querySelectorAll('button:not([disabled])[data-page]').forEach(btn => {
    const p = parseInt(btn.dataset.page, 10);
    if (p >= 1 && p <= totalPages) btn.addEventListener('click', () => onPageChange(p));
  });
}

// ============================================================================
// UI: Contacts
// ============================================================================
const CONTACT_COLS = [
  { key: 'riskScore', label: 'Score', type: 'score' },
  { key: 'lastName', label: 'Nom', type: 'text' },
  { key: 'firstName', label: 'Prénom', type: 'text' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'company', label: 'Société', type: 'text' },
  { key: 'position', label: 'Position', type: 'text' },
  { key: 'role', label: 'Rôle', type: 'text' },
  { key: 'avis', label: 'Avis', type: 'num' },
  { key: 'observations', label: 'Obs.', type: 'num' },
  { key: 'statements', label: 'Stmt.', type: 'num' },
  { key: 'totalDefavorables', label: 'Total', type: 'num' },
  { key: 'nbOperations', label: 'Affaires', type: 'num' },
  { key: 'avgPerOperation', label: 'Moy/aff.', type: 'numf' }
];
let filteredContacts = [];
let contactCurrentPage = 1;
let contactSort = { key: 'riskScore', dir: -1 };

function renderContacts() {
  let list = filterContacts(document.getElementById('searchContact').value);
  filteredContacts = sortRows(list, CONTACT_COLS, contactSort);
  contactCurrentPage = 1;
  buildHead(document.querySelector('#viewContacts thead'), CONTACT_COLS, contactSort, k => {
    nextSort(contactSort, k, CONTACT_COLS); renderContacts();
  });
  document.getElementById('contactCount').textContent = `${filteredContacts.length.toLocaleString('fr-FR')} contact(s)`;
  renderContactsPage();
}

function goToContactPage(p) {
  contactCurrentPage = p;
  renderContactsPage();
}

function renderContactsPage() {
  const pageData = paginate(filteredContacts, contactCurrentPage);
  const tbody = document.getElementById('contactsTableBody');
  if (pageData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" class="empty-state">Aucun contact trouvé.</td></tr>';
    document.getElementById('contactPagination').innerHTML = '';
    return;
  }
  tbody.innerHTML = pageData.map(c => {
    const total = c.totalDefavorables || (c.avis + c.observations + c.statements);
    const n2 = (v) => v > 0 ? `<span class="has-value">${fmtNum(v)}</span>` : '0';
    const scoreClass = c.riskScore >= 70 ? 'risk-high' : c.riskScore >= 40 ? 'risk-medium' : 'risk-low';
    return `<tr data-email="${escapeHtml(c.email)}">
      <td><span class="risk-badge ${scoreClass}">${c.riskScore ?? '-'}</span></td>
      <td>${escapeHtml(c.lastName)}</td>
      <td>${escapeHtml(c.firstName)}</td>
      <td class="email-cell">${escapeHtml(c.email)}</td>
      <td>${escapeHtml(c.company)}</td>
      <td>${escapeHtml(c.position || '')}</td>
      <td>${escapeHtml(c.role || '')}</td>
      <td class="num-cell">${n2(c.avis)}</td>
      <td class="num-cell">${n2(c.observations)}</td>
      <td class="num-cell">${n2(c.statements)}</td>
      <td class="num-cell">${n2(total)}</td>
      <td class="num-cell">${fmtNum(c.nbOperations ?? 0)}</td>
      <td class="num-cell">${(c.avgPerOperation ?? 0).toFixed(1)}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => showContactDetail(tr.dataset.email));
  });
  renderPagination('contactPagination', filteredContacts.length, contactCurrentPage, goToContactPage);
}

function showContactDetail(email) {
  const c = contactsByEmail[email];
  if (!c) return;
  const modal = document.getElementById('contactModal');
  document.getElementById('modalContactTitle').textContent =
    `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email;
  const total = c.totalDefavorables || (c.avis + c.observations + c.statements);
  const scoreClass = (c.riskScore ?? 0) >= 70 ? 'risk-high' : (c.riskScore ?? 0) >= 40 ? 'risk-medium' : 'risk-low';
  const maxType = Math.max(...Object.values(c.buildingTypes || {}), 1);
  const buildingBars = Object.entries(c.buildingTypes || {})
    .sort((a, b) => b[1] - a[1])
    .map(([label, val]) => `
      <div class="chart-bar-row">
        <span class="chart-bar-label">${escapeHtml(label)}</span>
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${(val / maxType) * 100}%"></div></div>
        <span class="chart-bar-value">${fmtNum(val)}</span>
      </div>
    `).join('');
  const maxT = Math.max(c.avis, c.observations, c.statements, 1);
  document.getElementById('modalContactBody').innerHTML = `
    <div class="detail-section">
      <p><strong>Email :</strong> ${escapeHtml(c.email)}</p>
      <p><strong>Société :</strong> ${escapeHtml(c.company)}</p>
    </div>
    <div class="detail-section">
      <h4>Score de risque & métriques par affaire</h4>
      <div class="detail-grid">
        <div class="detail-stat"><span class="value"><span class="risk-badge ${scoreClass}">${c.riskScore ?? '-'}</span></span><span class="label">Score risque (0-100)</span></div>
        <div class="detail-stat"><span class="value">${fmtNum(c.nbOperations ?? 0)}</span><span class="label">Nb affaires distinctes</span></div>
        <div class="detail-stat"><span class="value">${(c.avgPerOperation ?? 0).toFixed(1)}</span><span class="label">Moy. éléments/affaire</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Répartition par type</h4>
      <div class="chart-bars">
        <div class="chart-bar-row"><span class="chart-bar-label">Avis</span><div class="chart-bar-track"><div class="chart-bar-fill c1" style="width:${(c.avis / maxT) * 100}%"></div></div><span class="chart-bar-value">${fmtNum(c.avis)}</span></div>
        <div class="chart-bar-row"><span class="chart-bar-label">Observations</span><div class="chart-bar-track"><div class="chart-bar-fill c2" style="width:${(c.observations / maxT) * 100}%"></div></div><span class="chart-bar-value">${fmtNum(c.observations)}</span></div>
        <div class="chart-bar-row"><span class="chart-bar-label">Statements HAND</span><div class="chart-bar-track"><div class="chart-bar-fill c3" style="width:${(c.statements / maxT) * 100}%"></div></div><span class="chart-bar-value">${fmtNum(c.statements)}</span></div>
      </div>
      <p class="detail-total">Total : <strong>${fmtNum(total)}</strong></p>
    </div>
    <div class="detail-section">
      <h4>Types de bâtiments</h4>
      <div class="chart-bars">${buildingBars || '<p>Aucune classification</p>'}</div>
    </div>
  `;
  modal.classList.add('active');
}

// ============================================================================
// UI: Entreprises
// ============================================================================
const ENT_COLS = [
  { key: 'riskScore', label: 'Score', type: 'score' },
  { key: 'name', label: 'Entreprise', type: 'text' },
  { key: 'avis', label: 'Avis', type: 'num' },
  { key: 'observations', label: 'Obs.', type: 'num' },
  { key: 'statements', label: 'Stmt.', type: 'num' },
  { key: 'totalDefavorables', label: 'Total', type: 'num' },
  { key: 'nbOperations', label: 'Affaires', type: 'num' },
  { key: 'avgPerOperation', label: 'Moy/aff.', type: 'numf' },
  { key: 'contactsCount', label: 'Contacts', type: 'num', get: e => e.contacts.length }
];
let filteredEntreprises = [];
let entrepriseCurrentPage = 1;
let entrepriseSort = { key: 'riskScore', dir: -1 };

function getEntreprisesForView() {
  const excludeSans = document.getElementById('excludeSansSociete')?.checked ?? false;
  let base = filterEntreprises(document.getElementById('searchEntreprise').value);
  if (excludeSans) base = base.filter(e => e.name !== SANS_SOCIETE);
  return base;
}

function renderEntreprises() {
  filteredEntreprises = sortRows(getEntreprisesForView(), ENT_COLS, entrepriseSort);
  entrepriseCurrentPage = 1;
  buildHead(document.querySelector('#viewEntreprises thead'), ENT_COLS, entrepriseSort, k => {
    nextSort(entrepriseSort, k, ENT_COLS); renderEntreprises();
  });
  document.getElementById('entrepriseCount').textContent = `${filteredEntreprises.length.toLocaleString('fr-FR')} entreprise(s)`;
  renderEntreprisesPage();
}

function goToEntreprisePage(p) {
  entrepriseCurrentPage = p;
  renderEntreprisesPage();
}

function getDisplayRiskScore(e, list) {
  if (list.length === 0) return 0;
  let ref = 0.001;
  for (const x of list) { const v = x.riskRaw || 0; if (v > ref) ref = v; }
  return Math.min(100, Math.round(((e.riskRaw || 0) / ref) * 100));
}

function renderEntreprisesPage() {
  const pageData = paginate(filteredEntreprises, entrepriseCurrentPage);
  const tbody = document.getElementById('entreprisesTableBody');
  const excludeSans = document.getElementById('excludeSansSociete')?.checked ?? false;
  const hasExcludeRecalc = excludeSans && filteredEntreprises.length > 0;
  if (pageData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Aucune entreprise trouvée.</td></tr>';
    document.getElementById('entreprisePagination').innerHTML = '';
    return;
  }
  tbody.innerHTML = pageData.map(e => {
    const total = e.totalDefavorables || (e.avis + e.observations + e.statements);
    const n2 = (v) => v > 0 ? `<span class="has-value">${fmtNum(v)}</span>` : '0';
    const displayScore = hasExcludeRecalc ? getDisplayRiskScore(e, filteredEntreprises) : (e.riskScore ?? '-');
    const scoreClass = displayScore >= 70 ? 'risk-high' : displayScore >= 40 ? 'risk-medium' : 'risk-low';
    return `<tr data-name="${escapeHtml(e.name)}">
      <td><span class="risk-badge ${scoreClass}">${displayScore}</span></td>
      <td>${escapeHtml(e.name)}</td>
      <td class="num-cell">${n2(e.avis)}</td>
      <td class="num-cell">${n2(e.observations)}</td>
      <td class="num-cell">${n2(e.statements)}</td>
      <td class="num-cell">${n2(total)}</td>
      <td class="num-cell">${fmtNum(e.nbOperations ?? 0)}</td>
      <td class="num-cell">${(e.avgPerOperation ?? 0).toFixed(1)}</td>
      <td class="num-cell">${fmtNum(e.contacts.length)}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => showEntrepriseDetail(tr.dataset.name));
  });
  renderPagination('entreprisePagination', filteredEntreprises.length, entrepriseCurrentPage, goToEntreprisePage);
}

function showEntrepriseDetail(name) {
  const e = entreprisesByName[name];
  if (!e) return;
  const modal = document.getElementById('entrepriseModal');
  document.getElementById('modalEntrepriseTitle').textContent = name;
  const total = e.avis + e.observations + e.statements;
  const maxVal = Math.max(e.avis, e.observations, e.statements, 1);
  const excludeSans = document.getElementById('excludeSansSociete')?.checked ?? false;
  const displayScore = excludeSans && filteredEntreprises.length > 0
    ? getDisplayRiskScore(e, filteredEntreprises) : (e.riskScore ?? '-');
  const sc = (typeof displayScore === 'number' ? displayScore : e.riskScore ?? 0);
  const scoreClass = sc >= 70 ? 'risk-high' : sc >= 40 ? 'risk-medium' : 'risk-low';
  const contactsHtml = e.contacts
    .sort((a, b) => (b.avis + b.observations + b.statements) - (a.avis + a.observations + a.statements))
    .map(c => {
      const badges = [];
      if (c.avis) badges.push(`<span class="badge badge-avis">Avis ${c.avis}</span>`);
      if (c.observations) badges.push(`<span class="badge badge-obs">Obs ${c.observations}</span>`);
      if (c.statements) badges.push(`<span class="badge badge-stmt">Hand ${c.statements}</span>`);
      return `<div class="contact-list-item">
        <span class="email">${escapeHtml(c.email)}</span>
        <span class="badges">${badges.join('')}</span>
      </div>`;
    }).join('');
  document.getElementById('modalEntrepriseBody').innerHTML = `
    <div class="detail-section">
      <h4>Score de risque & métriques par affaire</h4>
      <div class="detail-grid">
        <div class="detail-stat"><span class="value"><span class="risk-badge ${scoreClass}">${displayScore}</span></span><span class="label">Score risque (0-100)</span></div>
        <div class="detail-stat"><span class="value">${fmtNum(e.nbOperations ?? 0)}</span><span class="label">Nb affaires distinctes</span></div>
        <div class="detail-stat"><span class="value">${(e.avgPerOperation ?? 0).toFixed(1)}</span><span class="label">Moy. éléments/affaire</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Répartition par type</h4>
      <div class="chart-bars">
        <div class="chart-bar-row"><span class="chart-bar-label">Avis</span><div class="chart-bar-track"><div class="chart-bar-fill c1" style="width:${(e.avis / maxVal) * 100}%"></div></div><span class="chart-bar-value">${fmtNum(e.avis)}</span></div>
        <div class="chart-bar-row"><span class="chart-bar-label">Observations</span><div class="chart-bar-track"><div class="chart-bar-fill c2" style="width:${(e.observations / maxVal) * 100}%"></div></div><span class="chart-bar-value">${fmtNum(e.observations)}</span></div>
        <div class="chart-bar-row"><span class="chart-bar-label">Statements HAND</span><div class="chart-bar-track"><div class="chart-bar-fill c3" style="width:${(e.statements / maxVal) * 100}%"></div></div><span class="chart-bar-value">${fmtNum(e.statements)}</span></div>
      </div>
      <p class="detail-total">Total : <strong>${fmtNum(total)}</strong></p>
    </div>
    <div class="detail-section">
      <h4>Contacts (${e.contacts.length})</h4>
      <div class="contact-list">${contactsHtml}</div>
    </div>
  `;
  modal.classList.add('active');
}

// ============================================================================
// ANALYSES COMPLÉMENTAIRES (onglets génériques, chargés à la demande)
//   tableau trié + graphique top-15 + détail au clic (collaborateur / agence)
// ============================================================================
const DATA_BASE = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/';
const ANALYSES = [
  { key: 'taux',    label: 'Taux défav. (entr.)', file: DATA_BASE + 'risk_taux_entreprise.json',  search: ['Entreprise'],   placeholder: 'Rechercher une entreprise...', chartMetric: 'Avis défavorables', defaultSort: 'Avis défavorables' },
  { key: 'ouvert',  label: 'Risque ouvert',       file: DATA_BASE + 'risk_ouvert_entreprise.json', search: ['Entreprise'],   placeholder: 'Rechercher une entreprise...', chartMetric: 'Défav. NON levés', defaultSort: 'Défav. NON levés' },
  { key: 'collab',  label: 'Collaborateurs',      file: DATA_BASE + 'risk_collaborateur.json',      search: ['Collaborateur', 'Agence'], placeholder: 'Rechercher un collaborateur / agence...', chartMetric: 'Avis défavorables', defaultSort: 'Avis défavorables' },
  { key: 'agence',  label: 'Agences',             file: DATA_BASE + 'risk_agence.json',             search: ['Agence'],       placeholder: 'Rechercher une agence...', chartMetric: 'Avis défavorables', defaultSort: 'Avis défavorables' },
  { key: 'mission', label: 'Missions',            file: DATA_BASE + 'risk_mission.json',            search: ['Mission'],      placeholder: 'Rechercher une mission...', chartMetric: 'Taux défav. (%)', defaultSort: 'Avis défavorables' },
  { key: 'dept',    label: 'Départements',        file: DATA_BASE + 'risk_departement.json',        search: ['Département'],  placeholder: 'Rechercher un département...', chartMetric: 'Avis défavorables', defaultSort: 'Avis défavorables' }
];
const analysisCache = {};
const analysisUI = {};

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function setupAnalyses() {
  const nav = document.querySelector('nav.tabs');
  const main = document.getElementById('mainContent');
  if (!nav || !main) return;
  ensureGenericModal();
  const legend = nav.querySelector('.score-legend'); // insérer les onglets AVANT la légende (margin-left:auto)
  for (const a of ANALYSES) {
    analysisUI[a.key] = { page: 1, sortCol: a.defaultSort || null, sortDir: -1, query: '' };
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.view = a.key;
    btn.textContent = a.label;
    if (legend) nav.insertBefore(btn, legend); else nav.appendChild(btn);

    const sec = document.createElement('section');
    sec.id = 'view' + cap(a.key);
    sec.className = 'view';
    sec.innerHTML = `
      <div class="search-bar">
        <input type="text" id="search_${a.key}" placeholder="${a.placeholder}">
        <span class="result-count" id="count_${a.key}"></span>
      </div>
      <div class="chart-panel" id="chart_${a.key}"></div>
      <div class="table-container">
        <table class="data-table">
          <thead id="thead_${a.key}"></thead>
          <tbody id="tbody_${a.key}"></tbody>
        </table>
      </div>
      <div class="pagination" id="pag_${a.key}"></div>`;
    main.appendChild(sec);

    btn.addEventListener('click', () => activateAnalysis(a));
    sec.querySelector('#search_' + a.key).addEventListener('input', debounce(() => {
      analysisUI[a.key].query = document.getElementById('search_' + a.key).value;
      analysisUI[a.key].page = 1;
      renderAnalysis(a);
    }, 250));
  }
}

function activateAnalysis(a) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === a.key));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view' + cap(a.key)).classList.add('active');
  if (!analysisCache[a.key]) loadAnalysis(a); else renderAnalysis(a);
}

async function loadAnalysis(a) {
  const tb = document.getElementById('tbody_' + a.key);
  tb.innerHTML = '<tr><td class="empty-state" colspan="20">Chargement…</td></tr>';
  try {
    analysisCache[a.key] = await ensureAnalysisData(a.key);
    renderAnalysis(a);
  } catch (e) {
    tb.innerHTML = `<tr><td class="empty-state" colspan="20">Erreur: ${escapeHtml(e.message)}</td></tr>`;
  }
}

async function ensureAnalysisData(key) {
  if (!analysisCache[key]) {
    const a = ANALYSES.find(x => x.key === key);
    const d = await loadJsonFromUrl(a.file);
    analysisCache[key] = Array.isArray(d) ? d : [];
  }
  return analysisCache[key];
}

function renderAnalysisChart(a, filtered, cols) {
  const panel = document.getElementById('chart_' + a.key);
  if (!panel) return;
  if (!filtered.length || !cols.length) { panel.innerHTML = ''; return; }
  const ui = analysisUI[a.key];
  // La courbe suit la colonne triée si elle est numérique, sinon métrique par défaut.
  let metric = a.chartMetric;
  if (ui.sortCol && typeof filtered[0][ui.sortCol] === 'number') metric = ui.sortCol;
  if (typeof filtered[0][metric] !== 'number') {
    const firstNum = cols.find(c => typeof filtered[0][c] === 'number');
    if (!firstNum) { panel.innerHTML = ''; return; }
    metric = firstNum;
  }
  const labelCol = cols[0];
  const isPct = /%|taux/i.test(metric);
  const top = filtered.slice().sort((x, y) => (Number(y[metric]) || 0) - (Number(x[metric]) || 0)).slice(0, 15);
  const max = Math.max(...top.map(r => Number(r[metric]) || 0), 1);
  panel.innerHTML = `<div class="chart-title">${escapeHtml(metric)} — top ${top.length}</div>` +
    top.map(r => {
      const v = Number(r[metric]) || 0;
      const lab = String(r[labelCol] ?? '');
      return `<div class="chart-bar-row">
        <span class="chart-bar-label" title="${escapeHtml(lab)}">${escapeHtml(lab)}</span>
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${(v / max) * 100}%"></div></div>
        <span class="chart-bar-value">${fmtNum(v)}${isPct ? ' %' : ''}</span>
      </div>`;
    }).join('');
}

function renderAnalysis(a) {
  const rows = analysisCache[a.key] || [];
  const ui = analysisUI[a.key];
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const numericCols = new Set(cols.filter(c => rows.some(r => typeof r[c] === 'number')));

  const q = (ui.query || '').toLowerCase().trim();
  let filtered = rows;
  if (q) {
    const keys = (a.search && a.search.length) ? a.search : cols;
    filtered = rows.filter(r => keys.some(k => String(r[k] ?? '').toLowerCase().includes(q)));
  }
  if (ui.sortCol && cols.includes(ui.sortCol)) {
    const c = ui.sortCol, dir = ui.sortDir, numeric = numericCols.has(c);
    filtered = filtered.slice().sort((x, y) => {
      let xa = x[c], ya = y[c];
      if (numeric) { xa = Number(xa) || 0; ya = Number(ya) || 0; return (xa - ya) * dir; }
      return String(xa ?? '').localeCompare(String(ya ?? ''), 'fr') * dir;
    });
  }

  // En-têtes triables + alignement numérique
  const thead = document.getElementById('thead_' + a.key);
  thead.innerHTML = '<tr>' + cols.map(c => {
    const active = ui.sortCol === c;
    const arrow = active ? (ui.sortDir > 0 ? ' ▲' : ' ▼') : '';
    return `<th class="sortable${numericCols.has(c) ? ' num' : ''}${active ? ' sorted' : ''}" data-col="${escapeHtml(c)}" title="Trier">${escapeHtml(c)}<span class="sort-ind">${arrow}</span></th>`;
  }).join('') + '</tr>';
  thead.querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
    const c = th.dataset.col;
    if (ui.sortCol === c) ui.sortDir = -ui.sortDir;
    else { ui.sortCol = c; ui.sortDir = numericCols.has(c) ? -1 : 1; }
    ui.page = 1;
    renderAnalysis(a);
  }));

  renderAnalysisChart(a, filtered, cols);
  document.getElementById('count_' + a.key).textContent = `${filtered.length.toLocaleString('fr-FR')} ligne(s)`;

  const start = (ui.page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const tb = document.getElementById('tbody_' + a.key);
  if (!pageRows.length) {
    tb.innerHTML = `<tr><td class="empty-state" colspan="${cols.length || 1}">Aucune donnée</td></tr>`;
    document.getElementById('pag_' + a.key).innerHTML = '';
    return;
  }
  const clickable = typeof a.onRow === 'function';
  tb.innerHTML = pageRows.map((r, i) => `<tr data-idx="${i}"${clickable ? ' class="clickable"' : ''}>` + cols.map(c => {
    const v = r[c];
    const isNum = numericCols.has(c) && typeof v === 'number';
    return `<td class="${isNum ? 'num-cell' : ''}">${isNum ? fmtNum(v) : escapeHtml(String(v ?? ''))}</td>`;
  }).join('') + '</tr>').join('');
  if (clickable) {
    tb.querySelectorAll('tr[data-idx]').forEach(tr => {
      tr.addEventListener('click', () => openAnalysisDetail(a, pageRows[+tr.dataset.idx]));
    });
  }
  renderPagination('pag_' + a.key, filtered.length, ui.page, (p) => { ui.page = p; renderAnalysis(a); });
}

// --- Détail au clic (modal générique) -------------------------------------
function ensureGenericModal() {
  if (document.getElementById('analysisModal')) return;
  const m = document.createElement('div');
  m.className = 'modal';
  m.id = 'analysisModal';
  m.innerHTML = `<div class="modal-content modal-wide">
    <button class="modal-close" id="closeAnalysisModal">&times;</button>
    <h3 id="analysisModalTitle"></h3>
    <div id="analysisModalBody"></div>
  </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target.id === 'analysisModal') m.classList.remove('active'); });
  m.querySelector('#closeAnalysisModal').addEventListener('click', () => m.classList.remove('active'));
}

function openModal(title, bodyHtml) {
  ensureGenericModal();
  document.getElementById('analysisModalTitle').textContent = title;
  document.getElementById('analysisModalBody').innerHTML = bodyHtml;
  document.getElementById('analysisModal').classList.add('active');
}

async function openAnalysisDetail(a, row) {
  if (!a.onRow || !row) return;
  openModal(a.detailTitle ? a.detailTitle(row) : '', '<p class="empty-state">Chargement…</p>');
  try {
    let body = a.onRow(row);
    if (body instanceof Promise) body = await body;
    document.getElementById('analysisModalBody').innerHTML = body;
  } catch (e) {
    document.getElementById('analysisModalBody').innerHTML = `<p class="empty-state">Erreur : ${escapeHtml(e.message)}</p>`;
  }
}

function compareBars(items) {
  const max = Math.max(...items.map(i => i.value), 0.0001);
  return `<div class="chart-bars">` + items.map(i => `
    <div class="chart-bar-row">
      <span class="chart-bar-label">${escapeHtml(i.label)}</span>
      <div class="chart-bar-track"><div class="chart-bar-fill ${i.cls || ''}" style="width:${(i.value / max) * 100}%"></div></div>
      <span class="chart-bar-value">${fmtNum(i.value)}${i.pct ? ' %' : ''}</span>
    </div>`).join('') + `</div>`;
}

// Détail Collaborateur : ses chiffres + comparaison taux (collab / agence / global) + rangs
function collabDetail(row) {
  const all = analysisCache['collab'] || [];
  const K = 'Avis défavorables', T = 'Total avis', TX = 'Taux défav. (%)', AFF = 'Nb affaires', LEV = '% levés', AG = 'Agence', NAME = 'Collaborateur';
  const sumD = all.reduce((s, r) => s + (Number(r[K]) || 0), 0);
  const sumT = all.reduce((s, r) => s + (Number(r[T]) || 0), 0);
  const globalTaux = sumT ? +(sumD / sumT * 100).toFixed(1) : 0;
  const agRows = all.filter(r => r[AG] === row[AG]);
  const agD = agRows.reduce((s, r) => s + (Number(r[K]) || 0), 0);
  const agT = agRows.reduce((s, r) => s + (Number(r[T]) || 0), 0);
  const agTaux = agT ? +(agD / agT * 100).toFixed(1) : 0;
  const byVol = all.slice().sort((x, y) => (Number(y[K]) || 0) - (Number(x[K]) || 0));
  const rankVol = byVol.findIndex(r => r[NAME] === row[NAME]) + 1;
  const byTaux = all.slice().sort((x, y) => (Number(y[TX]) || 0) - (Number(x[TX]) || 0));
  const rankTaux = byTaux.findIndex(r => r[NAME] === row[NAME]) + 1;
  return `
    <div class="detail-section">
      <p><strong>Agence :</strong> ${escapeHtml(String(row[AG] ?? '—'))}</p>
    </div>
    <div class="detail-section">
      <h4>Chiffres clés</h4>
      <div class="detail-grid">
        <div class="detail-stat"><span class="value">${fmtNum(row[K])}</span><span class="label">Avis défavorables</span></div>
        <div class="detail-stat"><span class="value">${fmtNum(row[T])}</span><span class="label">Total avis</span></div>
        <div class="detail-stat"><span class="value">${fmtNum(row[TX])} %</span><span class="label">Taux défav.</span></div>
        <div class="detail-stat"><span class="value">${fmtNum(row[AFF])}</span><span class="label">Nb affaires</span></div>
        <div class="detail-stat"><span class="value">${fmtNum(row[LEV])} %</span><span class="label">Défav. levés</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Taux de défavorabilité — comparaison</h4>
      ${compareBars([
        { label: 'Ce collaborateur', value: Number(row[TX]) || 0, pct: true, cls: 'c1' },
        { label: 'Moyenne agence', value: agTaux, pct: true, cls: 'c2' },
        { label: 'Moyenne globale', value: globalTaux, pct: true, cls: 'c3' }
      ])}
    </div>
    <div class="detail-section">
      <h4>Classements (sur ${all.length} collaborateurs)</h4>
      <div class="detail-grid">
        <div class="detail-stat"><span class="value">#${rankVol}</span><span class="label">Volume d'avis défav.</span></div>
        <div class="detail-stat"><span class="value">#${rankTaux}</span><span class="label">Taux de défavorabilité</span></div>
      </div>
    </div>`;
}

// Détail Agence : liste de ses collaborateurs (depuis le fichier collaborateur)
async function agenceDetail(row) {
  const AG = 'Agence', NAME = 'Collaborateur', K = 'Avis défavorables', T = 'Total avis', TX = 'Taux défav. (%)';
  const collab = await ensureAnalysisData('collab');
  const list = collab.filter(r => r[AG] === row[AG]).sort((x, y) => (Number(y[K]) || 0) - (Number(x[K]) || 0));
  const head = `
    <div class="detail-section">
      <div class="detail-grid">
        <div class="detail-stat"><span class="value">${fmtNum(row[K])}</span><span class="label">Avis défavorables</span></div>
        <div class="detail-stat"><span class="value">${fmtNum(row[T])}</span><span class="label">Total avis</span></div>
        <div class="detail-stat"><span class="value">${fmtNum(row[TX])} %</span><span class="label">Taux défav.</span></div>
        <div class="detail-stat"><span class="value">${fmtNum(row['Nb collaborateurs'])}</span><span class="label">Collaborateurs</span></div>
      </div>
    </div>`;
  if (!list.length) return head + '<p class="empty-state">Aucun collaborateur rattaché trouvé.</p>';
  const rows = list.map(r => `<tr>
    <td>${escapeHtml(String(r[NAME] ?? ''))}</td>
    <td class="num-cell">${fmtNum(r[K])}</td>
    <td class="num-cell">${fmtNum(r[T])}</td>
    <td class="num-cell">${fmtNum(r[TX])} %</td>
  </tr>`).join('');
  return head + `
    <div class="detail-section">
      <h4>Collaborateurs (${list.length})</h4>
      <div class="table-container" style="max-height:50vh">
        <table class="data-table">
          <thead><tr><th>Collaborateur</th><th class="num">Avis défav.</th><th class="num">Total avis</th><th class="num">Taux</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// Rattacher les comportements au clic
ANALYSES.find(a => a.key === 'collab').onRow = collabDetail;
ANALYSES.find(a => a.key === 'collab').detailTitle = r => String(r['Collaborateur'] ?? 'Collaborateur');
ANALYSES.find(a => a.key === 'agence').onRow = agenceDetail;
ANALYSES.find(a => a.key === 'agence').detailTitle = r => String(r['Agence'] ?? 'Agence');

// ============================================================================
// Init
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  const loginOverlay = document.getElementById('loginOverlay');
  const mainContent = document.getElementById('mainContent');
  const loginForm = document.getElementById('loginForm');
  const loginPassword = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');
  const loginSubmit = document.getElementById('loginSubmit');

  const AUTH_KEY = 'risques_auth';

  // Nettoyage de l'ancien loader 3 fichiers + bandeau KPI
  fixLayout();

  function checkAuth() { return sessionStorage.getItem(AUTH_KEY) === '1'; }
  function setAuth() { sessionStorage.setItem(AUTH_KEY, '1'); }
  function showApp(urls) {
    if (loginOverlay) loginOverlay.style.display = 'none';
    if (mainContent) mainContent.style.display = 'block';
    loadAllDataFromUrls(urls);
  }

  if (checkAuth()) {
    let urls;
    const stored = sessionStorage.getItem('risques_urls');
    if (stored) {
      try {
        urls = JSON.parse(stored);
        if (!urls.contacts || !urls.entreprises) urls = null;
      } catch (_) { urls = null; }
    }
    showApp(urls || undefined);
  } else {
    loginForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwd = loginPassword?.value?.trim();
      if (!pwd) return;
      loginError.textContent = '';
      loginSubmit.disabled = true;
      try {
        const res = await fetch(WEBHOOK_AUTH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd })
        });
        const text = await res.text();
        if (!res.ok) throw new Error('Mot de passe incorrect');
        const urls = parseUrlsFromResponse(text) || DATA_URLS;
        sessionStorage.setItem('risques_urls', JSON.stringify(urls));
        setAuth();
        showApp(urls);
      } catch (err) {
        loginError.textContent = err.message || 'Mot de passe incorrect';
      } finally {
        loginSubmit.disabled = false;
      }
    });
  }

  document.getElementById('reloadData')?.addEventListener('click', async () => {
    const btn = document.getElementById('reloadData');
    const overlay = document.getElementById('loadingOverlay');
    const overlayText = document.getElementById('loadingOverlayText');
    btn.disabled = true;
    if (overlay) overlay.style.display = 'flex';
    if (overlayText) overlayText.textContent = 'Rafraîchissement des données (peut prendre ~1 min)...';
    try {
      let urls = DATA_URLS;
      const res = await fetch('https://databuildr.app.n8n.cloud/webhook/get-risks-files', { method: 'GET' });
      if (res.ok) {
        const text = await res.text();
        const parsed = parseUrlsFromResponse(text);
        if (parsed) urls = parsed;
      }
      if (overlayText) overlayText.textContent = 'Chargement des données...';
      await loadAllDataFromUrls(urls);
    } catch (err) {
      if (overlayText) overlayText.textContent = 'Erreur: ' + err.message;
    } finally {
      if (overlay) overlay.style.display = 'none';
      btn.disabled = false;
    }
  });

  document.getElementById('searchContact').addEventListener('input', debounce(renderContacts, 250));
  document.getElementById('searchEntreprise').addEventListener('input', debounce(renderEntreprises, 250));
  document.getElementById('excludeSansSociete').addEventListener('change', renderEntreprises);

  // Onglets Contacts / Entreprises (les onglets d'analyses ont leur propre handler)
  document.querySelectorAll('.tab[data-view="contacts"], .tab[data-view="entreprises"]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('view' + cap(tab.dataset.view)).classList.add('active');
    });
  });

  document.getElementById('closeContactModal').addEventListener('click', () =>
    document.getElementById('contactModal').classList.remove('active'));
  document.getElementById('closeEntrepriseModal').addEventListener('click', () =>
    document.getElementById('entrepriseModal').classList.remove('active'));
  document.getElementById('contactModal').addEventListener('click', (e) => {
    if (e.target.id === 'contactModal') e.target.classList.remove('active');
  });
  document.getElementById('entrepriseModal').addEventListener('click', (e) => {
    if (e.target.id === 'entrepriseModal') e.target.classList.remove('active');
  });

  // Onglets d'analyses complémentaires (générés dynamiquement)
  setupAnalyses();
});

// Nettoie le loader hérité (3 fichiers → 2) et insère le bandeau KPI
function fixLayout() {
  const statuses = document.querySelector('.file-statuses');
  if (statuses) {
    const spans = statuses.querySelectorAll(':scope > span');
    if (spans[0]) { const s = spans[0].querySelector('strong'); if (s) s.textContent = 'Contacts :'; }
    if (spans[1]) { const s = spans[1].querySelector('strong'); if (s) s.textContent = 'Entreprises :'; }
    if (spans[2]) spans[2].style.display = 'none'; // ancien "Statements" (obsolète en mode agrégé)
  }
  const hint = document.querySelector('.loader-hint');
  if (hint) hint.textContent = '2 fichiers agrégés (contacts & entreprises) chargés automatiquement depuis le serveur.';

  // Bandeau KPI inséré juste avant la première vue
  const main = document.getElementById('mainContent');
  if (main && !document.getElementById('kpiBand')) {
    const band = document.createElement('section');
    band.className = 'kpi-band';
    band.id = 'kpiBand';
    const firstView = main.querySelector('.view');
    if (firstView) main.insertBefore(band, firstView); else main.appendChild(band);
  }
}
