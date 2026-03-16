// build_prev_nplus1.js — Prévisionnels N+1 (ES module)
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mjs';

export function buildPrevNPlus1Sheet(wb) {
  const rows = XLSX.utils.sheet_to_json(
    wb.Sheets['RM Prévisionnels production'], { header:1, defval:null });

  const startI = rows.findIndex(r => r[0] && String(r[0]).includes('fin 2026'));
  if (startI < 0) return {};

  const data = {};
  for (let i = startI+1; i < rows.length; i++) {
    const row   = rows[i];
    const label = row[0]!=null ? String(row[0]).trim() : null;
    if (!label || label.startsWith('Total')) continue;
    if (!data[label])
      data[label] = { prev1janv: Number(row[1])||0, prevDec: Number(row[13])||0 };
  }
  return data;
}

function getRMsPrevNP1(wb, svcs, svcMap) {
  const rows   = XLSX.utils.sheet_to_json(
    wb.Sheets['RM Prévisionnels production'], { header:1, defval:null });
  const startI = rows.findIndex(r => r[0] && String(r[0]).includes('fin 2026'));
  if (startI < 0) return [];
  const svcSet = new Set(svcs);
  const result = [];
  let curSvc   = null;
  for (let i=startI+1; i<rows.length; i++) {
    const row   = rows[i];
    const label = row[0]!=null ? String(row[0]).trim() : null;
    if (!label||label.startsWith('Total')) continue;
    if (svcMap[label]) { curSvc=svcSet.has(label)?label:null; continue; }
    if (!curSvc) continue;
    const p1=Number(row[1])||0, pd=Number(row[13])||0;
    result.push({ rm:label, service:curSvc,
      prev1janv:Math.round(p1/1000), prevDec:Math.round(pd/1000),
      ecart:Math.round((pd-p1)/1000) });
  }
  return result;
}

export function enrichEntityNP1(entity, wb, svcMap, prevNP1) {
  const svcs = entity.services || [];
  const sps  = svcs.filter(s => svcMap[s]?.metier==='SPS');
  const ctc  = svcs.filter(s => svcMap[s]?.metier==='CTC');

  function aggPrevNP1(labels) {
    let p1=0, pd=0;
    for (const l of labels) {
      const d=prevNP1[l]; if (!d) continue;
      p1+=d.prev1janv; pd+=d.prevDec;
    }
    return { prev1janv:Math.round(p1/1000), prevDec:Math.round(pd/1000),
             ecart:Math.round((pd-p1)/1000) };
  }

  entity.previsionnelsNP1 = {
    agence: aggPrevNP1(svcs),
    sps:    aggPrevNP1(sps),
    ctc:    aggPrevNP1(ctc),
    rmsSPS: getRMsPrevNP1(wb, sps, svcMap),
    rmsCTC: getRMsPrevNP1(wb, ctc, svcMap),
  };
}
