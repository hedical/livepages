// helpers.js — Fonctions de formatage partagées
export const round1 = v => Math.round((v||0)*10)/10;
export const kE     = v => Math.round((v||0)/1000);
export const sign   = v => v >= 0 ? `+${v}` : `${v}`;
export const fmtK   = v => v==null ? '—' : `${v.toLocaleString('fr-FR')} k€`;
export const fmtPct = v => v==null ? '—' : `${sign(round1(v))} %`;
export const fmtDec = v => {
  if (v==null) return { text:'—', color:null };
  const pct = round1(v);
  if (pct >= 10)  return { text:`+${pct} %`, color:'GREEN' };
  if (pct <= -10) return { text:`${pct} %`,  color:'RED'   };
  return             { text:`${pct >= 0 ? '+':''}${pct} %`, color:'ORANGE' };
};
