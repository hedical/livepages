// ============================================================================
// shared/analyztech-theme.js — Habillage charte AnalyzTech des graphiques
//
// Chargé APRÈS chart.js et AVANT le script de la page. Les scripts des pages
// gardent leurs couleurs d'origine : on intercepte la construction des
// graphiques pour les ramener à la palette de la charte (guideline V1.0) :
//   Digital White #FFFDF6 · Off White #F8F5EB · Stone Grey #B6B9AD
//   Graphite #595959 · Black #1A1A1A · Compliant Green #BAF266
//
// Règles appliquées :
//   - textes, axes, quadrillage, infobulles : toujours aux couleurs de la charte ;
//   - peu de séries (≤ 2 courbes, ≤ 4 séries de barres) : couleurs de la charte ;
//   - beaucoup de séries (≥ 3 courbes, ≥ 5 séries de barres ou de parts) : six
//     couleurs dont trois gris ne se distinguent plus. On passe alors sur une
//     palette catégorielle de 8 teintes, validée daltonisme (ordre = garantie
//     d'écart entre voisines), puis texture au-delà de 8. Exception assumée à la
//     charte, décidée pour la lisibilité des graphes multi-séries ;
//   - un graphique déjà dessiné avec cette palette (ex. COPIL IA, où chaque
//     module garde sa couleur d'un graphe à l'autre) est laissé tel quel ;
//   - courbes de référence (cible, moyenne : déjà en pointillés) : graphite ;
//   - camemberts : la couleur suit l'entité (son libellé), pas son rang.
// Libellés, légendes et infobulles ne sont pas touchés.
// ============================================================================
(function () {
    if (typeof window.Chart === 'undefined') return;

    const C = {
        paper: '#FFFDF6', off: '#F8F5EB', stone: '#B6B9AD',
        graphite: '#595959', ink: '#1A1A1A', green: '#BAF266',
        stoneLight: '#DADACF',
    };

    // Palette catégorielle (dataviz, mode clair) : bleu, orange, aqua, jaune,
    // magenta, vert, violet, rouge. L'ordre est celui qui passe les contrôles
    // daltonisme entre voisines : ne pas le réordonner.
    const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

    // Couleur d'origine (triplet r,g,b) → couleur charte.
    const MAP = {
        '99,102,241': C.ink, '79,70,229': C.ink,          // indigo : série principale
        '59,130,246': C.graphite,                          // bleu : axe des heures
        '16,185,129': C.graphite, '5,150,105': C.graphite, // émeraude : cumul
        '245,158,11': C.graphite,                          // ambre : nouveaux utilisateurs
        '139,92,246': C.ink,                               // violet : courbe en euros
        '31,41,55': C.ink, '17,24,39': C.ink,              // textes et infobulles
        '107,114,128': C.graphite, '156,163,175': C.graphite, '75,85,99': C.graphite,
        '249,250,251': C.off, '229,231,235': C.off, '243,244,246': C.off,
        '255,255,255': C.paper,
    };
    // Couleurs déjà conformes (charte et ses teintes) : gardées telles quelles.
    const CHARTER = {
        '255,253,246': C.paper, '248,245,235': C.off, '182,185,173': C.stone, '89,89,89': C.graphite,
        '26,26,26': C.ink, '186,242,102': C.green, '218,218,207': C.stoneLight,
        '237,234,224': '#EDEAE0', '233,244,202': '#E9F4CA',
    };
    Object.assign(MAP, CHARTER);

    const BY_LABEL = {
        'BTP Consultants': C.green, 'Citae': C.ink, 'BTP Diagnostics': C.graphite,
        'BTP Consultants SPS': C.stone, 'Autre': C.stoneLight,
        // Profils d'adoption : du plus clair (Découverte) au plus foncé (Adopté).
        'Découverte': C.stoneLight, 'Occasionnel': C.stone, 'Régulier': C.graphite, 'Adopté': C.ink,
        // Avis de l'analyse CCTP : le vert signale la conformité (Compliant Green).
        'Favorable': C.green, 'Suspendu': C.graphite, 'Défavorable': C.ink,
    };

    function parse(str) {
        if (typeof str !== 'string') return null;
        const s = str.trim().toLowerCase();
        let m = s.match(/^#([0-9a-f]{3})$/);
        if (m) return { rgb: m[1].split('').map(h => parseInt(h + h, 16)), a: 1 };
        m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
        if (m) return { rgb: [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
        m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
        if (m) return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
        return null;
    }
    const keyOf = (str) => { const p = parse(str); return p ? p.rgb.join(',') : null; };
    const isCharter = (str) => !!CHARTER[keyOf(str)];
    // Palette catégorielle, plus l'ancien violet du COPIL (#4a3aa7, « Tous modules » CT).
    const CAT_KEYS = new Set(CATEGORICAL.concat('#4a3aa7').map(keyOf));
    const isCategorical = (str) => CAT_KEYS.has(keyOf(str));

    function hexToRgba(hex, a) {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }

    // Couleur inconnue : gris → rampe de clarté ; verts → Compliant Green ;
    // toutes les autres teintes → noir (clair → Stone Grey).
    function nearest([r, g, b]) {
        const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
        const l = (max + min) / 2;
        const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
        if (sat < 0.15) {
            return l > 0.93 ? C.paper : l > 0.85 ? C.off : l > 0.7 ? C.stone : l > 0.35 ? C.graphite : C.ink;
        }
        let h;
        const R = r / 255, G = g / 255, B = b / 255, d = max - min;
        if (max === R) h = ((G - B) / d) % 6; else if (max === G) h = (B - R) / d + 2; else h = (R - G) / d + 4;
        h = (h * 60 + 360) % 360;
        if (h >= 65 && h < 170) return l > 0.85 ? C.off : C.green;
        return l > 0.85 ? C.off : l > 0.7 ? C.stone : C.ink;
    }

    function remap(str) {
        const p = parse(str);
        if (!p) return str;
        const key = p.rgb.join(',');
        // Quadrillage : gris pierre discret.
        if (key === '229,231,235' && p.a < 1) return hexToRgba(C.stone, 0.45);
        const target = MAP[key] || nearest(p.rgb);
        // Les aplats translucides (aires sous courbe) gardent leur transparence ;
        // les autres deviennent opaques, sans voile.
        return p.a < 0.3 ? hexToRgba(target, p.a) : target;
    }

    const COLOR_KEYS = /color$|^color$|fill$|^stroke$/i;

    function walk(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 8) return;
        Object.keys(obj).forEach(k => {
            const v = obj[k];
            if (typeof v === 'string' && COLOR_KEYS.test(k)) obj[k] = remap(v);
            else if (Array.isArray(v) && COLOR_KEYS.test(k)) obj[k] = v.map(x => typeof x === 'string' ? remap(x) : x);
            else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, depth + 1);
        });
    }

    // Textures : couleur de fond + motif contrasté (encre sur clair, blanc cassé sur foncé).
    function pattern(base, kind) {
        const size = 8;
        const cv = document.createElement('canvas');
        cv.width = cv.height = size;
        const g = cv.getContext('2d');
        g.fillStyle = base;
        g.fillRect(0, 0, size, size);
        const dark = base === C.ink || base === C.graphite;
        g.strokeStyle = g.fillStyle = dark ? C.off : C.ink;
        g.lineWidth = 1.2;
        if (kind === 'dots') {
            g.beginPath(); g.arc(size / 2, size / 2, 1.3, 0, Math.PI * 2); g.fill();
        } else {
            g.beginPath();
            if (kind === 'h45') { g.moveTo(0, size); g.lineTo(size, 0); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(size - 2, size + 2); g.lineTo(size + 2, size - 2); }
            else { g.moveTo(0, 0); g.lineTo(size, size); g.moveTo(size - 2, -2); g.lineTo(size + 2, 2); g.moveTo(-2, size - 2); g.lineTo(2, size + 2); }
            g.stroke();
        }
        return g.createPattern(cv, 'repeat');
    }

    const SERIES_BASES = [C.green, C.ink, C.stone, C.graphite];
    const KINDS = ['solid', 'h45', 'h135', 'dots'];
    const LINE_COLORS = [C.ink, C.graphite];

    // Peu de séries de barres : charte (vert, noir, pierre, graphite).
    function charterFill(i) {
        const base = SERIES_BASES[i % SERIES_BASES.length];
        const kind = KINDS[Math.floor(i / SERIES_BASES.length) % KINDS.length];
        return kind === 'solid' ? base : pattern(base, kind);
    }
    // Beaucoup de séries : palette catégorielle, puis texture au-delà de 8.
    function categoricalColor(i) { return CATEGORICAL[i % CATEGORICAL.length]; }
    function categoricalFill(i) {
        const kind = KINDS[Math.floor(i / CATEGORICAL.length) % KINDS.length];
        return kind === 'solid' ? categoricalColor(i) : pattern(categoricalColor(i), kind);
    }

    const typeOf = (ds, type) => ds.type || type;
    const isLine = (ds, type) => ['line', 'radar'].includes(typeOf(ds, type));
    const isBar = (ds, type) => typeOf(ds, type) === 'bar';
    // Courbe de référence (cible, moyenne) : déjà en pointillés dans le script de la page.
    const isReference = (ds) => Array.isArray(ds.borderDash) && ds.borderDash.length > 0;
    const mainColor = (ds, type) => isLine(ds, type) ? ds.borderColor : ds.backgroundColor;

    function styleLine(ds, color, dashed) {
        ds.borderColor = color;
        ds.pointBackgroundColor = color;
        ds.pointBorderColor = C.paper;
        if (ds.backgroundColor && ds.backgroundColor !== 'transparent' && !ds.fill) ds.backgroundColor = color;
        ds.borderWidth = 2;
        if (dashed) ds.borderDash = [6, 4];
    }

    function theme(config) {
        if (!config || typeof config !== 'object') return;
        const type = config.type;
        const data = config.data || {};
        const datasets = data.datasets || [];
        const isPie = ['pie', 'doughnut', 'polarArea'].includes(type);

        if (isPie) {
            const labels = Array.isArray(data.labels) ? data.labels : [];
            datasets.forEach(ds => {
                // Une page déjà passée à la charte ou à la palette catégorielle garde ses
                // couleurs (ex. parts grisées quand un filtre les exclut) : seul le filet
                // entre les parts est uniformisé.
                const own = Array.isArray(ds.backgroundColor) && ds.backgroundColor.length
                    && ds.backgroundColor.every(c => isCharter(c) || isCategorical(c));
                if (!own) {
                    const known = labels.length && labels.every(l => BY_LABEL[l]);
                    ds.backgroundColor = labels.map((l, i) => known ? BY_LABEL[l]
                        : labels.length > SERIES_BASES.length ? categoricalFill(i) : charterFill(i));
                }
                ds.borderColor = C.paper;
            });
            walk(config.options, 0);
            return;
        }

        const lines = datasets.filter(ds => isLine(ds, type) && !isReference(ds));
        const refs = datasets.filter(ds => isLine(ds, type) && isReference(ds));
        const bars = datasets.filter(ds => isBar(ds, type));
        const series = lines.concat(bars);

        // Déjà dessiné avec la palette catégorielle : on n'y touche pas.
        const designed = series.length > 1 && series.every(ds => {
            const c = mainColor(ds, type);
            return typeof c === 'string' && (isCategorical(c) || isCharter(c));
        }) && series.some(ds => isCategorical(mainColor(ds, type)));

        const manyLines = lines.length >= 3;
        const manyBars = bars.length > SERIES_BASES.length;

        // Même couleur d'origine → même nouvelle couleur (la couleur suit l'entité).
        const slotOf = () => {
            const seen = [];
            return ds => {
                const k = String(mainColor(ds, type));
                if (!seen.includes(k)) seen.push(k);
                return seen.indexOf(k);
            };
        };
        const lineSlot = slotOf();
        const barSlot = slotOf();

        datasets.forEach(ds => {
            // Graphe dessiné avec la palette catégorielle, ou série unique dans une de
            // ses teintes (petits multiples par métier du COPIL) : couleur conservée,
            // pour que chaque entité garde sa couleur d'un graphe à l'autre.
            if (series.includes(ds) && (designed || (series.length === 1 && isCategorical(mainColor(ds, type))))) {
                if (keyOf(ds.borderColor) === '255,255,255') ds.borderColor = C.paper;
                return;
            }

            if (bars.includes(ds) && bars.length > 1) {
                // Plusieurs séries de barres : identité par couleur (+ texture).
                ds.backgroundColor = manyBars ? categoricalFill(barSlot(ds)) : charterFill(bars.indexOf(ds));
                ds.borderColor = C.paper;
                ds.borderWidth = ds.stack ? { top: 1, right: 0, bottom: 0, left: 0 } : 0;
                if (ds.hoverBackgroundColor) delete ds.hoverBackgroundColor;
                return;
            }

            // Une seule série, une couleur par barre (entonnoir, paliers…) : si le
            // rapprochement confond des couleurs distinctes, chaque couleur d'origine
            // reçoit sa propre couleur charte (+ texture au-delà de 4).
            const orig = Array.isArray(ds.backgroundColor) ? ds.backgroundColor.slice() : null;
            if (lines.includes(ds) && manyLines) {
                // Au-delà de 8 courbes, le tracé change à chaque tour de palette :
                // plein, puis tirets, puis pointillés.
                const i = lineSlot(ds);
                styleLine(ds, categoricalColor(i), false);
                const lap = Math.floor(i / CATEGORICAL.length) % 3;
                if (lap) ds.borderDash = lap === 1 ? [6, 4] : [2, 3];
                return;
            }
            walk(ds, 0);
            if (orig && orig.every(x => typeof x === 'string')) {
                const distinctOrig = [...new Set(orig)];
                if (new Set(ds.backgroundColor).size < distinctOrig.length) {
                    ds.backgroundColor = orig.map(c => charterFill(distinctOrig.indexOf(c)));
                    ds.borderColor = C.paper;
                }
            }
            if (refs.includes(ds)) {
                styleLine(ds, C.graphite, false);
                ds.borderWidth = 1.5;
            } else if (lines.includes(ds)) {
                const i = lines.indexOf(ds);
                // Une seule série de barres déjà en noir : la courbe passe en graphite.
                const barInk = bars.length === 1 && bars[0].backgroundColor === C.ink;
                let color = lines.length > 1 || bars.length ? LINE_COLORS[i % LINE_COLORS.length] : (ds.borderColor || C.ink);
                if (barInk && color === C.ink) color = C.graphite;
                // Courbe sur des barres : en pointillés, pour s'en distinguer.
                styleLine(ds, color, bars.length > 0);
            }
            if (ds.borderRadius) ds.borderRadius = 4;
        });
        walk(config.options, 0);
    }

    const Base = window.Chart;
    class AnalyzTechChart extends Base {
        constructor(item, config) {
            theme(config);
            super(item, config);
        }
    }
    window.Chart = AnalyzTechChart;

    Base.defaults.font.family = "'Inter Tight', 'Helvetica Neue', Arial, sans-serif";
    Base.defaults.color = C.graphite;
    Base.defaults.borderColor = hexToRgba(C.stone, 0.45);
})();
