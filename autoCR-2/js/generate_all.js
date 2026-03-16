// generate_all.js — Orchestration + ZIP (ES module)
import * as XLSX from 'https://esm.sh/xlsx';
import JSZip from 'https://esm.sh/jszip@3';
import { extractAll } from './extract_data.js';
import { buildPrevNPlus1Sheet, enrichEntityNP1 } from './build_prev_nplus1.js';
import { buildCR } from './generate_cr.js';

export async function generateAll(xlsxBuffer, moisIdx, drFilter, logoData, onProgress) {
  const wb = XLSX.read(new Uint8Array(xlsxBuffer), { type:'array' });

  const data = extractAll(wb, moisIdx);
  const moisLabel = data.moisLabel;

  const prevNP1 = buildPrevNPlus1Sheet(wb);

  // Reconstruire le svcMap pour N+1
  const ratRows = XLSX.utils.sheet_to_json(
    wb.Sheets['TABLE DE RATTACHEMENT'], { header:1, defval:null });
  const svcMap = {};
  for (const row of ratRows) {
    const [svc, metier, dg, dr, agence] = row;
    if (svc && dr && typeof svc === 'string' && svc !== 'SERVICE')
      svcMap[svc.trim()] = { metier, dr, agence };
  }

  let total = 0;
  for (const [dr, drData] of Object.entries(data.dr)) {
    if (drFilter && dr !== drFilter) continue;
    total++;
    total += Object.keys(drData.agences || {}).length;
  }

  const zip  = new JSZip();
  let done   = 0;
  let errors = [];

  const slug = s => s.replace(/[^a-zA-Z0-9]/g,'_').replace(/__+/g,'_');

  for (const [dr, drData] of Object.entries(data.dr)) {
    if (drFilter && dr !== drFilter) continue;

    // CR des agences
    for (const [ag, agData] of Object.entries(drData.agences || {})) {
      enrichEntityNP1(agData, wb, svcMap, prevNP1);
      agData.previsionnels = agData.previsionnelsNP1 || agData.previsionnels;

      const filename = `CR_${slug(ag)}_${moisLabel.toUpperCase()}.docx`;
      try {
        const blob = await buildCR(agData, moisLabel, logoData);
        const buf  = await blob.arrayBuffer();
        zip.file(filename, buf);
        done++;
        if (onProgress) onProgress(done, total, ag, true);
      } catch(e) {
        done++;
        errors.push({ nom: ag, err: e.message });
        if (onProgress) onProgress(done, total, ag, false, e.message);
      }
    }

    // CR DR
    enrichEntityNP1(drData, wb, svcMap, prevNP1);
    drData.previsionnels = drData.previsionnelsNP1 || drData.previsionnels;

    const drFilename = `CR_DR_${slug(dr)}_${moisLabel.toUpperCase()}.docx`;
    try {
      const blob = await buildCR(drData, moisLabel, logoData);
      const buf  = await blob.arrayBuffer();
      zip.file(drFilename, buf);
      done++;
      if (onProgress) onProgress(done, total, `${dr} (DR)`, true);
    } catch(e) {
      done++;
      errors.push({ nom: dr, err: e.message });
      if (onProgress) onProgress(done, total, dr, false, e.message);
    }
  }

  const zipBlob = await zip.generateAsync({ type:'blob', compression:'DEFLATE',
    compressionOptions:{ level:6 } });

  return { zipBlob, total, done, errors, moisLabel };
}
