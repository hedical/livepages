/**
 * Interface d'analyse des avis défavorables - Contacts & Entreprises
 * Gère les gros fichiers JSON (jusqu'à 67 Mo) via chargement par fichier
 */

// Données consolidées
let contactsByEmail = {};
let entreprisesByName = {};
let allContacts = [];
let allEntreprises = [];
// Données brutes par source (pour re-fusion lors des rechargements)
let avisData = [];
let observationsData = [];
let statementsData = [];

// Constantes
const PAGE_SIZE = 50;
const COUNT_COL_AVIS = 'Avis (Notice) défavorables';
const COUNT_COL_OBS = 'Observations défavorables';
const COUNT_COL_HAND = 'HAND défavorables';

// Helpers
function getVal(obj, key) {
  const v = obj[key];
  return (v && String(v).trim()) || '';
}

function parseClassification(str) {
  if (!str) return [];
  try {
    const m = str.match(/\{([^}]*)\}/);
    if (!m) return [];
    return m[1].split(',').map(s => s.replace(/^"|"$/g, '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function parseCount(val) {
  if (val === '' || val == null) return 0;
  const n = parseInt(String(val).replace(/\s/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

// Webhook de vérification du mot de passe (retourne les URLs si OK)
const WEBHOOK_AUTH = 'https://databuildr.app.n8n.cloud/webhook/risk-data';

// URLs des données (utilisées si webhook non appelé ou en secours)
const DATA_URLS = {
  avis: 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/avis__notices__defavorables_par_contact_2026-02-13T11_37_32.8744Z.json',
  observations: 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/observations_defavorables_par_affaire_2026-02-13T11_36_04.991586Z.json',
  statements: 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/statements_defavorables__rah___hand__par_contacts_2026-02-13T11_34_48.038661Z.json'
};

function parseUrlsFromResponse(text) {
  const mAv = (text || '').match(/AVIS_URL\s*=\s*['"]([^'"]+)['"]/i);
  const mObs = (text || '').match(/OBSERVATIONS_URL\s*=\s*['"]([^'"]+)['"]/i);
  const mStmt = (text || '').match(/(?:STATEMENTS_URL|STATEMENTS)\s*=\s*['"]([^'"]+)['"]/i);
  if (mAv && mObs && mStmt) return { avis: mAv[1], observations: mObs[1], statements: mStmt[1] };
  try {
    const o = JSON.parse(text);
    const avis = o.AVIS_URL || o.avis_url || o.avis;
    const obs = o.OBSERVATIONS_URL || o.observations_url || o.observations;
    const stmt = o.STATEMENTS_URL || o.STATEMENTS || o.statements_url || o.statements;
    if (avis && obs && stmt) return { avis, observations: obs, statements: stmt };
  } catch (_) {}
  return null;
}

// Chargement d'un fichier JSON depuis une URL
async function loadJsonFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

// Traitement des données
function reprocessAll() {
  contactsByEmail = {};
  processAvis(avisData);
  processObservations(observationsData);
  processStatements(statementsData);
  consolidateData();
  renderContacts();
  renderEntreprises();
}

function processAvis(data) {
  for (const row of data) {
    const email = getVal(row, 'Contact → Email');
    if (!email) continue;
    if (!contactsByEmail[email]) {
      contactsByEmail[email] = {
        email,
        lastName: getVal(row, 'Contact → LastName'),
        firstName: getVal(row, 'Contact → FirstName'),
        company: getVal(row, 'Company - CompanyId → Name'),
        position: getVal(row, 'Contact → Position'),
        role: getVal(row, 'Contact → Role'),
        avis: 0,
        observations: 0,
        statements: 0,
        items: [],
        buildingTypes: {}
      };
    }
    const c = contactsByEmail[email];
    if (!c.position && getVal(row, 'Contact → Position')) c.position = getVal(row, 'Contact → Position');
    if (!c.role && getVal(row, 'Contact → Role')) c.role = getVal(row, 'Contact → Role');
    const cnt = parseCount(row[COUNT_COL_AVIS]);
    c.avis += cnt;
    c.items.push({
      type: 'avis',
      count: cnt,
      operation: getVal(row, 'SubAffairDetail - SubAffairDetailId → OperationName'),
      buildingTypes: parseClassification(row['SubAffairDetail - SubAffairDetailId → ClassificationOfBuilding'])
    });
    for (const bt of c.items[c.items.length - 1].buildingTypes) {
      c.buildingTypes[bt] = (c.buildingTypes[bt] || 0) + cnt;
    }
  }
}

function processObservations(data) {
  for (const row of data) {
    const email = getVal(row, 'Contact → Email');
    if (!email) continue;
    if (!contactsByEmail[email]) {
      contactsByEmail[email] = {
        email,
        lastName: getVal(row, 'Contact → LastName'),
        firstName: getVal(row, 'Contact → FirstName'),
        company: getVal(row, 'Company - CompanyId → Name'),
        position: getVal(row, 'Contact → Position'),
        role: getVal(row, 'Contact → Role'),
        avis: 0,
        observations: 0,
        statements: 0,
        items: [],
        buildingTypes: {}
      };
    }
    const c = contactsByEmail[email];
    if (!c.position && getVal(row, 'Contact → Position')) c.position = getVal(row, 'Contact → Position');
    if (!c.role && getVal(row, 'Contact → Role')) c.role = getVal(row, 'Contact → Role');
    const cnt = parseCount(row[COUNT_COL_OBS]);
    c.observations += cnt;
    c.items.push({
      type: 'observations',
      count: cnt,
      operation: getVal(row, 'SubAffairDetail - SubAffairDetailId → OperationName'),
      buildingTypes: parseClassification(row['SubAffairDetail - SubAffairDetailId → ClassificationOfBuilding'])
    });
    for (const bt of c.items[c.items.length - 1].buildingTypes) {
      c.buildingTypes[bt] = (c.buildingTypes[bt] || 0) + cnt;
    }
  }
}

function processStatements(data) {
  for (const row of data) {
    const email = getVal(row, 'Contact → Email');
    if (!email) continue;
    if (!contactsByEmail[email]) {
      contactsByEmail[email] = {
        email,
        lastName: getVal(row, 'Contact → LastName'),
        firstName: getVal(row, 'Contact → FirstName'),
        company: getVal(row, 'Company - CompanyId → Name'),
        position: getVal(row, 'Contact → Position'),
        role: getVal(row, 'Contact → Role'),
        avis: 0,
        observations: 0,
        statements: 0,
        items: [],
        buildingTypes: {}
      };
    }
    const c = contactsByEmail[email];
    if (!c.position && getVal(row, 'Contact → Position')) c.position = getVal(row, 'Contact → Position');
    if (!c.role && getVal(row, 'Contact → Role')) c.role = getVal(row, 'Contact → Role');
    const cnt = parseCount(row[COUNT_COL_HAND]);
    c.statements += cnt;
    c.items.push({
      type: 'statements',
      count: cnt,
      operation: getVal(row, 'SubAffairDetail - SubAffairDetailId → OperationName'),
      buildingTypes: parseClassification(row['SubAffairDetail - SubAffairDetailId → ClassificationOfBuilding'])
    });
    for (const bt of c.items[c.items.length - 1].buildingTypes) {
      c.buildingTypes[bt] = (c.buildingTypes[bt] || 0) + cnt;
    }
  }
}

function computeContactMetrics(c) {
  const ops = new Set();
  for (const it of c.items) {
    const op = (it.operation || '').trim();
    if (op) ops.add(op);
  }
  c.nbOperations = Math.max(1, ops.size);
  c.totalDefavorables = c.avis + c.observations + c.statements;
  c.avgPerOperation = c.totalDefavorables / c.nbOperations;
}

/**
 * Score de risque : échelle logarithmique sur la moyenne par affaire
 * Log compresse l'écart (738 vs 41 → score 100 vs ~57) tout en gardant la cohérence du classement
 */
function computeRiskScore(total, nbOps, avgPerOp) {
  return Math.log(1 + (avgPerOp || 0));
}

function buildEntreprises() {
  entreprisesByName = {};
  for (const email of Object.keys(contactsByEmail)) {
    const c = contactsByEmail[email];
    const companyName = c.company || '(Sans société)';
    if (!entreprisesByName[companyName]) {
      entreprisesByName[companyName] = {
        name: companyName,
        avis: 0,
        observations: 0,
        statements: 0,
        contacts: [],
        operationsSet: new Set()
      };
    }
    const e = entreprisesByName[companyName];
    e.avis += c.avis;
    e.observations += c.observations;
    e.statements += c.statements;
    for (const it of c.items) {
      const op = (it.operation || '').trim();
      if (op) e.operationsSet.add(op);
    }
    e.contacts.push({
      email: c.email,
      lastName: c.lastName,
      firstName: c.firstName,
      avis: c.avis,
      observations: c.observations,
      statements: c.statements
    });
  }
}

function consolidateData() {
  for (const c of Object.values(contactsByEmail)) {
    computeContactMetrics(c);
  }
  allContacts = Object.values(contactsByEmail)
    .filter(c => c.avis > 0 || c.observations > 0 || c.statements > 0)
    .sort((a, b) => (b.totalDefavorables || 0) - (a.totalDefavorables || 0));

  buildEntreprises();

  for (const e of Object.values(entreprisesByName)) {
    e.nbOperations = Math.max(1, e.operationsSet.size);
    e.totalDefavorables = e.avis + e.observations + e.statements;
    e.avgPerOperation = e.totalDefavorables / e.nbOperations;
    e.riskRaw = computeRiskScore(e.totalDefavorables, e.nbOperations, e.avgPerOperation);
    delete e.operationsSet;
  }
  allEntreprises = Object.values(entreprisesByName)
    .filter(e => e.avis > 0 || e.observations > 0 || e.statements > 0);

  // Référence = max des valeurs log (l'échelle log compresse déjà les écarts extrêmes)
  const contactRawValues = allContacts.map(c => computeRiskScore(c.totalDefavorables, c.nbOperations, c.avgPerOperation));
  const entrepriseRawValues = allEntreprises.map(e => e.riskRaw);
  const refContact = Math.max(...contactRawValues, 0.001);
  const refEntreprise = Math.max(...entrepriseRawValues, 0.001);

  for (const c of allContacts) {
    c.riskRaw = computeRiskScore(c.totalDefavorables, c.nbOperations, c.avgPerOperation);
    c.riskScore = Math.min(100, Math.round((c.riskRaw / refContact) * 100));
  }
  for (const e of allEntreprises) {
    e.riskScore = Math.min(100, Math.round((e.riskRaw / refEntreprise) * 100));
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

  overlay.style.display = 'flex';
  progress.style.display = 'flex';
  progressFill.style.width = '0%';
  const overlayText = document.getElementById('loadingOverlayText');
  if (overlayText) overlayText.textContent = 'Chargement des 3 fichiers...';
  [statusAvis, statusObservations, statusStatements].forEach(s => {
    s.textContent = 'En attente';
    s.classList.remove('loaded');
  });

  function setStatus(el, text, ok) {
    el.textContent = text;
    if (ok) el.classList.add('loaded');
  }

  try {
    progressText.textContent = 'Chargement des 3 fichiers...';
    let done = 0;
    const onDone = (el, d) => {
      done++;
      progressFill.style.width = `${(done / 3) * 100}%`;
      setStatus(el, `Chargé (${(Array.isArray(d) ? d : [d]).length} enregistrements)`, true);
    };
    const [avis, obs, stmt] = await Promise.all([
      loadJsonFromUrl(urlsToUse.avis).then(d => { onDone(statusAvis, d); return d; }),
      loadJsonFromUrl(urlsToUse.observations).then(d => { onDone(statusObservations, d); return d; }),
      loadJsonFromUrl(urlsToUse.statements).then(d => { onDone(statusStatements, d); return d; })
    ]);
    avisData = Array.isArray(avis) ? avis : [avis];
    observationsData = Array.isArray(obs) ? obs : [obs];
    statementsData = Array.isArray(stmt) ? stmt : [stmt];
    progressFill.style.width = '100%';
    progressText.textContent = 'Traitement en cours...';
    if (overlayText) overlayText.textContent = 'Traitement en cours...';
    reprocessAll();
    progressText.textContent = 'Chargement terminé';
    if (overlayText) overlayText.textContent = 'Chargement terminé';
  } catch (err) {
    progressText.textContent = `Erreur: ${err.message}`;
    [statusAvis, statusObservations, statusStatements].forEach(s => setStatus(s, 'Erreur', false));
    console.error(err);
  } finally {
    overlay.style.display = 'none';
    setTimeout(() => { progress.style.display = 'none'; }, 2000);
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
  return allEntreprises.filter(e =>
    e.name.toLowerCase().includes(q)
  );
}

// UI: Pagination
function paginate(arr, page) {
  const start = (page - 1) * PAGE_SIZE;
  return arr.slice(start, start + PAGE_SIZE);
}

function renderPagination(containerId, total, currentPage, onPageChange) {
  const container = document.getElementById(containerId);
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
    const num = (v) => v > 0 ? `<span class="num-cell has-value">${v}</span>` : `<span class="num-cell">0</span>`;
    const scoreClass = c.riskScore >= 70 ? 'risk-high' : c.riskScore >= 40 ? 'risk-medium' : 'risk-low';
    return `<tr data-email="${escapeHtml(c.email)}">
      <td><span class="risk-badge ${scoreClass}">${c.riskScore ?? '-'}</span></td>
      <td>${escapeHtml(c.lastName)}</td>
      <td>${escapeHtml(c.firstName)}</td>
      <td class="email-cell">${escapeHtml(c.email)}</td>
      <td>${escapeHtml(c.company)}</td>
      <td>${escapeHtml(c.position || '')}</td>
      <td>${escapeHtml(c.role || '')}</td>
      <td class="num-cell">${num(c.avis)}</td>
      <td class="num-cell">${num(c.observations)}</td>
      <td class="num-cell">${num(c.statements)}</td>
      <td class="num-cell">${num(total)}</td>
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
const SANS_SOCIETE = '(Sans société)';

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
  const values = list.map(x => x.riskRaw || 0).filter(v => v > 0);
  if (values.length === 0) return 0;
  const ref = Math.max(...values, 0.001);
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
    const num = (v) => v > 0 ? `<span class="num-cell has-value">${v}</span>` : `<span class="num-cell">0</span>`;
    const displayScore = hasExcludeRecalc ? getDisplayRiskScore(e, filteredEntreprises) : (e.riskScore ?? '-');
    const scoreClass = displayScore >= 70 ? 'risk-high' : displayScore >= 40 ? 'risk-medium' : 'risk-low';
    return `<tr data-name="${escapeHtml(e.name)}">
      <td><span class="risk-badge ${scoreClass}">${displayScore}</span></td>
      <td>${escapeHtml(e.name)}</td>
      <td class="num-cell">${num(e.avis)}</td>
      <td class="num-cell">${num(e.observations)}</td>
      <td class="num-cell">${num(e.statements)}</td>
      <td class="num-cell">${num(total)}</td>
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
        if (!urls.avis || !urls.observations || !urls.statements) urls = null;
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
        const urls = parseUrlsFromResponse(text);
        if (!urls) throw new Error('Réponse invalide');
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
    overlay.style.display = 'flex';
    if (overlayText) overlayText.textContent = 'Appel du webhook (GET)...';
    try {
      let urls = DATA_URLS;
      const res = await fetch('https://databuildr.app.n8n.cloud/webhook/get-risks-files', { method: 'GET' });
      if (res.ok) {
        const text = await res.text();
        const parsed = parseUrlsFromResponse(text);
        if (parsed) urls = parsed;
      }
      if (overlayText) overlayText.textContent = 'Chargement des 3 fichiers...';
      await loadAllDataFromUrls(urls);
    } catch (err) {
      if (overlayText) overlayText.textContent = 'Erreur: ' + err.message;
    } finally {
      overlay.style.display = 'none';
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
