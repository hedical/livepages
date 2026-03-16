// extract_data.js — Lecture et agrégation Excel (ES module)
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mjs';
import { round1, kE } from './helpers.js';

export const MOIS = ['JANVIER','FÉVRIER','MARS','AVRIL','MAI','JUIN',
                     'JUILLET','AOÛT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DÉCEMBRE'];

function getRows(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Feuille "${name}" introuvable`);
  return XLSX.utils.sheet_to_json(ws, { header:1, defval:null });
}

function findMoisCol(hdrRow, moisLabel) {
  const idx = hdrRow.indexOf(moisLabel);
  if (idx < 0) throw new Error(
    `Mois "${moisLabel}" introuvable dans l'en-tête. ` +
    `Mois présents : ${hdrRow.filter(v=>v&&typeof v==='string'&&MOIS.includes(v)).join(', ')}`
  );
  return idx;
}

function buildSvcMap(wb) {
  const map = {};
  for (const row of getRows(wb, 'TABLE DE RATTACHEMENT')) {
    const [svc, metier, dg, dr, agence] = row;
    if (svc && dr && typeof svc==='string' && svc!=='SERVICE')
      map[svc.trim()] = { metier, dg, dr, agence };
  }
  return map;
}

function buildSvcSheet(wb, sheetName, moisLabel) {
  const SKIP = new Set(['Prise de Commandes Brute ','Prise de Commandes Brute',
    'Avenants','Facturation','Avoirs','TOTAL',
    'RESULTATS COMMERCIAUX','RESULTATS DE PRODUCTION']);
  const rows = getRows(wb, sheetName);
  const hdrI = rows.findIndex(r => r.includes('JANVIER'));
  if (hdrI < 0) throw new Error(`En-tête JANVIER introuvable dans ${sheetName}`);
  const hdr = rows[hdrI];
  const colMois  = findMoisCol(hdr, moisLabel);
  const colTotal = colMois + 1;
  const data = {};
  for (let i = hdrI+1; i < rows.length; i++) {
    const row   = rows[i];
    const label = row[0]!=null ? String(row[0]).trim() : null;
    if (!label || SKIP.has(label) || label.startsWith('RESULTAT')) continue;
    if (!data[label]) {
      const mois = Array.from({length:12}, (_,m) => {
        const col = m + 1;
        return col <= colMois ? (Number(row[col])||0) : 0;
      });
      const total = Number(row[colTotal]) || mois.reduce((a,b)=>a+b,0);
      data[label] = { mois, total };
    }
  }
  return data;
}

function buildCalagesSheet(wb, moisLabel) {
  const rows = getRows(wb, 'RM Calages');
  const hdrI = rows.findIndex(r => r.includes('JANVIER'));
  if (hdrI < 0) return {};
  const bc = findMoisCol(rows[hdrI], moisLabel);
  const data = {};
  for (let i=hdrI+2; i<rows.length; i++) {
    const row   = rows[i];
    const label = row[0]!=null ? String(row[0]).trim() : null;
    if (!label) continue;
    if (!data[label]) data[label] = {
      prevu:   Number(row[bc])   || 0,
      realise: Number(row[bc+1]) || 0,
      avoirs:  Number(row[bc+2]) || 0,
      decPct:  row[bc+3],
    };
  }
  return data;
}

function buildPrevSheet(wb, moisLabel) {
  const rows = getRows(wb, 'RM Prévisionnels production');
  const hdrI = rows.findIndex(r => r.includes('1er JANVIER'));
  if (hdrI < 0) return {};
  const hdr    = rows[hdrI];
  const colDec = findMoisCol(hdr, moisLabel);
  const data = {};
  for (let i=hdrI+2; i<rows.length; i++) {
    const row   = rows[i];
    const label = row[0]!=null ? String(row[0]).trim() : null;
    if (!label || label.startsWith('Total') || label.startsWith('PREV')) continue;
    if (!data[label])
      data[label] = { prev1janv: Number(row[1])||0, prevDec: Number(row[colDec])||0 };
  }
  return data;
}

function buildLTSheet(wb, moisLabel) {
  const rows = getRows(wb, 'RM Calages long terme');
  const hdrI = rows.findIndex(r => r.includes('JANVIER'));
  if (hdrI < 0) return {};
  const bc = findMoisCol(rows[hdrI], moisLabel);
  const data = {};
  for (let i=hdrI+2; i<rows.length; i++) {
    const row   = rows[i];
    const label = row[0]!=null ? String(row[0]).trim() : null;
    if (!label) continue;
    if (!data[label])
      data[label] = {
        factureAne: Number(row[bc])   || 0,
        decalages:  Number(row[bc+1]) || 0,
        pct:        row[bc+2],
      };
  }
  return data;
}

function aggSvc(labels, sht, moisIdx) {
  const mois = Array(12).fill(0); let total=0;
  for (const l of labels) {
    const d=sht[l]; if (!d) continue;
    d.mois.forEach((v,i) => mois[i]+=v);
    total += d.total;
  }
  const s1 = mois.slice(0, Math.min(6, moisIdx+1)).reduce((a,b)=>a+b,0);
  const s2 = moisIdx >= 6 ? mois.slice(6, moisIdx+1).reduce((a,b)=>a+b,0) : 0;
  return { mois, total, s1, s2, mc: mois[moisIdx] };
}

function bestWorst(moisArr, moisIdx) {
  const reels = moisArr.slice(0, moisIdx+1);
  let bi=0, wi=0;
  reels.forEach((v,i) => { if(v>reels[bi]) bi=i; if(v<reels[wi]) wi=i; });
  return { best:{val:reels[bi], mois:MOIS[bi]}, worst:{val:reels[wi], mois:MOIS[wi]} };
}

function aggCal(labels, sht) {
  let p=0, r=0, a=0;
  for (const l of labels) {
    const c=sht[l]; if (!c) continue;
    p+=c.prevu; r+=c.realise; a+=c.avoirs;
  }
  const pn=r-a, dec=p>0 ? round1((pn-p)/p*100) : null;
  return { prevu:kE(p), realise:kE(r), avoirs:kE(a), prodNette:kE(pn), decalage:dec };
}

function aggPrev(labels, sht) {
  let p1=0, pd=0;
  for (const l of labels) {
    const d=sht[l]; if (!d) continue;
    p1+=d.prev1janv; pd+=d.prevDec;
  }
  return { prev1janv:kE(p1), prevDec:kE(pd), ecart:kE(pd-p1) };
}

function aggLT(labels, sht) {
  let fa=0, dec=0;
  for (const l of labels) {
    const t=sht[l]; if (!t) continue;
    fa+=t.factureAne; dec+=t.decalages;
  }
  return { factureAne:kE(fa), decalages:kE(dec), pct: fa>0 ? round1(dec/fa*100) : null };
}

function getRMsCalages(wb, svcs, moisLabel, svcMap) {
  const rows   = getRows(wb, 'RM Calages');
  const hdrI   = rows.findIndex(r => r.includes('JANVIER'));
  if (hdrI<0) return [];
  const bc     = findMoisCol(rows[hdrI], moisLabel);
  const svcSet = new Set(svcs);
  const result = [];
  let curSvc   = null;
  for (let i=hdrI+2; i<rows.length; i++) {
    const row   = rows[i];
    const label = row[0]!=null ? String(row[0]).trim() : null;
    if (!label) continue;
    if (svcMap[label]) { curSvc=svcSet.has(label)?label:null; continue; }
    if (!curSvc) continue;
    const p=Number(row[bc])||0, r=Number(row[bc+1])||0, a=Number(row[bc+2])||0;
    const pn=r-a, dec=p>0 ? round1((pn-p)/p*100) : null;
    result.push({ rm:label, service:curSvc,
      prevu:kE(p), realise:kE(r), avoirs:a>0?kE(a):'—', prodNette:kE(pn), decalage:dec });
  }
  return result;
}

function getRMsPrev(wb, svcs, moisLabel, svcMap) {
  const rows   = getRows(wb, 'RM Prévisionnels production');
  const hdrI   = rows.findIndex(r => r.includes('1er JANVIER'));
  if (hdrI<0) return [];
  const colDec = findMoisCol(rows[hdrI], moisLabel);
  const svcSet = new Set(svcs);
  const result = [];
  let curSvc   = null;
  for (let i=hdrI+2; i<rows.length; i++) {
    const row   = rows[i];
    const label = row[0]!=null ? String(row[0]).trim() : null;
    if (!label||label.startsWith('Total')||label.startsWith('PREV')) continue;
    if (svcMap[label]) { curSvc=svcSet.has(label)?label:null; continue; }
    if (!curSvc) continue;
    const p1=Number(row[1])||0, pd=Number(row[colDec])||0;
    result.push({ rm:label, service:curSvc,
      prev1janv:kE(p1), prevDec:kE(pd), ecart:kE(pd-p1) });
  }
  return result;
}

export function extractAll(wb, moisIdx) {
  const moisLabel = MOIS[moisIdx];
  const svcMap    = buildSvcMap(wb);

  const comSht = buildSvcSheet(wb, 'SERVICES Résultats commerciaux', moisLabel);
  const proSht = buildSvcSheet(wb, 'SERVICES Résultats production',  moisLabel);
  const calSht = buildCalagesSheet(wb, moisLabel);
  const preSht = buildPrevSheet(wb, moisLabel);
  const ltSht  = buildLTSheet(wb, moisLabel);

  const drIdx = {};
  for (const [svc, info] of Object.entries(svcMap)) {
    const { dr, agence } = info;
    if (!drIdx[dr]) drIdx[dr] = { agences:{} };
    if (!drIdx[dr].agences[agence]) drIdx[dr].agences[agence] = [];
    drIdx[dr].agences[agence].push(svc);
  }

  function buildEntity(nom, svcs) {
    const sps = svcs.filter(s => svcMap[s]?.metier==='SPS');
    const ctc = svcs.filter(s => svcMap[s]?.metier==='CTC');
    const ca=aggSvc(svcs,comSht,moisIdx), cs=aggSvc(sps,comSht,moisIdx), cc=aggSvc(ctc,comSht,moisIdx);
    const pa=aggSvc(svcs,proSht,moisIdx), ps=aggSvc(sps,proSht,moisIdx), pc=aggSvc(ctc,proSht,moisIdx);
    return {
      nom, services:svcs,
      commerce: {
        agence: { s1:kE(ca.s1), s2:kE(ca.s2), total:kE(ca.total), mc:kE(ca.mc) },
        sps:    { s1:kE(cs.s1), s2:kE(cs.s2), total:kE(cs.total), mc:kE(cs.mc) },
        ctc:    { s1:kE(cc.s1), s2:kE(cc.s2), total:kE(cc.total), mc:kE(cc.mc) },
        bestMois:  bestWorst(ca.mois, moisIdx).best,
        worstMois: bestWorst(ca.mois, moisIdx).worst,
        spsShare: ca.total>0 ? round1(cs.total/ca.total*100) : 0,
        ctcShare: ca.total>0 ? round1(cc.total/ca.total*100) : 0,
      },
      production: {
        agence: { s1:kE(pa.s1), s2:kE(pa.s2), total:kE(pa.total), mc:kE(pa.mc) },
        sps:    { s1:kE(ps.s1), s2:kE(ps.s2), total:kE(ps.total), mc:kE(ps.mc) },
        ctc:    { s1:kE(pc.s1), s2:kE(pc.s2), total:kE(pc.total), mc:kE(pc.mc) },
        bestMois:  bestWorst(pa.mois, moisIdx).best,
        worstMois: bestWorst(pa.mois, moisIdx).worst,
      },
      calages: {
        agence: aggCal(svcs,calSht),
        sps:    aggCal(sps, calSht),
        ctc:    aggCal(ctc, calSht),
        rmsSPS: getRMsCalages(wb, sps, moisLabel, svcMap),
        rmsCTC: getRMsCalages(wb, ctc, moisLabel, svcMap),
      },
      previsionnels: {
        agence: aggPrev(svcs,preSht),
        sps:    aggPrev(sps, preSht),
        ctc:    aggPrev(ctc, preSht),
        rmsSPS: getRMsPrev(wb, sps, moisLabel, svcMap),
        rmsCTC: getRMsPrev(wb, ctc, moisLabel, svcMap),
      },
      lt: {
        agence: aggLT(svcs,ltSht),
        sps:    aggLT(sps, ltSht),
        ctc:    aggLT(ctc, ltSht),
      },
    };
  }

  const result = { moisIdx, moisLabel, dr:{} };
  for (const [dr, info] of Object.entries(drIdx)) {
    if (dr==='DIRECTION REGIONALE') continue;
    const agences={}, allSvcs=[];
    for (const [ag, svcs] of Object.entries(info.agences)) {
      if (ag==='AGENCE') continue;
      agences[ag] = buildEntity(ag, svcs);
      allSvcs.push(...svcs);
    }
    result.dr[dr] = { ...buildEntity(dr, allSvcs), agences };
  }
  return result;
}
