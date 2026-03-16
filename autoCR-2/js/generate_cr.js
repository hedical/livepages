// generate_cr.js — Génère un CR .docx (ES module)
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
  PageBreak, PageNumber, Header, Footer, TabStopType, TabStopPosition,
  ImageRun,
} from 'https://esm.sh/docx@8';

// ── Palette ───────────────────────────────────────────────────────
const NAVY   = "0D2B4E";
const BLUE   = "1A6EBD";
const XBLUE  = "EBF5FC";
const ORANGE = "D95F0E";
const LORNG  = "FDEBD0";
const AMBER  = "7F4F00";
const LAMB   = "FEF3E2";
const GREEN  = "1A6B35";
const LGRN   = "DFF2E6";
const RED    = "C0392B";
const LRED   = "FDECEA";
const GRAY1  = "2C3E50";
const GRAY2  = "7F8C8D";
const GRAY3  = "ECF0F1";
const WHITE  = "FFFFFF";

const SEC_COLOR = {
  commerce:     { bg:"0D2B4E", acc:"1A6EBD" },
  operations:   { bg:"0D4E2B", acc:"1A8C4E" },
  previsionnels:{ bg:"4E2B0D", acc:"BD6E1A" },
  affaires:     { bg:"4E0D2B", acc:"BD1A6E" },
  rh:           { bg:"2B0D4E", acc:"6E1ABD" },
  synthese:     { bg:"0D2B4E", acc:"1A6EBD" },
};

const MARGIN = 800;
const PAGE_W = 11906;
const CONT   = PAGE_W - 2 * MARGIN;

// ── Helpers visuels ────────────────────────────────────────────────
const b    = (c="CCCCCC", sz=1) => ({ style:BorderStyle.SINGLE, size:sz, color:c });
const bn   = ()                  => ({ style:BorderStyle.NIL,    size:0,  color:"FFFFFF" });
const bNone= ()                  => ({ top:bn(), bottom:bn(), left:bn(), right:bn() });
const bAll = (c,sz=1)            => ({ top:b(c,sz), bottom:b(c,sz), left:b(c,sz), right:b(c,sz) });

function r(text, opts={}) {
  const { bold=false, size=20, color=GRAY1, font="Calibri", italic=false } = opts;
  return new TextRun({ text:String(text??''), bold, size, color, font, italic });
}

function p(runs, opts={}) {
  const { align=AlignmentType.LEFT, spacing, border, indent, shading } = opts;
  return new Paragraph({
    alignment: align,
    spacing:   spacing || { before:0, after:0, line:276 },
    border, indent,
    shading: shading ? { fill:shading, type:ShadingType.CLEAR, color:shading } : undefined,
    children: Array.isArray(runs) ? runs : [runs],
  });
}

const sp  = (n=100) => p(r(""), { spacing:{ before:n, after:0 } });
const PB  = ()      => p(new PageBreak());

function tc(children, opts={}) {
  const { w, bg, borders:brd, mg, vAlign=VerticalAlign.TOP, span } = opts;
  return new TableCell({
    width:        { size:w, type:WidthType.DXA },
    shading:      bg ? { fill:bg, type:ShadingType.CLEAR, color:bg } : undefined,
    verticalAlign: vAlign,
    borders:      brd || bNone(),
    margins:      mg  || { top:80, bottom:80, left:120, right:120 },
    columnSpan:   span,
    children:     Array.isArray(children) ? children : [children],
  });
}

function tbl(colW, rows, opts={}) {
  return new Table({
    width:        { size:colW.reduce((a,b)=>a+b,0), type:WidthType.DXA },
    columnWidths: colW,
    rows, ...opts,
  });
}

function sectionBanner(num, title, icon, colors) {
  const { bg, acc } = colors;
  const WN=1400, WB=CONT-WN;
  return [ sp(160),
    tbl([WN, WB], [new TableRow({ children:[
      tc([p(r(num, {bold:true, size:72, color:WHITE, font:"Calibri"}),
            {align:AlignmentType.CENTER, spacing:{before:60,after:60}})],
        {w:WN, bg:acc, brd:bNone(), mg:{top:0,bottom:0,left:0,right:0}, vAlign:VerticalAlign.CENTER}),
      tc([p(r(`${icon}  ${title}`, {bold:true, size:30, color:WHITE, font:"Calibri"}))],
        {w:WB, bg, brd:bNone(), mg:{top:100,bottom:100,left:240,right:120}, vAlign:VerticalAlign.CENTER}),
    ]})]),
    sp(140),
  ];
}

function themeTitle(title, acc=BLUE) {
  return [
    tbl([80, CONT-80], [new TableRow({ children:[
      tc(p(r("")), {w:80, bg:acc, brd:bNone(), mg:{top:0,bottom:0,left:0,right:0}}),
      tc(p(r(title, {bold:true, size:22, color:NAVY})),
        {w:CONT-80, bg:XBLUE, brd:bNone(), mg:{top:80,bottom:80,left:200,right:120}}),
    ]})]),
    sp(100),
  ];
}

function kpiRow(kpis) {
  const GAP = 60;
  const w   = Math.floor((CONT - GAP*(kpis.length-1)) / kpis.length);
  const colW= kpis.map((_,i) => i<kpis.length-1 ? w+GAP : w);
  return [
    tbl(colW, [new TableRow({ children: kpis.map((k,i) => tc([
      p(r(k.label, {size:14, color:GRAY2}), {align:AlignmentType.CENTER, spacing:{before:100,after:0}}),
      p(r(k.value, {bold:true, size:k.big?48:30, color:k.color||BLUE}),
        {align:AlignmentType.CENTER, spacing:{before:20,after:0}}),
      k.sub
        ? p(r(k.sub, {size:13, color:k.subcolor||GRAY2, italic:true}),
            {align:AlignmentType.CENTER, spacing:{before:10,after:100}})
        : sp(100),
    ], {
      w:colW[i], bg:WHITE, vAlign:VerticalAlign.CENTER,
      brd:{top:b(k.accent||BLUE,10), bottom:b("EEEEEE"), left:b("EEEEEE"), right:b("EEEEEE")},
      mg:{top:0,bottom:0,left:80,right:80},
    })) })]),
    sp(120),
  ];
}

function dataTable(headers, rows, colW, opts={}) {
  const { compact=false, headerBg=NAVY } = opts;
  const pad=compact?55:75, sz=compact?15:17;
  const hRow = new TableRow({ tableHeader:true, children: headers.map((h,i) =>
    tc(p(r(h, {bold:true, size:sz, color:WHITE}), {align:i===0?AlignmentType.LEFT:AlignmentType.RIGHT}),
      {w:colW[i], bg:headerBg, brd:bNone(), mg:{top:pad,bottom:pad,left:110,right:90}}))});

  const dRows = rows.map((row,ri) => new TableRow({ children: row.map((cell,ci) => {
    const isL = ci===0;
    const obj = (typeof cell==='object'&&cell!==null) ? cell : {value:cell};
    const val = obj.value ?? cell;
    let color = obj.color || (isL ? GRAY1 : NAVY);
    if (!obj.color && !isL && typeof val==='string' && val.includes('%')) {
      const n = parseFloat(val);
      if (!isNaN(n)) color = n>=10 ? GREEN : n<=-10 ? RED : AMBER;
    }
    const bg = isL ? (ri%2===0?WHITE:GRAY3) : (ri%2===0?WHITE:XBLUE);
    return tc(
      p(r(String(val??'—'), {size:sz, color, bold:!!(obj.bold)||isL}),
        {align:isL?AlignmentType.LEFT:AlignmentType.RIGHT}),
      {w:colW[ci], bg,
       brd:{top:b("E0E0E0"),bottom:b("E0E0E0"),left:b("E8E8E8"),right:b("E8E8E8")},
       mg:{top:pad,bottom:pad,left:110,right:90}});
  })}));
  return [ tbl(colW, [hRow,...dRows]), sp(100) ];
}

function analyseBloc(points) {
  const WI=180, WB=CONT-WI;
  return tbl([WI,WB], [new TableRow({ children:[
    tc([sp(40),...'ANALYSE'.split('').map(c=>p(r(c,{bold:true,size:18,color:WHITE}),{align:AlignmentType.CENTER})),sp(40)],
      {w:WI, bg:ORANGE, brd:bNone(), mg:{top:0,bottom:0,left:0,right:0}, vAlign:VerticalAlign.CENTER}),
    tc([sp(60),
      p(r("Analyse manager", {bold:true, size:19, color:ORANGE}), {spacing:{before:0,after:60}}),
      ...points.map(pt=>
        p(r(pt, {size:18, color:pt.startsWith('→')?ORANGE:GRAY1, bold:pt.startsWith('→')}),
          {spacing:{before:0,after:50}, indent:{left:pt.startsWith('→')?0:120}})),
      sp(60)],
      {w:WB, bg:LORNG, brd:bNone(), mg:{top:0,bottom:0,left:200,right:160}}),
  ]})]);
}

const STATUTS = {
  "OK":         { label:"OK",          color:GREEN, bg:LGRN  },
  "En cours":   { label:"En cours",    color:AMBER, bg:LAMB  },
  "A réaliser": { label:"A réaliser",  color:GRAY2, bg:GRAY3 },
  "NOK":        { label:"NOK",         color:RED,   bg:LRED  },
};

function planActions(actions, acc=BLUE) {
  const WA=Math.round(CONT*.52), WQ=Math.round(CONT*.20), WS=CONT-WA-WQ;
  const hRow = new TableRow({ children:[
    tc(p(r("Plan d'actions", {bold:true, size:17, color:WHITE})),
      {w:WA, bg:acc, brd:bNone(), mg:{top:70,bottom:70,left:140,right:80}}),
    tc(p(r("Responsable", {bold:true, size:16, color:WHITE}), {align:AlignmentType.CENTER}),
      {w:WQ, bg:acc, brd:bNone()}),
    tc(p(r("Statut", {bold:true, size:16, color:WHITE}), {align:AlignmentType.CENTER}),
      {w:WS, bg:acc, brd:bNone()}),
  ]});
  const dRows = actions.map((a,i) => {
    const s  = STATUTS[a.statut]||STATUTS["A réaliser"];
    const bg = i%2===0 ? WHITE : GRAY3;
    return new TableRow({ children:[
      tc(p(r(a.action, {size:17, color:GRAY1})),
        {w:WA, bg, brd:bAll("E0E0E0"), mg:{top:65,bottom:65,left:140,right:80}}),
      tc(p(r(a.qui||'', {bold:true, size:16, color:BLUE}), {align:AlignmentType.CENTER}),
        {w:WQ, bg, brd:bAll("E0E0E0"), vAlign:VerticalAlign.CENTER}),
      tc(p(r(s.label, {bold:true, size:16, color:s.color}), {align:AlignmentType.CENTER}),
        {w:WS, bg:s.bg, brd:bAll("E0E0E0"), vAlign:VerticalAlign.CENTER}),
    ]});
  });
  return [ sp(120), tbl([WA,WQ,WS], [hRow,...dRows]) ];
}

function note(text, color=BLUE, bg=XBLUE) {
  return tbl([CONT], [new TableRow({ children:[
    tc(p(r(text, {size:16, color, italic:true})),
      {w:CONT, bg, brd:{top:bn(),bottom:bn(),right:bn(),left:b(color,10)},
       mg:{top:90,bottom:90,left:180,right:160}}),
  ]})]);
}

const sep = () => [sp(200),
  tbl([CONT], [new TableRow({ children:[
    tc(p(r("")), {w:CONT, bg:"EEEEEE", brd:bNone(), mg:{top:2,bottom:2,left:0,right:0}}),
  ]})]),
  sp(100),
];

const fK  = v => v==null||v===0 ? '—' : `${v.toLocaleString('fr-FR')} k€`;
const fDP = v => {
  if (v==null) return {text:'—', color:null};
  if (v>=10)   return {text:`+${Math.round(v*10)/10} %`, color:GREEN};
  if (v<=-10)  return {text:`${Math.round(v*10)/10} %`,  color:RED};
  return            {text:`${v>=0?'+':''}${Math.round(v*10)/10} %`, color:AMBER};
};

function buildContent(entity, moisLabel, logoData) {
  const ch = [];
  const d  = entity;
  const C  = SEC_COLOR.commerce;
  const O  = SEC_COLOR.operations;
  const PR = SEC_COLOR.previsionnels;
  const AF = SEC_COLOR.affaires;
  const RH = SEC_COLOR.rh;
  const SY = SEC_COLOR.synthese;

  // ── PAGE DE GARDE ───────────────────────────────────────────────
  const hasLogo = !!(logoData && logoData.data);
  ch.push(
    tbl([CONT], [new TableRow({ children:[
      tc([
        sp(hasLogo ? 60 : 120),
        ...(hasLogo ? [
          p([new ImageRun({
            type: logoData.type || 'png',
            data: logoData.data,
            transformation:{ width:300, height:73 },
            altText:{ title:"Logo", description:"Logo BTP Consultants", name:"logo" },
          })], {align:AlignmentType.CENTER, spacing:{before:0,after:0}}),
        ] : [
          p(r("GROUPE BTP CONSULTANTS", {bold:true, size:22, color:WHITE})),
        ]),
        sp(hasLogo?60:120),
      ], {w:CONT, bg:NAVY, brd:bNone(), mg:{top:0,bottom:0,left:200,right:200}}),
    ]})]),
    sp(400),
    p(r("COMPTE RENDU",  {bold:true, size:56, color:NAVY})),
    p(r("DE REUNION",    {bold:true, size:56, color:BLUE})),
    sp(20),
    tbl([120, CONT-120], [new TableRow({ children:[
      tc(p(r("")), {w:120, bg:ORANGE, brd:bNone(), mg:{top:3,bottom:3,left:0,right:0}}),
      tc(p(r("")), {w:CONT-120, bg:BLUE, brd:bNone(), mg:{top:3,bottom:3,left:0,right:0}}),
    ]})]),
    sp(40),
    p(r(`${d.nom}  .  ${moisLabel}`, {size:24, color:GRAY2})),
    sp(300),
  );
  const WLBL=1900, WVAL=CONT-WLBL;
  ch.push(tbl([WLBL,WVAL], [
    ...[ ["Date","A completer"],["Lieu","A completer"],
         ["Directeur d'Agence","A completer"],
         ["Participants","DA . RS SPS . RS CTC . Chefs de mission"],
         ["Ordre du jour","Commerce . Operations . Previsionnels N+1 . Affaires LT . RH"],
    ].map(([l,v],i) => new TableRow({ children:[
      tc(p(r(l, {bold:true, size:18, color:WHITE})),
        {w:WLBL, bg:i===0?BLUE:NAVY, brd:{top:b(WHITE,2),bottom:b(WHITE,2),left:bNone().left,right:bNone().right},
         mg:{top:75,bottom:75,left:160,right:80}}),
      tc(p(r(v, {size:18, italic:i===0, color:i===0?GRAY2:GRAY1})),
        {w:WVAL, bg:i%2===0?WHITE:GRAY3, brd:{top:b("E0E0E0"),bottom:b("E0E0E0"),left:b("CCCCCC",2),right:b("E0E0E0")},
         mg:{top:75,bottom:75,left:160,right:80}}),
    ]})),
  ]), PB());

  // ── 01 COMMERCE ─────────────────────────────────────────────────
  ch.push(...sectionBanner("01","COMMERCE","",C));
  ch.push(...themeTitle("1.1  Prise de commandes - Resultats annuels", C.acc));
  const com = d.commerce;
  ch.push(...kpiRow([
    {label:"Total Agence", value:`${fK(com.agence.total)}`, big:true, color:NAVY, accent:BLUE},
    {label:"SPS", value:fK(com.sps.total), color:BLUE, accent:BLUE, sub:`${com.spsShare} % du total`},
    {label:"CTC", value:fK(com.ctc.total), color:ORANGE, accent:ORANGE, sub:`${com.ctcShare} % du total`},
    {label:"Meilleur mois", value:com.bestMois.mois, color:GREEN, accent:GREEN, sub:fK(com.bestMois.val)},
    {label:"Mois creux",    value:com.worstMois.mois, color:RED, accent:RED, sub:fK(com.worstMois.val)},
  ]));
  ch.push(...dataTable(
    ["Service","S1 (Jan-Juin)","S2 (Juil-Dec)","Mois en cours","Total"],
    [
      ["Agence", fK(com.agence.s1), fK(com.agence.s2), fK(com.agence.mc), {value:fK(com.agence.total), bold:true}],
      ["SPS",    fK(com.sps.s1),    fK(com.sps.s2),    fK(com.sps.mc),    {value:fK(com.sps.total),    bold:true}],
      ["CTC",    fK(com.ctc.s1),    fK(com.ctc.s2),    fK(com.ctc.mc),    {value:fK(com.ctc.total),    bold:true}],
    ],
    [1900,1476,1476,1476,1978], {headerBg:C.acc}
  ));
  ch.push(analyseBloc([
    "A completer : commentaire sur les tendances du semestre (SPS / CTC, evolutions notables).",
    "A completer : point de vigilance ou anomalie a signaler.",
    "-> A completer : action ou objectif commercial cle.",
  ]));
  ch.push(...planActions([
    {action:"A completer", qui:"A completer", statut:"A réaliser"},
    {action:"A completer", qui:"A completer", statut:"A réaliser"},
  ], C.acc));
  ch.push(...sep());

  ch.push(...themeTitle("1.2  Devis & Taux de transformation", C.acc));
  ch.push(note("Donnees a extraire depuis Qlik avant la reunion."));
  ch.push(sp(80));
  ch.push(...dataTable(
    ["Indicateur","SPS","CTC","Agence"],
    [
      ["Devis emis (cumul)","—","—","—"],
      ["Taux de reussite AO","—","—","—"],
      ["Taux de succes montant","—","—","—"],
      ["Devis en cours > 50 k€","—","—","—"],
    ],
    [3200,1360,1360,2386], {headerBg:C.acc}
  ));
  ch.push(analyseBloc(["A completer : commentaire sur le taux de transformation.","-> A completer : action prioritaire."]));
  ch.push(...planActions([{action:"A completer", qui:"A completer", statut:"A réaliser"}], C.acc));
  ch.push(PB());

  // ── 02 OPERATIONS ────────────────────────────────────────────────
  ch.push(...sectionBanner("02","OPERATIONS","",O));
  ch.push(...themeTitle("2.1  Production - Resultats annuels", O.acc));
  const prod = d.production;
  ch.push(...kpiRow([
    {label:"Production Agence", value:fK(prod.agence.total), big:true, color:NAVY, accent:BLUE},
    {label:"SPS", value:fK(prod.sps.total), color:BLUE,   accent:BLUE},
    {label:"CTC", value:fK(prod.ctc.total), color:ORANGE, accent:ORANGE},
    {label:"Mois record", value:prod.bestMois.mois, color:GREEN, accent:GREEN, sub:fK(prod.bestMois.val)},
  ]));
  ch.push(...dataTable(
    ["Service","S1 (Jan-Juin)","S2 (Juil-Dec)","Mois en cours","Total"],
    [
      ["Agence", fK(prod.agence.s1), fK(prod.agence.s2), fK(prod.agence.mc), {value:fK(prod.agence.total), bold:true}],
      ["SPS",    fK(prod.sps.s1),    fK(prod.sps.s2),    fK(prod.sps.mc),    {value:fK(prod.sps.total),    bold:true}],
      ["CTC",    fK(prod.ctc.s1),    fK(prod.ctc.s2),    fK(prod.ctc.mc),    {value:fK(prod.ctc.total),    bold:true}],
    ],
    [1900,1476,1476,1476,1978], {headerBg:O.acc}
  ));
  ch.push(analyseBloc([
    "A completer : commentaire sur l'evolution de la production.",
    "-> A completer : action prioritaire.",
  ]));
  ch.push(...planActions([
    {action:"A completer", qui:"A completer", statut:"En cours"},
    {action:"A completer", qui:"A completer", statut:"A réaliser"},
  ], O.acc));
  ch.push(...sep());

  ch.push(...themeTitle("2.2  Calages de production - Mois en cours", O.acc));
  const cal = d.calages;
  const calAg = fDP(cal.agence.decalage), calSPS = fDP(cal.sps.decalage), calCTC = fDP(cal.ctc.decalage);
  ch.push(...kpiRow([
    {label:"Calage Agence", value:calAg.text,  big:true, color:calAg.color ||GRAY2, accent:BLUE},
    {label:"SPS",           value:calSPS.text, color:calSPS.color||GRAY2, accent:BLUE},
    {label:"CTC",           value:calCTC.text, color:calCTC.color||GRAY2, accent:ORANGE},
    {label:"RMs sous-real.", value:`${cal.rmsSPS.concat(cal.rmsCTC).filter(r=>r.decalage!=null&&r.decalage<-10).length}`, color:RED, accent:RED, sub:"a identifier"},
  ]));
  ch.push(note("Production nette = Realise - Avoirs   |   Decalage % = (Prod. nette - Prevu) / Prevu", GRAY2, GRAY3));
  ch.push(sp(80));

  if (cal.rmsSPS.length) {
    ch.push(p(r("Service SPS", {bold:true, size:18, color:BLUE}), {spacing:{before:80,after:60}}));
    ch.push(...dataTable(
      ["Charge de mission","Prevu","Realise","Avoirs","Prod. nette","Decalage"],
      [
        [{value:"Agence SPS", bold:true},fK(cal.sps.prevu),fK(cal.sps.realise),fK(cal.sps.avoirs),fK(cal.sps.prodNette),{value:calSPS.text,color:calSPS.color}],
        ...cal.rmsSPS.map(rm => {
          const fd = fDP(rm.decalage);
          return [rm.rm, fK(rm.prevu), fK(rm.realise), rm.avoirs, fK(rm.prodNette), {value:fd.text||'—', color:fd.color}];
        }),
      ],
      [2400,900,900,900,1000,900+306], {compact:true, headerBg:O.acc}
    ));
  }
  if (cal.rmsCTC.length) {
    ch.push(p(r("Service CTC", {bold:true, size:18, color:ORANGE}), {spacing:{before:80,after:60}}));
    ch.push(...dataTable(
      ["Charge de mission","Prevu","Realise","Avoirs","Prod. nette","Decalage"],
      [
        [{value:"Agence CTC", bold:true},fK(cal.ctc.prevu),fK(cal.ctc.realise),fK(cal.ctc.avoirs),fK(cal.ctc.prodNette),{value:calCTC.text,color:calCTC.color}],
        ...cal.rmsCTC.map(rm => {
          const fd = fDP(rm.decalage);
          return [rm.rm, fK(rm.prevu), fK(rm.realise), rm.avoirs, fK(rm.prodNette), {value:fd.text||'—', color:fd.color}];
        }),
      ],
      [2400,900,900,900,1000,900+306], {compact:true, headerBg:O.acc}
    ));
  }
  ch.push(analyseBloc([
    "A completer : commentaire global sur le calage du mois.",
    "A completer : top performers a valoriser.",
    "A completer : charges de mission en retard — points d'attention.",
    "-> A completer : decision ou action issue de l'analyse des calages.",
  ]));
  ch.push(...planActions([
    {action:"A completer", qui:"A completer", statut:"A réaliser"},
    {action:"A completer", qui:"A completer", statut:"A réaliser"},
  ], O.acc));
  ch.push(...sep());

  ch.push(...themeTitle("2.3  Previsionnels N - 1er Janvier vs Realise Decembre", O.acc));
  const pN = d.previsionnels;
  ch.push(...kpiRow([
    {label:"Previ. initiale",   value:fK(pN.agence.prev1janv), color:GRAY2, accent:GRAY2, sub:"au 1er janvier"},
    {label:"Realise",           value:fK(pN.agence.prevDec),   big:true, color:NAVY, accent:BLUE},
    {label:"Ecart net",         value:fK(pN.agence.ecart),     color:pN.agence.ecart>=0?GREEN:RED, accent:BLUE},
    {label:"SPS ecart",         value:fK(pN.sps.ecart),        color:BLUE, accent:BLUE},
    {label:"CTC ecart",         value:fK(pN.ctc.ecart),        color:ORANGE, accent:ORANGE},
  ]));
  if (pN.rmsSPS.length) {
    ch.push(p(r("Service SPS", {bold:true, size:18, color:BLUE}), {spacing:{before:80,after:60}}));
    ch.push(...dataTable(
      ["Charge de mission","Previ. 1er Janv.","Realise Dec.","Ecart"],
      [
        [{value:"Agence SPS",bold:true},fK(pN.sps.prev1janv),fK(pN.sps.prevDec),fK(pN.sps.ecart)],
        ...pN.rmsSPS.map(rm=>[rm.rm, fK(rm.prev1janv), fK(rm.prevDec), fK(rm.ecart)]),
      ],
      [2800,1500,1500,1806], {compact:true, headerBg:O.acc}
    ));
  }
  if (pN.rmsCTC.length) {
    ch.push(p(r("Service CTC", {bold:true, size:18, color:ORANGE}), {spacing:{before:80,after:60}}));
    ch.push(...dataTable(
      ["Charge de mission","Previ. 1er Janv.","Realise Dec.","Ecart"],
      [
        [{value:"Agence CTC",bold:true},fK(pN.ctc.prev1janv),fK(pN.ctc.prevDec),fK(pN.ctc.ecart)],
        ...pN.rmsCTC.map(rm=>[rm.rm, fK(rm.prev1janv), fK(rm.prevDec), fK(rm.ecart)]),
      ],
      [2800,1500,1500,1806], {compact:true, headerBg:O.acc}
    ));
  }
  ch.push(analyseBloc([
    "A completer : commentaire sur l'ecart global previ./realise.",
    "-> A completer : lecons pour fiabiliser les previsionnels N+1.",
  ]));
  ch.push(...planActions([{action:"A completer", qui:"A completer", statut:"A réaliser"}], O.acc));
  ch.push(PB());

  // ── 03 PREVISIONNELS N+1 ─────────────────────────────────────────
  ch.push(...sectionBanner("03","PREVISIONNELS N+1","",PR));
  ch.push(...themeTitle("3.1  Previsionnels a fin N+1 par charge de mission", PR.acc));
  const pNP1 = d.previsionnelsNP1 || d.previsionnels;
  ch.push(...kpiRow([
    {label:"Prev. Agence N+1", value:fK(pNP1.agence.prevDec), big:true, color:NAVY, accent:BLUE},
    {label:"SPS previsionnel", value:fK(pNP1.sps.prevDec),    color:BLUE,   accent:BLUE},
    {label:"CTC previsionnel", value:fK(pNP1.ctc.prevDec),    color:ORANGE, accent:ORANGE},
    {label:"Ecart vs N",       value:fK((pNP1.agence.prevDec||0)-(prod.agence.total||0)),
      color:GRAY2, accent:GRAY2, sub:"par rapport au realise N"},
  ]));
  ch.push(note("Comparer le previsionnel N+1 au realise N. Identifier les ecarts significatifs et les leviers par RM.", BLUE, XBLUE));
  ch.push(sp(80));
  if ((pNP1.rmsSPS||[]).length) {
    ch.push(p(r("Service SPS", {bold:true, size:18, color:BLUE}), {spacing:{before:80,after:60}}));
    ch.push(...dataTable(
      ["Charge de mission","Prev. fin N+1","Signal"],
      [
        [{value:"Agence SPS",bold:true}, fK(pNP1.sps.prevDec), "—"],
        ...(pNP1.rmsSPS||[]).map(rm=>[rm.rm, fK(rm.prevDec), rm.prevDec>0?'OK':'A completer']),
      ],
      [3000,2000,2306], {compact:true, headerBg:PR.acc}
    ));
  }
  if ((pNP1.rmsCTC||[]).length) {
    ch.push(p(r("Service CTC", {bold:true, size:18, color:ORANGE}), {spacing:{before:80,after:60}}));
    ch.push(...dataTable(
      ["Charge de mission","Prev. fin N+1","Signal"],
      [
        [{value:"Agence CTC",bold:true}, fK(pNP1.ctc.prevDec), "—"],
        ...(pNP1.rmsCTC||[]).map(rm=>[rm.rm, fK(rm.prevDec), rm.prevDec>0?'OK':'A completer']),
      ],
      [3000,2000,2306], {compact:true, headerBg:PR.acc}
    ));
  }
  ch.push(analyseBloc([
    "A completer : commentaire sur le niveau global des previsionnels N+1 vs realise N.",
    "A completer : charges de mission avec previsionnel faible ou vide.",
    "-> A completer : date de validation des previsionnels.",
  ]));
  ch.push(...planActions([
    {action:"Validation previsionnels N+1 + 1 levier de depassement par CM", qui:"Tous CMs", statut:"A réaliser"},
    {action:"A completer : plan renforce CMs en retard", qui:"RS + DA", statut:"A réaliser"},
  ], PR.acc));
  ch.push(PB());

  // ── 04 AFFAIRES LT ───────────────────────────────────────────────
  ch.push(...sectionBanner("04","AFFAIRES DECALEES LONG TERME","",AF));
  ch.push(...themeTitle("4.1  Volume decale par service", AF.acc));
  const lt = d.lt;
  ch.push(...kpiRow([
    {label:"Volume LT Agence", value:fK(lt.agence.factureAne), big:true, color:AMBER, accent:AMBER},
    {label:"SPS",              value:fK(lt.sps.factureAne),    color:BLUE,   accent:BLUE},
    {label:"CTC",              value:fK(lt.ctc.factureAne),    color:ORANGE, accent:ORANGE},
  ]));
  ch.push(...dataTable(
    ["Service","Volume LT","Part du total","Priorite"],
    [
      [{value:"Agence",bold:true}, fK(lt.agence.factureAne), "100 %", "—"],
      ["SPS", fK(lt.sps.factureAne),
        lt.agence.factureAne>0 ? `${Math.round(lt.sps.factureAne/lt.agence.factureAne*100)} %` : "—", "—"],
      ["CTC", fK(lt.ctc.factureAne),
        lt.agence.factureAne>0 ? `${Math.round(lt.ctc.factureAne/lt.agence.factureAne*100)} %` : "—", "—"],
    ],
    [2200,1800,1600,2706], {headerBg:AF.acc}
  ));
  ch.push(note("Relier les affaires LT aux previsionnels N+1 des CMs concernes. Identifier les top 3 a mobiliser en priorite.", AMBER, LAMB));
  ch.push(analyseBloc([
    "A completer : commentaire sur la repartition des affaires decalees (SPS/CTC).",
    "A completer : leviers de mobilisation identifies.",
    "-> A completer : top 3 affaires prioritaires a debloquer.",
  ]));
  ch.push(...planActions([
    {action:"Top 3 affaires LT a mobiliser - SPS (plan date)", qui:"RS SPS", statut:"A réaliser"},
    {action:"Top 3 affaires LT a mobiliser - CTC (plan date)", qui:"RS CTC", statut:"A réaliser"},
  ], AF.acc));
  ch.push(PB());

  // ── 05 RH & VIE D'AGENCE ─────────────────────────────────────────
  ch.push(...sectionBanner("05","RH & VIE D'AGENCE","",RH));
  ch.push(...themeTitle("5.1  Ressources Humaines", RH.acc));
  ch.push(...dataTable(
    ["Sujet","Detail","Statut"],
    [
      ["Arrivees prevues","A completer","—"],
      ["Postes a pourvoir","A completer","—"],
      ["Departs","A completer","—"],
      ["Besoins formation","A completer avant le 15 du mois","—"],
      ["Organisation locale","A completer","—"],
    ],
    [2200,5010,3096], {headerBg:RH.acc}
  ));
  ch.push(analyseBloc(["A completer : mouvements du mois, besoins identifies, organisation locale."]));
  ch.push(...planActions([
    {action:"Point RH prepare (5 min max)",               qui:"DA",      statut:"A réaliser"},
    {action:"Besoins formation remontes avant le 15",      qui:"DA + RS", statut:"A réaliser"},
  ], RH.acc));
  ch.push(...sep());

  ch.push(...themeTitle("5.2  Sujets operationnels & Vie d'agence", RH.acc));
  ch.push(...dataTable(
    ["Theme","Contenu","Attendu"],
    [
      [{value:"Securite",     bold:true},"EPI . retours terrain . incidents",               {value:"Partage equipe",  color:RED}],
      [{value:"Qualite",      bold:true},"Nouvelles maquettes . notes . procedures",         {value:"Diffusion",       color:GREEN}],
      [{value:"Communication",bold:true},"Descente CODIR . alertes . signaux faibles",       {value:"DA -> equipe",    color:BLUE}],
      [{value:"Evenements",   bold:true},"Audits . visites medicales . conges",              "Planification"],
      [{value:"Projets DT",   bold:true},"Nouveaux outils . process supports . moyens",     {value:"Presentation",    color:AMBER}],
    ],
    [1800,5010,1496+500-500], {headerBg:RH.acc}
  ));
  ch.push(analyseBloc([
    "La securite est le seul point non-negociable a chaque reunion.",
    "-> Remontee des alertes et signaux faibles vers la direction.",
  ]));
  ch.push(...planActions([
    {action:"Point securite mensuel obligatoire",         qui:"DA",      statut:"En cours"},
    {action:"Diffusion nouveautes DT et outils aux CMs",  qui:"DA + RS", statut:"A réaliser"},
  ], RH.acc));
  ch.push(PB());

  // ── 06 SYNTHESE ───────────────────────────────────────────────────
  ch.push(...sectionBanner("06","SYNTHESE - PLAN D'ACTIONS","",SY));
  const WPA=Math.round(CONT*.44), WPQ=Math.round(CONT*.17), WPE=Math.round(CONT*.14);
  const WPS=Math.round(CONT*.12), WPN=CONT-WPA-WPQ-WPE-WPS;
  const hRow = new TableRow({ children:[
    tc(p(r("Action",      {bold:true,size:16,color:WHITE})), {w:WPA,bg:NAVY,brd:bNone(),mg:{top:70,bottom:70,left:140,right:80}}),
    tc(p(r("Responsable", {bold:true,size:16,color:WHITE}),{align:AlignmentType.CENTER}), {w:WPQ,bg:NAVY,brd:bNone()}),
    tc(p(r("Echeance",    {bold:true,size:16,color:WHITE}),{align:AlignmentType.CENTER}), {w:WPE,bg:NAVY,brd:bNone()}),
    tc(p(r("Statut",      {bold:true,size:16,color:WHITE}),{align:AlignmentType.CENTER}), {w:WPS,bg:NAVY,brd:bNone()}),
    tc(p(r("Notes",       {bold:true,size:16,color:WHITE})), {w:WPN,bg:NAVY,brd:bNone(),mg:{top:70,bottom:70,left:80,right:60}}),
  ]});
  const sections = [
    {section:"Commerce"},
    {action:"[A completer]",qui:"",ech:"",statut:"A réaliser"},
    {action:"[A completer]",qui:"",ech:"",statut:"A réaliser"},
    {section:"Operations"},
    {action:"[A completer]",qui:"",ech:"",statut:"A réaliser"},
    {action:"[A completer]",qui:"",ech:"",statut:"En cours"},
    {section:"Previsionnels N+1"},
    {action:"Validation previsionnels N+1 + 1 levier par CM",qui:"Tous CMs",ech:"A definir",statut:"A réaliser"},
    {section:"Affaires LT"},
    {action:"Top 3 affaires LT SPS",qui:"RS SPS",ech:"A definir",statut:"A réaliser"},
    {action:"Top 3 affaires LT CTC",qui:"RS CTC",ech:"A definir",statut:"A réaliser"},
    {section:"RH & Vie d'agence"},
    {action:"Point RH prepare (5 min)",    qui:"DA",  ech:"Chaque reunion",statut:"A réaliser"},
    {action:"Point securite mensuel",      qui:"DA",  ech:"Chaque reunion",statut:"En cours"},
    {action:"[A completer]",qui:"",ech:"",statut:"A réaliser"},
  ];
  let gi=0;
  const synthRows=[hRow];
  for (const row of sections) {
    if (row.section) {
      synthRows.push(new TableRow({ children:[
        tc(p(r(row.section, {bold:true,size:16,color:WHITE})),
          {w:WPA, bg:BLUE, brd:{top:b(WHITE),bottom:b(WHITE),left:b(ORANGE,10),right:bn()},
           mg:{top:60,bottom:60,left:140,right:80}}),
        tc(p(r("")),{w:WPQ,bg:BLUE,brd:bAll(WHITE)}),
        tc(p(r("")),{w:WPE,bg:BLUE,brd:bAll(WHITE)}),
        tc(p(r("")),{w:WPS,bg:BLUE,brd:bAll(WHITE)}),
        tc(p(r("")),{w:WPN,bg:BLUE,brd:bAll(WHITE)}),
      ]}));
    } else {
      const s=STATUTS[row.statut]||STATUTS["A réaliser"];
      const isP=row.action.startsWith('[');
      const bg=gi%2===0?WHITE:GRAY3;
      synthRows.push(new TableRow({ children:[
        tc(p(r(row.action,{size:16,italic:isP,color:isP?GRAY2:GRAY1})),
          {w:WPA,bg,brd:bAll("E0E0E0"),mg:{top:60,bottom:60,left:140,right:80}}),
        tc(p(r(row.qui||'',{bold:!isP,size:15,color:BLUE}),{align:AlignmentType.CENTER}),
          {w:WPQ,bg,brd:bAll("E0E0E0"),vAlign:VerticalAlign.CENTER}),
        tc(p(r(row.ech||'',{size:15,color:GRAY2}),{align:AlignmentType.CENTER}),
          {w:WPE,bg,brd:bAll("E0E0E0"),vAlign:VerticalAlign.CENTER}),
        tc(p(r(s.label,{bold:true,size:15,color:s.color}),{align:AlignmentType.CENTER}),
          {w:WPS,bg:s.bg,brd:bAll("E0E0E0"),vAlign:VerticalAlign.CENTER,mg:{top:60,bottom:60,left:40,right:40}}),
        tc(p(r("")),{w:WPN,bg,brd:bAll("E0E0E0")}),
      ]}));
      gi++;
    }
  }
  ch.push(tbl([WPA,WPQ,WPE,WPS,WPN], synthRows));
  ch.push(sp(200));

  const W1=Math.round(CONT*.55), W2=CONT-W1;
  ch.push(tbl([W1,W2], [new TableRow({ children:[
    tc([
      p(r("Prochain rendez-vous", {bold:true,size:18,color:BLUE}),{spacing:{before:0,after:40}}),
      p(r("Date & lieu : A definir  .  OdJ a transmettre sous 8 jours",{size:17,color:GRAY2})),
    ], {w:W1, bg:XBLUE, brd:bNone(), mg:{top:130,bottom:130,left:200,right:160}}),
    tc([
      p(r("Signature du Directeur d'Agence :", {size:17,color:GRAY1}),{spacing:{before:0,after:180}}),
      p(r(""),{border:{bottom:{style:BorderStyle.SINGLE,size:3,color:"AAAAAA",space:4}},indent:{right:400}}),
    ], {w:W2, brd:bNone(), mg:{top:130,bottom:130,left:120,right:80}}),
  ]})]),);

  return ch;
}

function makeHeader(nom, moisLabel) {
  const W1=Math.round(CONT*.65), W2=CONT-W1;
  return new Header({ children:[
    tbl([W1,W2], [new TableRow({ children:[
      tc(p(r(`BTP-CONSULTANTS  .  ${nom}  .  ${moisLabel}`, {bold:true,size:14,color:WHITE})),
        {w:W1, bg:NAVY, brd:bNone(), mg:{top:55,bottom:55,left:160,right:80}}),
      tc(p(r("CONFIDENTIEL - Usage interne", {size:14,color:GRAY2,italic:true}), {align:AlignmentType.RIGHT}),
        {w:W2, bg:GRAY3, brd:bNone(), mg:{top:55,bottom:55,left:80,right:120}}),
    ]})]),
  ]});
}

function makeFooter() {
  return new Footer({ children:[
    p([
      r("BTP-Consultants - Document confidentiel", {size:13,color:GRAY2,italic:true}),
      new TextRun({text:"\t", size:13}),
      r("Page ", {size:13,color:GRAY2}),
      new TextRun({children:[PageNumber.CURRENT], size:13, color:NAVY}),
      r("  /  ", {size:13,color:GRAY2}),
      new TextRun({children:[PageNumber.TOTAL_PAGES], size:13, color:GRAY2}),
    ], {
      border:{top:{style:BorderStyle.SINGLE,size:3,color:BLUE,space:4}},
      spacing:{before:60,after:0},
      tabStops:[{type:TabStopType.RIGHT, position:TabStopPosition.MAX}],
    }),
  ]});
}

export async function buildCR(entity, moisLabel, logoData=null) {
  const doc = new Document({
    styles:{ default:{ document:{ run:{ font:"Calibri", size:20 } } } },
    sections:[{
      properties:{
        page:{
          size:{ width:PAGE_W, height:16838 },
          margin:{ top:MARGIN, right:MARGIN, bottom:MARGIN, left:MARGIN },
        }
      },
      headers:  { default: makeHeader(entity.nom, moisLabel) },
      footers:  { default: makeFooter() },
      children: buildContent(entity, moisLabel, logoData),
    }],
  });
  return Packer.toBlob(doc);
}
