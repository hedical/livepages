/**
 * Interface d'analyse des avis défavorables - Contacts & Entreprises
 * VERSION AGRÉGÉE (B2) : consomme 2 fichiers pré-agrégés côté SQL
 *   - risk_contacts.json     : 1 ligne par contact (carte Metabase 144)
 *   - risk_entreprises.json   : 1 ligne par entreprise (carte Metabase 145)
 * L'agrégation (totaux, nb d'affaires, types de bâtiments) est faite en SQL,
 * le front se contente de calculer le score de risque et d'afficher.
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
      // société absente du fichier entreprises : on la crée a minima
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
  // NB: on calcule le max par boucle (Math.max(...array) dépasse la pile au-delà
  // de ~100k éléments avec l'opérateur spread).
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
  const statusAvis = document.getElementById('statusAvis');
  const statusObservations = document.getElementById('statusObservations');
  const statusStatements = document.getElementById('statusStatements');

  if (overlay) overlay.style.display = 'flex';
  if (progress) progress.style.display = 'flex';
  if (progressFill) progressFill.style.width = '0%';
  const overlayText = document.getElementById('loadingOverlayText');
  if (overlayText) overlayText.textContent = 'Chargement des données...';
  [statusAvis, statusObservations, statusStatements].forEach(s => {
    if (!s) return;
    s.textContent = 'En attente';
    s.classList.remove('loaded');
  });
  if (statusStatements) statusStatements.style.display = 'none';

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
      setStatus(el, `Chargé (${(Array.isArray(d) ? d : [d]).length} lignes)`, true);
    };
    const [contactsData, entData] = await Promise.all([
      loadJsonFromUrl(urlsToUse.contacts).then(d => { onDone(statusAvis, d); return d; }),
      loadJsonFromUrl(urlsToUse.entreprises).then(d => { onDone(statusObservations, d); return d; })
    ]);
    if (progressFill) progressFill.style.width = '100%';
    if (progressText) progressText.textContent = 'Traitement en cours...';
    if (overlayText) overlayText.textContent = 'Traitement en cours...';
    buildAll(Array.isArray(contactsData) ? contactsData : [contactsData],
             Array.isArray(entData) ? entData : [entData]);
    renderContacts();
    renderEntreprises();
    if (progressText) progressText.textContent = 'Chargement terminé';
    if (overlayText) overlayText.textContent = 'Chargement terminé';
  } catch (err) {
    if (progressText) progressText.textContent = `Erreur: ${err.message}`;
    [statusAvis, statusObservations].forEach(s => setStatus(s, 'Erreur', false));
    console.error(err);
  } finally {
    if (overlay) overlay.style.display = 'none';
    setTimeout(() => { if (progress) progress.style.display = 'none'; }, 2000);
  }
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
  html += `<span class="page-info">Page ${cp} / ${totalPages} (${total} résultats)</span>`;
  html += `<button ${cp >= totalPages ? 'disabled' : ''} data-page="${cp + 1}">Suiv. →</button>`;
  container.innerHTML = html;
  container.querySelectorAll('button:not([disabled])[data-page]').forEach(btn => {
    const p = parseInt(btn.dataset.page, 10);
    if (p >= 1 && p <= totalPages) btn.addEventListener('click', () => onPageChange(p));
  });
}

// UI: Contacts
let filteredContacts = [];
let contactCurrentPage = 1;

function renderContacts() {
  filteredContacts = filterContacts(document.getElementById('searchContact').value);
  contactCurrentPage = 1;
  document.getElementById('contactCount').textContent = `${filteredContacts.length} contact(s)`;
  renderContactsPage();
}

function goToContactPage(p) {
  contactCurrentPage = p;
  renderContactsPage();
  renderPagination('contactPagination', filteredContacts.length, contactCurrentPage, goToContactPage);
}

function renderContactsPage() {
  const pageData = paginate(filteredContacts, contactCurrentPage);
  const tbody = document.getElementById('contactsTableBody');
  if (pageData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" class="empty-state">Aucun contact trouvé. Chargez les fichiers JSON et utilisez la recherche.</td></tr>';
    return;
  }
  tbody.innerHTML = pageData.map(c => {
    const total = c.totalDefavorables || (c.avis + c.observations + c.statements);
    const num2 = (v) => v > 0 ? `<span class="num-cell has-value">${v}</span>` : `<span class="num-cell">0</span>`;
    const scoreClass = c.riskScore >= 70 ? 'risk-high' : c.riskScore >= 40 ? 'risk-medium' : 'risk-low';
    return `<tr data-email="${escapeHtml(c.email)}">
      <td><span class="risk-badge ${scoreClass}">${c.riskScore ?? '-'}</span></td>
      <td>${escapeHtml(c.lastName)}</td>
      <td>${escapeHtml(c.firstName)}</td>
      <td class="email-cell">${escapeHtml(c.email)}</td>
      <td>${escapeHtml(c.company)}</td>
      <td>${escapeHtml(c.position || '')}</td>
      <td>${escapeHtml(c.role || '')}</td>
      <td class="num-cell">${num2(c.avis)}</td>
      <td class="num-cell">${num2(c.observations)}</td>
      <td class="num-cell">${num2(c.statements)}</td>
      <td class="num-cell">${num2(total)}</td>
      <td class="num-cell">${c.nbOperations ?? '-'}</td>
      <td class="num-cell">${(c.avgPerOperation ?? 0).toFixed(1)}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => showContactDetail(tr.dataset.email));
  });
  renderPagination('contactPagination', filteredContacts.length, contactCurrentPage, goToContactPage);
}

function escapeHtml(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
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
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${(val / maxType) * 100}%;background:var(--chart-1)"></div></div>
        <span class="chart-bar-value">${val}</span>
      </div>
    `).join('');
  document.getElementById('modalContactBody').innerHTML = `
    <div class="detail-section">
      <p><strong>Email:</strong> ${escapeHtml(c.email)}</p>
      <p><strong>Société:</strong> ${escapeHtml(c.company)}</p>
    </div>
    <div class="detail-section">
      <h4>Score de risque & métriques par affaire</h4>
      <div class="detail-grid">
        <div class="detail-stat"><span class="value"><span class="risk-badge ${scoreClass}">${c.riskScore ?? '-'}</span></span><span class="label">Score risque (0-100)</span></div>
        <div class="detail-stat"><span class="value">${c.nbOperations ?? '-'}</span><span class="label">Nb affaires distinctes</span></div>
        <div class="detail-stat"><span class="value">${(c.avgPerOperation ?? 0).toFixed(1)}</span><span class="label">Moy.éléments/affaire</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Répartition par type</h4>
      <div class="detail-grid">
        <div class="detail-stat"><span class="value">${c.avis}</span><span class="label">Avis défavorables</span></div>
        <div class="detail-stat"><span class="value">${c.observations}</span><span class="label">Observations</span></div>
        <div class="detail-stat"><span class="value">${c.statements}</span><span class="label">Statements HAND</span></div>
        <div class="detail-stat"><span class="value">${total}</span><span class="label">Total</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Types de bâtiments</h4>
      <div class="chart-bars">${buildingBars || '<p>Aucune classification</p>'}</div>
    </div>
  `;
  modal.classList.add('active');
}

// UI: Entreprises
let filteredEntreprises = [];
let entrepriseCurrentPage = 1;

function getEntreprisesForView() {
  const excludeSans = document.getElementById('excludeSansSociete')?.checked ?? false;
  let base = filterEntreprises(document.getElementById('searchEntreprise').value);
  if (excludeSans) base = base.filter(e => e.name !== SANS_SOCIETE);
  return base;
}

function renderEntreprises() {
  filteredEntreprises = getEntreprisesForView();
  entrepriseCurrentPage = 1;
  document.getElementById('entrepriseCount').textContent = `${filteredEntreprises.length} entreprise(s)`;
  renderEntreprisesPage();
}

function goToEntreprisePage(p) {
  entrepriseCurrentPage = p;
  renderEntreprisesPage();
  renderPagination('entreprisePagination', filteredEntreprises.length, entrepriseCurrentPage, goToEntreprisePage);
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
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Aucune entreprise trouvée. Chargez les fichiers JSON.</td></tr>';
    return;
  }
  tbody.innerHTML = pageData.map(e => {
    const total = e.totalDefavorables || (e.avis + e.observations + e.statements);
    const num2 = (v) => v > 0 ? `<span class="num-cell has-value">${v}</span>` : `<span class="num-cell">0</span>`;
    const displayScore = hasExcludeRecalc ? getDisplayRiskScore(e, filteredEntreprises) : (e.riskScore ?? '-');
    const scoreClass = displayScore >= 70 ? 'risk-high' : displayScore >= 40 ? 'risk-medium' : 'risk-low';
    return `<tr data-name="${escapeHtml(e.name)}">
      <td><span class="risk-badge ${scoreClass}">${displayScore}</span></td>
      <td>${escapeHtml(e.name)}</td>
      <td class="num-cell">${num2(e.avis)}</td>
      <td class="num-cell">${num2(e.observations)}</td>
      <td class="num-cell">${num2(e.statements)}</td>
      <td class="num-cell">${num2(total)}</td>
      <td class="num-cell">${e.nbOperations ?? '-'}</td>
      <td class="num-cell">${(e.avgPerOperation ?? 0).toFixed(1)}</td>
      <td class="num-cell">${e.contacts.length}</td>
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
  const scoreClass = (typeof displayScore === 'number' ? displayScore : e.riskScore ?? 0) >= 70 ? 'risk-high' : (typeof displayScore === 'number' ? displayScore : e.riskScore ?? 0) >= 40 ? 'risk-medium' : 'risk-low';
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
        <div class="detail-stat"><span class="value">${e.nbOperations ?? '-'}</span><span class="label">Nb affaires distinctes</span></div>
        <div class="detail-stat"><span class="value">${(e.avgPerOperation ?? 0).toFixed(1)}</span><span class="label">Moy.éléments/affaire</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Répartition par type</h4>
      <div class="detail-grid">
        <div class="detail-stat"><span class="value">${e.avis}</span><span class="label">Avis</span></div>
        <div class="detail-stat"><span class="value">${e.observations}</span><span class="label">Observations</span></div>
        <div class="detail-stat"><span class="value">${e.statements}</span><span class="label">Statements HAND</span></div>
        <div class="detail-stat"><span class="value">${total}</span><span class="label">Total</span></div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Graphique par type</h4>
      <div class="chart-bars">
        <div class="chart-bar-row">
          <span class="chart-bar-label">Avis</span>
          <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${(e.avis / maxVal) * 100}%;background:var(--chart-1)"></div></div>
          <span class="chart-bar-value">${e.avis}</span>
        </div>
        <div class="chart-bar-row">
          <span class="chart-bar-label">Observations</span>
          <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${(e.observations / maxVal) * 100}%;background:var(--chart-2)"></div></div>
          <span class="chart-bar-value">${e.observations}</span>
        </div>
        <div class="chart-bar-row">
          <span class="chart-bar-label">Statements HAND</span>
          <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${(e.statements / maxVal) * 100}%;background:var(--chart-3)"></div></div>
          <span class="chart-bar-value">${e.statements}</span>
        </div>
      </div>
    </div>
    <div class="detail-section">
      <h4>Contacts (${e.contacts.length})</h4>
      <div class="contact-list">${contactsHtml}</div>
    </div>
  `;
  modal.classList.add('active');
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  const loginOverlay = document.getElementById('loginOverlay');
  const mainContent = document.getElementById('mainContent');
  const loginForm = document.getElementById('loginForm');
  const loginPassword = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');
  const loginSubmit = document.getElementById('loginSubmit');

  const AUTH_KEY = 'risques_auth';

  function checkAuth() {
    return sessionStorage.getItem(AUTH_KEY) === '1';
  }
  function setAuth() {
    sessionStorage.setItem(AUTH_KEY, '1');
  }
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
      } catch (_) {
        urls = null;
      }
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

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('view' + tab.dataset.view.charAt(0).toUpperCase() + tab.dataset.view.slice(1)).classList.add('active');
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

  function debounce(fn, ms) {
    let t;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }
});
