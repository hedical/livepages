// app.js — Point d'entrée UI (ES module)
import { generateAll } from './generate_all.js';
import { MOIS } from './extract_data.js';

// ── État ──────────────────────────────────────────────────────────
let excelBuffer = null;
let logoData    = null;
let resultZip   = null;
let resultMois  = '';

// ── Dropzone helper ───────────────────────────────────────────────
function setupDropzone(dropzoneId, inputId, filenameId, onFile) {
  const zone  = document.getElementById(dropzoneId);
  const input = document.getElementById(inputId);
  const fname = document.getElementById(filenameId);

  function handle(file) {
    if (!file) return;
    fname.textContent = 'ok  ' + file.name;
    zone.classList.add('has-file');
    onFile(file);
  }

  input.addEventListener('change', () => handle(input.files[0]));
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handle(e.dataTransfer.files[0]);
  });
}

// ── Dropzones ─────────────────────────────────────────────────────
setupDropzone('dropzone-excel', 'input-excel', 'excel-filename', file => {
  const reader = new FileReader();
  reader.onload = e => { excelBuffer = e.target.result; checkReady(); };
  reader.readAsArrayBuffer(file);
});

setupDropzone('dropzone-logo', 'input-logo', 'logo-filename', file => {
  const reader = new FileReader();
  reader.onload = e => {
    const ext = file.name.split('.').pop().toLowerCase();
    logoData = { data: new Uint8Array(e.target.result), type: ext === 'jpg' ? 'jpeg' : ext };
  };
  reader.readAsArrayBuffer(file);
});

function checkReady() {
  document.getElementById('btn-generate').disabled = !excelBuffer;
}

// ── Log ───────────────────────────────────────────────────────────
function addLog(text, type='info') {
  const log  = document.getElementById('log');
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  const icons = { ok:'[OK]', err:'[ERR]', info:'[·]' };
  line.innerHTML = `<span class="log-icon">${icons[type]||'·'}</span><span>${escHtml(text)}</span>`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setProgress(done, total) {
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-status').innerHTML =
    `<strong>${done} / ${total}</strong> CR générés (${pct} %)`;
}

// ── Génération ────────────────────────────────────────────────────
document.getElementById('btn-generate').addEventListener('click', async () => {
  const errorBox = document.getElementById('error-box');
  errorBox.style.display = 'none';

  if (!excelBuffer) {
    errorBox.textContent = 'Veuillez sélectionner un fichier Excel.';
    errorBox.style.display = 'block';
    return;
  }

  const moisIdx  = parseInt(document.getElementById('select-mois').value);
  const drFilter = document.getElementById('input-dr').value.trim() || null;

  document.getElementById('progress-section').style.display = 'block';
  document.getElementById('download-section').style.display = 'none';
  document.getElementById('log').innerHTML = '';
  document.getElementById('btn-generate').disabled = true;
  setProgress(0, 1);

  addLog(`Mois : ${MOIS[moisIdx]}${drFilter ? '  |  DR : ' + drFilter : ''}`, 'info');
  addLog('Lecture du fichier Excel...', 'info');

  document.getElementById('progress-section').scrollIntoView({ behavior:'smooth' });

  try {
    const { zipBlob, total, done, errors, moisLabel } = await generateAll(
      excelBuffer, moisIdx, drFilter, logoData,
      (d, t, nom, ok, errMsg) => {
        setProgress(d, t);
        addLog(nom + (ok ? '' : ' — ' + errMsg), ok ? 'ok' : 'err');
      }
    );

    resultZip  = zipBlob;
    resultMois = moisLabel;

    const summary = document.getElementById('result-summary');
    summary.innerHTML = `
      <span class="result-pill ok">${done - errors.length} CR générés avec succès</span>
      ${errors.length ? `<span class="result-pill err">${errors.length} erreur(s)</span>` : ''}
    `;

    document.getElementById('download-section').style.display = 'block';
    document.getElementById('download-section').scrollIntoView({ behavior:'smooth' });
    document.querySelector('#progress-section .card-title').textContent = 'Terminé';
  } catch(e) {
    addLog('Erreur fatale : ' + e.message, 'err');
    errorBox.textContent = 'Erreur : ' + e.message;
    errorBox.style.display = 'block';
  } finally {
    document.getElementById('btn-generate').disabled = false;
  }
});

// ── Téléchargement ────────────────────────────────────────────────
document.getElementById('btn-download').addEventListener('click', () => {
  if (!resultZip) return;
  const url = URL.createObjectURL(resultZip);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = `CR_${resultMois.toUpperCase()}.zip`;
  a.click();
  URL.revokeObjectURL(url);
});

// Pré-sélectionner le mois en cours
document.getElementById('select-mois').value = new Date().getMonth();
