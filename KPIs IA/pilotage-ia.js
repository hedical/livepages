// ============================================================================
// pilotage-ia.js — Page « Pilotage économique de la démarche IA ».
//
// Croise la dépense IA réelle avec les gains déjà calculés par le dashboard.
// Calculs GLOBAUX (niveau groupe) : aucune ventilation par fonctionnalité.
//
// Sources de dépense, dans l'ordre de confiance :
//   1. les exports CSV « total usage » d'OpenRouter déposés dans le bucket et
//      signés par n8n (variables OPENROUTER_EXPORT*). Source PARTAGÉE : tous
//      les postes voient la même chose. Un fichier par compte ou par année,
//      DISJOINTS, qui s'additionnent — c'est le seul moyen de connaître le
//      passé, l'API ne servant que le cumulé de l'instant ;
//   2. l'API OpenRouter, relevée quotidiennement par n8n dans un fichier du
//      bucket (openrouter_usage.json, variable OPENROUTER_USAGE_URL) ;
//   3. les mêmes exports CSV importés à la main dans le navigateur, pour
//      travailler avant que le bucket ne soit câblé. Un import local qui
//      décrit le même fichier qu'un export du bucket est ÉCARTÉ, et non
//      additionné ;
//   4. un registre saisi à la main pour tout le hors-inférence (infra, OCR,
//      licences).
//
// SÉCURITÉ : aucune clé OpenRouter ici. Ces pages sont déployées vers un repo
// PUBLIC ; la clé Management vit uniquement dans les credentials n8n. Le front
// ne lit qu'un fichier de relevés déjà signé.
//
// Toute la logique de calcul est dans shared/costs.js (testée en Node). Ce
// fichier ne fait que charger, orchestrer et peindre.
// ============================================================================

// ==================== CONFIGURATION ====================
// L'URL du webhook est centralisée dans shared/utils.js : on la consomme au
// lieu de la redupliquer (contrairement aux pages détail plus anciennes).
const WEBHOOK_URL = KPI.WEBHOOK_URL;
let OPENROUTER_URL = '';   // fichier de relevés JSON du job n8n
let EXPORT_URLS = [];      // exports CSV du bucket : [{ nom, url }]

// ==================== STATE ====================
let releves = [];          // relevés normalisés, toutes sources confondues
let historique = null;      // imports locaux (localStorage)
let exportsDistants = [];   // exports CSV lus dans le bucket : [{ nom, meta, snapshots, type }]
let relevesJob = [];        // relevés JSON du job n8n
let importsIgnores = [];    // imports locaux écartés car déjà servis par le bucket
let exportsIgnores = [];    // exports du bucket écartés car en double
let openRouter = null;     // résultat de monthlySpendFromSnapshots
let registre = [];         // lignes saisies
let params = null;         // paramètres macro
let agregat = null;        // résultat de aggregateMonthly
let snapshot = null;       // instantané des gains publié par le dashboard
let periode = { start: null, end: null };

let depenseChart = null;
let budgetChart = null;

// ==================== DOM ====================
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const errorDetailEl = document.getElementById('error-detail');
const mainContentEl = document.getElementById('main-content');

const startMonthEl = document.getElementById('start-month');
const endMonthEl = document.getElementById('end-month');
const resetPeriodBtn = document.getElementById('reset-period');
const periodLabelEl = document.getElementById('period-label');

// ==================== HELPERS D'AFFICHAGE ====================

const MOIS_NOMS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const MOIS_COURTS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun',
    'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

const LIBELLES_CATEGORIE = {
    inference: 'Inférence',
    infra: 'Infrastructure',
    licence: 'Licence',
    ocr: 'OCR',
    autre: 'Autre',
};

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// Un indicateur non calculable s'affiche « — », jamais NaN ni Infinity.
function eur(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    const d = (typeof digits === 'number') ? digits : 0;
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency', currency: 'EUR',
        minimumFractionDigits: d, maximumFractionDigits: d,
    }).format(v);
}

function pct(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    const d = (typeof digits === 'number') ? digits : 1;
    return v.toFixed(d).replace('.', ',') + ' %';
}

function nombre(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return new Intl.NumberFormat('fr-FR', {
        minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0,
    }).format(v);
}

function moisLibelle(m) {
    if (!KPICosts.isValidMonth(m)) return '—';
    return MOIS_NOMS[parseInt(m.slice(5, 7), 10) - 1] + ' ' + m.slice(0, 4);
}

// 'YYYY-MM-DD' -> '14 avril 2026'. Rend lisibles les bornes de l'historique.
function jourLibelle(j) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(j || ''));
    if (!m) return '—';
    return parseInt(m[3], 10) + ' ' + MOIS_NOMS[parseInt(m[2], 10) - 1] + ' ' + m[1];
}

// « de mai 2026 » mais « d'avril 2026 » : l'élision manquante se voit, dans un
// bandeau lu par la direction.
function deMois(m) {
    const lib = moisLibelle(m);
    return /^[aeiouâéêîôû]/i.test(lib) ? ("d'" + lib) : ('de ' + lib);
}

function moisCourt(m) {
    if (!KPICosts.isValidMonth(m)) return m;
    return MOIS_COURTS[parseInt(m.slice(5, 7), 10) - 1] + ' ' + m.slice(2, 4);
}

function moisCourant() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// ==================== AUTHENTIFICATION ====================

async function authenticateWithPassword(password) {
    try {
        // Le webhook passwordROI attend le mot de passe en TEXTE BRUT
        // (nœud rawBody côté n8n) — pas en JSON.
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: password,
        });
        if (!response.ok) return false;
        const urls = KPI.parseUrlsResponse(await response.text());

        OPENROUTER_URL = urls.OPENROUTER_USAGE_URL || urls.OPENROUTER_URL || '';

        // Tout nom commençant par OPENROUTER_EXPORT est traité comme un export
        // CSV. Ajouter une année, ou l'export d'un ancien compte, se fait donc
        // par UNE LIGNE de plus côté n8n — sans toucher à ce fichier.
        EXPORT_URLS = Object.keys(urls)
            .filter(k => /^OPENROUTER_EXPORT/.test(k))
            .sort()
            .map(k => ({ nom: k, url: urls[k] }));

        // Auth réussie dès qu'une URL connue revient. L'absence des fichiers
        // OpenRouter n'est PAS un échec d'authentification : la page reste
        // utilisable avec le seul registre saisi.
        return !!(urls.DESCRIPTIF_URL || urls.AUTOCONTACT_URL || urls.COMPARATEUR_URL
            || OPENROUTER_URL || EXPORT_URLS.length);
    } catch (e) {
        console.error('Auth error:', e);
        return false;
    }
}

// ==================== CHARGEMENT ====================

// Lit un fichier du bucket, quel que soit son format (relevés JSON du job ou
// export CSV). Une indisponibilité n'est jamais fatale : la page se charge avec
// les sources restantes, et le bandeau dit ce qui manque.
async function lireFichierDistant(url, keyName) {
    try {
        // Pas de cache : ces URLs signées vivent longtemps et le bucket ne
        // renvoie aucun en-tête de cache. Un fichier réexporté doit être vu
        // tout de suite, pas au prochain vidage de cache du navigateur.
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) {
            console.warn('Fichier OpenRouter indisponible (' + r.status + ') : ' + keyName);
            return null;
        }
        const lu = KPICosts.parseOpenRouterFichier(await r.text(), { keyName });
        if (!lu.snapshots.length) {
            console.warn('Fichier OpenRouter illisible : ' + keyName, lu.erreurs);
            return null;
        }
        return lu;
    } catch (e) {
        console.warn('Erreur de chargement du fichier OpenRouter ' + keyName + ' :', e);
        return null;
    }
}

// Recompose la liste des relevés à partir des trois sources.
//
// Un import local qui décrit EXACTEMENT le même fichier qu'un export du bucket
// est écarté : les compter tous les deux doublerait la dépense de la période.
// C'est le bucket qui gagne — il est partagé, l'import local ne vaut que pour
// ce navigateur — et l'écart est signalé, jamais silencieux.
function recomposerReleves() {
    importsIgnores = [];
    const clesEcartees = new Set();
    (historique ? historique.imports : []).forEach((i) => {
        const jumeau = exportsDistants.find(e => KPICosts.memeCouverture(e.meta, i.meta));
        if (!jumeau) return;
        importsIgnores.push({ ligne: i, source: jumeau.nom });
        if (i.meta && i.meta.keyName) clesEcartees.add(i.meta.keyName);
    });

    const locaux = (historique ? historique.snapshots : [])
        .filter(s => !clesEcartees.has(s.keyName));

    releves = [];
    exportsDistants.forEach((e) => { releves = releves.concat(e.snapshots); });
    releves = releves.concat(locaux, relevesJob);
    openRouter = KPICosts.monthlySpendFromSnapshots(releves);
}

// Les couvertures CSV connues, toutes sources confondues. Sert à savoir si un
// mois signalé « aveugle » est en réalité couvert par un export.
function couverturesCsv() {
    const out = exportsDistants.map(e => e.meta).filter(Boolean);
    (historique ? historique.imports : []).forEach((i) => {
        if (importsIgnores.some(x => x.ligne.id === i.id)) return;
        if (i.meta) out.push(i.meta);
    });
    return out;
}

// « a », « a et b », « a, b et c ».
function listeFr(items) {
    const l = (items || []).filter(Boolean);
    if (l.length <= 1) return l.join('');
    return l.slice(0, -1).join(', ') + ' et ' + l[l.length - 1];
}

async function loadData() {
    try {
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');

        params = KPICosts.loadParams();
        registre = KPICosts.loadRegistre();
        snapshot = KPICosts.readGainsSnapshot();

        // Toutes les sources OpenRouter sont OPTIONNELLES : sans aucune, la
        // page fonctionne sur le seul registre saisi. Elles se CUMULENT, car
        // chacune est une série de clés distincte et le moteur ne compte que
        // des deltas — le premier relevé d'une clé pose une référence et n'est
        // jamais compté comme de la dépense.
        historique = KPICosts.loadHistorique();

        exportsDistants = [];
        exportsIgnores = [];
        for (const e of EXPORT_URLS) {
            const lu = await lireFichierDistant(e.url, 'bucket:' + e.nom);
            if (!lu) continue;
            // Deux variables n8n pointant sur le même fichier doubleraient la
            // dépense. Une plage ET un total identiques ne peuvent pas être deux
            // comptes différents : on écarte, et on le dit. Un recouvrement
            // PARTIEL, lui, reste ambigu — il est signalé, jamais corrigé.
            const jumeau = exportsDistants.find(x => KPICosts.memeCouverture(x.meta, lu.meta));
            if (jumeau) {
                exportsIgnores.push({ nom: e.nom, source: jumeau.nom });
                console.warn('Export ' + e.nom + ' ignoré : identique à ' + jumeau.nom);
                continue;
            }
            exportsDistants.push({ nom: e.nom, meta: lu.meta, snapshots: lu.snapshots, type: lu.type });
        }

        relevesJob = [];
        if (OPENROUTER_URL) {
            const lu = await lireFichierDistant(OPENROUTER_URL, 'bucket:job');
            if (lu && lu.type === 'csv') {
                // Un export CSV rangé sous la variable du job : on le lit quand
                // même, plutôt que d'afficher une page vide sans explication.
                exportsDistants.push({
                    nom: 'OPENROUTER_USAGE_URL', meta: lu.meta,
                    snapshots: lu.snapshots, type: 'csv',
                });
            } else if (lu) {
                relevesJob = lu.snapshots;
            }
        }

        recomposerReleves();
        recompute();
        initPeriodeDefaults();

        // Le contenu doit être VISIBLE avant render() : Chart.js mesure son
        // conteneur à la construction, et un parent en display:none produit un
        // canvas de 0×0 qui ne se redimensionne pas tout seul ensuite.
        loadingEl.classList.add('hidden');
        mainContentEl.classList.remove('hidden');

        render();
    } catch (error) {
        console.error('Erreur de chargement:', error);
        loadingEl.classList.add('hidden');
        mainContentEl.classList.add('hidden');
        if (errorDetailEl) errorDetailEl.textContent = error.message || '';
        errorEl.classList.remove('hidden');
    }
}

// Recalcule l'agrégat mensuel à partir de l'état courant.
function recompute() {
    agregat = KPICosts.aggregateMonthly({ registre, openRouter, params });
}

// Tous les mois pour lesquels on a soit une dépense, soit un gain.
function moisDisponibles() {
    const set = new Set(Object.keys(agregat.parMois));
    if (snapshot && snapshot.byMonth) Object.keys(snapshot.byMonth).forEach(m => set.add(m));
    return Array.from(set).filter(KPICosts.isValidMonth).sort();
}

function initPeriodeDefaults() {
    const mois = moisDisponibles();
    periode.start = mois.length ? mois[0] : moisCourant();
    periode.end = mois.length ? mois[mois.length - 1] : moisCourant();
    if (periode.end < moisCourant() && mois.length) periode.end = mois[mois.length - 1];
    startMonthEl.value = periode.start;
    endMonthEl.value = periode.end;
}

// ==================== RENDU ====================

function render() {
    const start = periode.start;
    const end = periode.end;

    const depense = KPICosts.sumRange(agregat.parMois, start, end);
    const gains = KPICosts.gainsForRange(snapshot, start, end);
    const jours = KPICosts.daysInMonthRange(start, end);

    const effectifSnapshot = (snapshot && Number(snapshot.effectif)) || 0;
    const kpis = KPICosts.computeKpis({
        depenseEur: depense.totalEur,
        effectif: effectifSnapshot,
        utilisateursActifs: gains.utilisateursMaxMois,
        heuresGagnees: gains.heures,
        joursPeriode: jours,
        params,
    });

    periodLabelEl.textContent = (start === end)
        ? moisLibelle(start)
        : moisLibelle(start) + ' → ' + moisLibelle(end);

    renderCompleteness(depense, gains, start, end);
    renderHeadline(kpis, depense, gains, jours);
    renderBudget(depense);
    renderParCollaborateur(kpis, gains);
    renderStructure(depense, start, end);
    renderIgnorees(depense);
    renderRegistre();
    renderHistorique();
    renderParams();
    renderDepenseChart(start, end);
}

// Le périmètre réel de la dépense, dit explicitement. Sans cette mention, un
// coût partiel se lit comme un coût total.
function renderCompleteness(depense, gains, start, end) {
    const phrases = [];

    if (depense.totalEur <= 0) {
        phrases.push('Aucun coût relevé sur cette période : les indicateurs de coût affichent « — » plutôt que zéro, pour ne pas laisser croire que l\'IA ne coûte rien.');
    }

    if (openRouter && openRouter.premierMois) {
        // Chaque source se maintient à jour différemment : le lecteur doit
        // savoir laquelle il regarde, pas seulement sur quelle période.
        const couverture = deMois(openRouter.premierMois) + ' à ' + moisLibelle(openRouter.dernierMois);
        const nbLocaux = (historique ? historique.imports.length : 0) - importsIgnores.length;
        const sources = [];
        if (exportsDistants.length) {
            sources.push(exportsDistants.length > 1
                ? exportsDistants.length + ' exports CSV du bucket'
                : 'un export CSV du bucket');
        }
        if (nbLocaux > 0) {
            sources.push(nbLocaux > 1
                ? nbLocaux + ' exports importés dans ce navigateur'
                : 'un export importé dans ce navigateur');
        }
        if (relevesJob.length) sources.push('le relevé quotidien de l\'API OpenRouter');
        phrases.push(sources.length
            ? 'Inférence connue ' + couverture + ', par ' + listeFr(sources) + '.'
            : 'Inférence connue ' + couverture + '.');
        if (!relevesJob.length) {
            phrases.push('Aucun relevé automatique : ces montants sont figés à la date des exports '
                + 'et ne bougeront pas tant qu\'un export plus récent ne sera pas déposé.');
        }
        // Un relevé qui démarre en cours de route ne rend son mois incomplet
        // que si rien d'autre ne couvre ce mois-là. Un export CSV, lui, le
        // couvre : signaler quand même serait un faux signalement.
        const couvert = (m) => couverturesCsv().some(c => m
            && m >= KPICosts.monthKey(c.premierJour)
            && m <= KPICosts.monthKey(c.dernierJour));
        const aveugles = (openRouter.moisPartiels
            || (openRouter.moisPartiel ? [openRouter.moisPartiel] : []))
            .filter(m => !couvert(m));
        if (aveugles.length === 1) {
            phrases.push('Le mois ' + deMois(aveugles[0])
                + ' est incomplet : les relevés ont démarré alors que de la dépense avait déjà eu lieu.');
        } else if (aveugles.length > 1) {
            phrases.push('Plusieurs relevés ont démarré alors que de la dépense avait déjà eu lieu : '
                + aveugles.map(moisLibelle).join(', ') + ' sont incomplets.');
        }
        // Un export pris en cours de journée ne contient qu'une partie de
        // cette journée : le dire, sinon le dernier jour paraît creux.
        (historique ? historique.imports : []).forEach((i) => {
            if (importsIgnores.some(x => x.ligne.id === i.id)) return;
            if (i.meta && i.importeLe && String(i.importeLe).slice(0, 10) === i.meta.dernierJour) {
                phrases.push('Le ' + jourLibelle(i.meta.dernierJour)
                    + ' n\'est que partiel : l\'export a été pris pendant cette journée.');
            }
        });

        // Deux exports qui se recouvrent additionnent leur dépense sur la
        // période commune. C'est juste pour deux comptes réellement actifs en
        // même temps, faux pour un même compte exporté deux fois : dans le
        // doute on le signale, plutôt que de le taire ou de corriger d'office.
        const paires = KPICosts.chevauchements(couverturesCsv());
        if (paires.length) {
            const p = paires[0];
            phrases.push('Attention : deux exports se recouvrent du '
                + jourLibelle(p[1].premierJour) + ' au '
                + jourLibelle(p[0].dernierJour < p[1].dernierJour ? p[0].dernierJour : p[1].dernierJour)
                + ' — leur dépense s\'additionne sur la période commune. Si c\'est le même compte '
                + 'exporté deux fois, retirez-en un.');
        }

        if (exportsIgnores.length) {
            phrases.push(listeFr(exportsIgnores.map(e => e.nom))
                + (exportsIgnores.length > 1 ? ' ne sont pas comptés' : " n'est pas compté")
                + ' : même période et même total qu\'un autre export du bucket. '
                + 'Vérifiez la configuration n8n, deux variables pointent sur le même fichier.');
        }

        // Un import local doublonné par le bucket est écarté du total : le taire
        // ferait croire à une dépense manquante.
        if (importsIgnores.length) {
            phrases.push(importsIgnores.length
                + ' export(s) importé(s) dans ce navigateur ne sont pas comptés : le même fichier est '
                + 'déjà servi par le bucket. Vous pouvez les retirer sans rien perdre.');
        }
        if (openRouter.anomalies && openRouter.anomalies.length) {
            phrases.push(openRouter.anomalies.length + ' remise(s) à zéro de compteur détectée(s) — dépense estimée sur ces intervalles.');
        }
    } else {
        phrases.push('Aucun relevé OpenRouter : l\'inférence n\'est comptée que par les lignes saisies à la main.');
    }

    const manquantes = ['infra', 'ocr', 'licence']
        .filter(c => !depense.parCategorie[c])
        .map(c => LIBELLES_CATEGORIE[c].toLowerCase());
    if (manquantes.length) {
        phrases.push('Aucun coût de type ' + manquantes.join(', ')
            + ' saisi sur la période : la dépense affichée est donc une borne basse.');
    }

    if (!snapshot) {
        phrases.push('Instantané des gains absent : le ratio de levier et le coût par heure gagnée ne sont pas calculables. Passez par le tableau de bord dans cet onglet.');
    } else if (gains.moisCouverts === 0) {
        phrases.push('Aucun gain enregistré sur la période sélectionnée.');
    }

    setText('completeness-text', phrases.join(' '));
}

// Quand aucun coût n'est relevé, les tuiles dérivées affichent « — » : le
// sous-titre doit dire pourquoi, sinon l'utilisateur croit à un bug.
const SANS_COUT = 'aucun coût relevé sur la période';

function renderHeadline(kpis, depense, gains, jours) {
    const mesuree = kpis.depenseMesuree;

    setText('kpi-depense', eur(depense.totalEur));
    setText('kpi-depense-sub', mesuree
        ? eur(depense.openRouterEur) + ' OpenRouter · ' + eur(depense.registreEur) + ' saisi'
        : 'ni relevé OpenRouter, ni ligne saisie');

    setText('kpi-levier', kpis.ratioLevier === null ? '—' : '× ' + nombre(kpis.ratioLevier, 1));
    setText('kpi-levier-sub', kpis.gainEur === null
        ? 'gain valorisé indisponible'
        : (mesuree ? eur(kpis.gainEur) + ' de gain valorisé'
            : eur(kpis.gainEur) + ' de gain, ' + SANS_COUT));

    setText('kpi-cout-heure', eur(kpis.coutParHeureGagnee, 2));
    setText('kpi-cout-heure-sub', !mesuree ? SANS_COUT
        : (kpis.tauxHoraire === null || gains.heures === 0)
            ? 'aucune heure gagnée sur la période'
            : nombre(gains.heures) + ' h gagnées · valorisées ' + eur(kpis.tauxHoraire, 1) + '/h');

    setText('kpi-pct-masse', pct(kpis.pctMasseSalariale, 2));
    setText('kpi-pct-masse-sub', !mesuree ? SANS_COUT
        : params.masseSalarialeAnnuelle > 0
            ? 'masse proratisée sur ' + nombre(jours) + ' jours'
            : 'renseignez la masse salariale dans les réglages');
}

// Jauge de budget : couleurs INVERSÉES par rapport aux jauges d'objectifs du
// dashboard. Dépasser un objectif de gain est bon ; dépasser un budget non.
function renderBudget(depense) {
    const proj = KPICosts.projection({
        parMois: agregat.parMois,
        params,
        moisCourant: moisCourant(),
    });

    const budget = params.budgetAnnuelIA;
    setText('budget-target', budget > 0 ? eur(budget) + ' / an' : 'non défini');

    const ratio = (budget > 0) ? proj.realiseYTD / budget : null;
    updateBudgetGauge(ratio, proj.realiseYTD, budget);

    setText('budget-label', 'réalisé ' + new Date().getFullYear() + ' à fin ' + moisLibelle(moisCourant()));

    setText('runrate-value', proj.runRate3m === null ? '—' : eur(proj.runRate3m) + '/mois');
    setText('runrate-sub', proj.runRate3m === null
        ? 'aucun mois complet dans l\'historique'
        : 'moyenne des ' + proj.moisRunRate + ' dernier(s) mois complet(s)');

    setText('projection-value', proj.projectionAnnee === null ? '—' : eur(proj.projectionAnnee));
    setText('projection-sub', proj.projectionAnnee === null
        ? 'projection impossible sans mois complet'
        : eur(proj.realiseYTD) + ' réalisé + ' + proj.moisRestants + ' mois au run rate');

    if (proj.moisEpuisement === null) {
        setText('epuisement-value', '—');
        setText('epuisement-sub', budget > 0
            ? 'budget non atteint au run rate actuel'
            : 'définissez un budget annuel');
    } else {
        setText('epuisement-value', moisLibelle(proj.moisEpuisement));
        const depasse = proj.realiseYTD >= budget;
        setText('epuisement-sub', depasse ? 'budget déjà dépassé' : 'au run rate actuel');
    }

    renderBudgetChart(proj);
}

function updateBudgetGauge(ratio, realise, budget) {
    const arcEl = document.getElementById('budget-arc');
    const badge = document.getElementById('budget-badge');

    if (ratio === null) {
        if (arcEl) {
            arcEl.setAttribute('d', 'M 20 100');
            arcEl.setAttribute('stroke', '#e5e7eb');
        }
        setText('budget-value', '—');
        setText('budget-sub', 'budget annuel non défini');
        if (badge) {
            badge.textContent = '—';
            badge.className = 'px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-500';
        }
        return;
    }

    const capped = Math.min(Math.max(ratio, 0), 1);
    const color = ratio >= 1 ? '#ef4444'
        : ratio >= 0.85 ? '#f97316'
            : ratio >= 0.5 ? '#3b82f6'
                : '#94a3b8';

    const cx = 100, cy = 100, r = 80;
    let arcPath = 'M ' + (cx - r) + ' ' + cy;
    if (capped > 0) {
        const angle = Math.PI * (1 + capped);
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        arcPath += ' A ' + r + ' ' + r + ' 0 0 1 ' + x.toFixed(2) + ' ' + y.toFixed(2);
    }
    if (arcEl) {
        arcEl.setAttribute('d', arcPath);
        arcEl.setAttribute('stroke', color);
    }

    setText('budget-value', eur(realise));
    setText('budget-sub', ratio >= 1
        ? eur(realise - budget) + ' au-dessus du budget'
        : 'sur ' + eur(budget));

    if (badge) {
        badge.textContent = (ratio * 100).toFixed(0) + ' %';
        const classes = ratio >= 1 ? 'bg-red-100 text-red-700'
            : ratio >= 0.85 ? 'bg-orange-100 text-orange-700'
                : ratio >= 0.5 ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-500';
        badge.className = 'px-2.5 py-1 text-xs font-semibold rounded-full ' + classes;
    }
}

function renderParCollaborateur(kpis, gains) {
    const mesuree = kpis.depenseMesuree;

    setText('kpi-cout-collab', eur(kpis.coutParCollaborateur, 2));
    setText('kpi-cout-collab-sub', !mesuree ? SANS_COUT
        : kpis.effectif
            ? 'sur ' + nombre(kpis.effectif) + ' collaborateurs'
            : 'effectif inconnu — passez par le tableau de bord');

    setText('kpi-cout-actif', eur(kpis.coutParUtilisateurActif, 2));
    setText('kpi-cout-actif-sub', !mesuree ? SANS_COUT
        : gains.utilisateursMaxMois
            ? nombre(gains.utilisateursMaxMois) + ' utilisateurs actifs (mois le plus large)'
            : 'aucun utilisateur actif sur la période');

    setText('kpi-pour-mille', kpis.coutPourMilleDeCA === null
        ? '—'
        : nombre(kpis.coutPourMilleDeCA, 2) + ' ‰');
    setText('kpi-pour-mille-sub', !mesuree ? SANS_COUT : 'sur un CA de ' + eur(params.caGroupe));

    // Le rapport entre les deux coûts mesure la diffusion : plus il est élevé,
    // plus la dépense est portée par une minorité d'utilisateurs.
    let commentaire;
    if (!mesuree) {
        commentaire = 'Aucun coût relevé sur la période : branchez le relevé OpenRouter ou saisissez vos factures pour que ces deux indicateurs prennent un sens.';
    } else if (kpis.coutParCollaborateur === null || kpis.coutParUtilisateurActif === null) {
        commentaire = 'Le rapprochement des deux coûts demande un effectif et des utilisateurs actifs connus sur la période.';
    } else {
        const taux = kpis.utilisateursActifs / kpis.effectif;
        commentaire = 'La dépense est portée par ' + nombre(taux * 100, 0) + ' % de l\'effectif. '
            + 'Le coût par utilisateur actif (' + eur(kpis.coutParUtilisateurActif, 2)
            + ') mesure l\'intensité d\'usage réelle ; le coût par collaborateur ('
            + eur(kpis.coutParCollaborateur, 2) + ') mesure ce que coûte l\'IA rapportée à toute l\'entreprise. '
            + 'Élargir l\'adoption fait converger les deux.';
    }
    setText('collab-comment', commentaire);
}

function renderStructure(depense, start, end) {
    const total = depense.totalEur;
    const pf = total > 0 ? (depense.fixeEur / total) * 100 : 0;
    const pv = total > 0 ? (depense.variableEur / total) * 100 : 0;

    const barFixe = document.getElementById('structure-bar-fixe');
    const barVar = document.getElementById('structure-bar-variable');
    if (barFixe) barFixe.style.width = pf + '%';
    if (barVar) barVar.style.width = pv + '%';

    setText('structure-fixe', eur(depense.fixeEur) + (total > 0 ? ' · ' + pct(pf, 0) : ''));
    setText('structure-variable', eur(depense.variableEur) + (total > 0 ? ' · ' + pct(pv, 0) : ''));

    renderRepartition('categorie-list', depense.parCategorie, total,
        (k) => LIBELLES_CATEGORIE[k] || k);
    renderRepartition('fournisseur-list', depense.parFournisseur, total, (k) => k);

    // Concentration fournisseur : signal de dépendance.
    const fournisseurs = Object.keys(depense.parFournisseur)
        .map(k => ({ nom: k, montant: depense.parFournisseur[k] }))
        .sort((a, b) => b.montant - a.montant);
    if (!fournisseurs.length || total <= 0) {
        setText('concentration-text', 'Aucune dépense sur la période.');
    } else {
        const part = (fournisseurs[0].montant / total) * 100;
        setText('concentration-text', fournisseurs[0].nom + ' porte ' + pct(part, 0)
            + ' de la dépense' + (fournisseurs.length === 1
                ? ' — fournisseur unique sur la période.'
                : ' sur ' + fournisseurs.length + ' fournisseurs.'));
    }
}

function renderRepartition(containerId, mapping, total, libelle) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const lignes = Object.keys(mapping)
        .map(k => ({ cle: k, montant: mapping[k] }))
        .sort((a, b) => b.montant - a.montant);

    if (!lignes.length) {
        el.innerHTML = '<p class="text-gray-400 text-xs">Aucune dépense sur la période.</p>';
        return;
    }

    el.innerHTML = lignes.map(l => {
        const part = total > 0 ? (l.montant / total) * 100 : 0;
        return '<div>'
            + '<div class="flex items-center justify-between mb-1">'
            + '<span class="text-gray-600">' + KPI.escapeHtml(libelle(l.cle)) + '</span>'
            + '<span class="font-semibold text-gray-900">' + eur(l.montant) + '</span>'
            + '</div>'
            + '<div class="h-1.5 w-full rounded-full bg-gray-100">'
            + '<div class="h-1.5 rounded-full bg-indigo-400" style="width:' + part.toFixed(1) + '%"></div>'
            + '</div>'
            + '</div>';
    }).join('');
}

function renderIgnorees(depense) {
    const notice = document.getElementById('ignorees-notice');
    const list = document.getElementById('ignorees-list');
    if (!notice || !list) return;

    if (!depense.lignesIgnorees.length) {
        notice.classList.add('hidden');
        list.innerHTML = '';
        return;
    }
    notice.classList.remove('hidden');
    list.innerHTML = depense.lignesIgnorees.map(l =>
        '<li>' + moisLibelle(l.mois) + ' — ' + KPI.escapeHtml(l.fournisseur || '')
        + ' ' + nombre(l.montant, 2) + ' ' + KPI.escapeHtml(l.devise || '')
        + ' : ' + KPI.escapeHtml(l.motif) + '</li>'
    ).join('');
}

function renderRegistre() {
    const tbody = document.getElementById('registre-tbody');
    const empty = document.getElementById('registre-empty');
    if (!tbody) return;

    if (!registre.length) {
        tbody.innerHTML = '';
        if (empty) empty.classList.remove('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');

    const tri = registre.slice().sort((a, b) => (a.mois === b.mois)
        ? a.fournisseur.localeCompare(b.fournisseur)
        : (a.mois < b.mois ? 1 : -1));

    tbody.innerHTML = tri.map(l => {
        const enEuros = KPICosts.toEur(l.montant, l.devise, params.tauxUsdEur);
        return '<tr>'
            + '<td class="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">' + moisLibelle(l.mois) + '</td>'
            + '<td class="px-4 py-3 text-sm text-gray-600">' + KPI.escapeHtml(LIBELLES_CATEGORIE[l.categorie] || l.categorie) + '</td>'
            + '<td class="px-4 py-3 text-sm text-gray-900">' + KPI.escapeHtml(l.fournisseur) + '</td>'
            + '<td class="px-4 py-3 text-sm text-gray-500">' + KPI.escapeHtml(l.libelle || '—') + '</td>'
            + '<td class="px-4 py-3 text-sm text-gray-900 text-right whitespace-nowrap">' + nombre(l.montant, 2) + ' ' + KPI.escapeHtml(l.devise) + '</td>'
            + '<td class="px-4 py-3 text-sm text-gray-900 text-right whitespace-nowrap">' + eur(enEuros, 2) + '</td>'
            + '<td class="px-4 py-3 text-sm text-gray-600">' + (l.nature === 'fixe' ? 'Fixe' : 'Variable') + '</td>'
            + '<td class="px-4 py-3 text-right">'
            + '<button data-delete-id="' + KPI.escapeHtml(l.id) + '" class="text-xs text-red-600 hover:text-red-800">Supprimer</button>'
            + '</td>'
            + '</tr>';
    }).join('');
}

function renderParams() {
    document.getElementById('param-masse').value = params.masseSalarialeAnnuelle || '';
    document.getElementById('param-budget').value = params.budgetAnnuelIA || '';
    document.getElementById('param-taux').value = params.tauxUsdEur;
    document.getElementById('param-effectif').value = params.effectifOverride || '';
    document.getElementById('param-ca').value = params.caGroupe;
    document.getElementById('param-heures').value = params.heuresAnnuelles;
}

// ==================== GRAPHIQUES ====================

function renderDepenseChart(start, end) {
    const canvas = document.getElementById('depense-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    const mois = KPICosts.monthsRange(start, end);
    const openRouterSerie = mois.map(m => (agregat.parMois[m] ? agregat.parMois[m].openRouterEur : 0));
    const registreSerie = mois.map(m => (agregat.parMois[m] ? agregat.parMois[m].registreEur : 0));

    if (depenseChart) depenseChart.destroy();
    depenseChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: mois.map(moisCourt),
            datasets: [
                {
                    label: 'Inférence (OpenRouter)',
                    data: openRouterSerie,
                    backgroundColor: 'rgba(99, 102, 241, 0.85)',
                },
                {
                    label: 'Saisie manuelle',
                    data: registreSerie,
                    backgroundColor: 'rgba(100, 116, 139, 0.85)',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true, grid: { display: false } },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: { callback: (v) => eur(v) },
                },
            },
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ctx.dataset.label + ' : ' + eur(ctx.parsed.y, 2),
                    },
                },
            },
        },
    });
}

function renderBudgetChart(proj) {
    const canvas = document.getElementById('budget-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    const courant = moisCourant();
    const annee = courant.slice(0, 4);
    const mois = KPICosts.monthsRange(annee + '-01', annee + '-12');
    const indexCourant = parseInt(courant.slice(5, 7), 10) - 1;

    // Réalisé cumulé jusqu'au mois courant, puis null (la courbe s'arrête).
    let cumul = 0;
    const realise = mois.map((m, i) => {
        if (i > indexCourant) return null;
        cumul += agregat.parMois[m] ? agregat.parMois[m].totalEur : 0;
        return cumul;
    });

    // Projeté : prolonge le réalisé au run rate. Part du mois courant pour que
    // les deux courbes se rejoignent visuellement.
    const projete = mois.map((m, i) => {
        if (proj.runRate3m === null) return null;
        if (i < indexCourant) return null;
        if (i === indexCourant) return cumul;
        return cumul + proj.runRate3m * (i - indexCourant);
    });

    const budget = params.budgetAnnuelIA;
    const datasets = [
        {
            label: 'Réalisé cumulé',
            data: realise,
            borderColor: 'rgba(79, 70, 229, 1)',
            backgroundColor: 'rgba(79, 70, 229, 0.1)',
            fill: true,
            tension: 0.2,
            spanGaps: false,
        },
        {
            label: 'Projeté au run rate',
            data: projete,
            borderColor: 'rgba(148, 163, 184, 1)',
            borderDash: [6, 4],
            fill: false,
            tension: 0.2,
            pointRadius: 0,
        },
    ];
    if (budget > 0) {
        datasets.push({
            label: 'Budget annuel',
            data: mois.map(() => budget),
            borderColor: 'rgba(239, 68, 68, 1)',
            borderDash: [2, 3],
            fill: false,
            pointRadius: 0,
        });
    }

    if (budgetChart) budgetChart.destroy();
    budgetChart = new Chart(canvas, {
        type: 'line',
        data: { labels: mois.map(moisCourt), datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true, ticks: { callback: (v) => eur(v) } },
            },
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ctx.dataset.label + ' : ' + eur(ctx.parsed.y, 2),
                    },
                },
            },
        },
    });
}

// ==================== INTERACTIONS ====================

function onPeriodeChange() {
    const s = startMonthEl.value;
    const e = endMonthEl.value;
    if (!KPICosts.isValidMonth(s) || !KPICosts.isValidMonth(e)) return;
    if (s > e) {
        // Bornes inversées : on aligne la fin sur le début plutôt que d'afficher
        // une période vide sans explication.
        endMonthEl.value = s;
        periode.start = s;
        periode.end = s;
    } else {
        periode.start = s;
        periode.end = e;
    }
    render();
}

function onAddLigne() {
    const erreurEl = document.getElementById('ligne-error');
    const brut = {
        mois: document.getElementById('new-mois').value,
        categorie: document.getElementById('new-categorie').value,
        fournisseur: document.getElementById('new-fournisseur').value,
        libelle: document.getElementById('new-libelle').value,
        montant: document.getElementById('new-montant').value,
        devise: document.getElementById('new-devise').value,
        nature: document.getElementById('new-nature').value,
    };
    const v = KPICosts.validateLigne(brut);
    if (!v.ok) {
        erreurEl.textContent = v.erreurs.join(' · ');
        return;
    }
    erreurEl.textContent = '';
    registre.push(v.ligne);
    KPICosts.saveRegistre(registre);

    document.getElementById('new-fournisseur').value = '';
    document.getElementById('new-libelle').value = '';
    document.getElementById('new-montant').value = '';

    recompute();
    render();
}

function onDeleteLigne(id) {
    const ligne = registre.find(l => l.id === id);
    if (!ligne) return;
    const resume = moisLibelle(ligne.mois) + ' — ' + ligne.fournisseur
        + ' ' + nombre(ligne.montant, 2) + ' ' + ligne.devise;
    if (!window.confirm('Supprimer définitivement cette ligne ?\n\n' + resume)) return;

    registre = registre.filter(l => l.id !== id);
    KPICosts.saveRegistre(registre);
    recompute();
    render();
}

function onSaveParams() {
    const lu = {
        masseSalarialeAnnuelle: document.getElementById('param-masse').value,
        budgetAnnuelIA: document.getElementById('param-budget').value,
        tauxUsdEur: document.getElementById('param-taux').value,
        effectifOverride: document.getElementById('param-effectif').value,
        caGroupe: document.getElementById('param-ca').value,
        heuresAnnuelles: document.getElementById('param-heures').value,
    };
    params = KPICosts.normalizeParams(lu);
    KPICosts.saveParams(params);
    setText('params-status', 'Enregistré.');
    setTimeout(() => setText('params-status', ''), 2500);
    recompute();
    render();
}

function onExportJson() {
    const contenu = KPICosts.exportJson(registre, params, new Date().toISOString());
    const blob = new Blob([contenu], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'couts-ia-' + moisCourant() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// L'état de l'historique importé, dit en clair : sans période couverte
// affichée, un total de dépense ne veut rien dire. Un import par ligne — une
// migration de compte en produit légitimement plusieurs.
function renderHistorique() {
    const el = document.getElementById('historique-status');
    const btn = document.getElementById('clear-historique');
    if (!el) return;

    const taux = (params && params.tauxUsdEur) ? params.tauxUsdEur : undefined;
    const detail = (m) => jourLibelle(m.premierJour) + ' → ' + jourLibelle(m.dernierJour)
        + ' · ' + (m.nbJours || 0) + ' jours · '
        + eur(KPICosts.toEur(m.totalUsd, 'USD', taux))
        + ' (' + Number(m.totalUsd || 0).toFixed(2) + ' $)'
        + (m.modeles ? ' · ' + m.modeles.length + ' modèles' : '');

    const blocs = [];

    // Les exports du bucket : partagés, non modifiables depuis la page.
    if (exportsDistants.length) {
        const lignes = exportsDistants.map(e => '<li class="py-1">'
            + '<span class="font-medium text-gray-700">' + escapeHtml(e.nom) + '</span>'
            + '<span class="ml-2 inline-block rounded bg-green-100 px-1.5 py-0.5 text-[10px] '
            + 'font-medium text-green-800 align-middle">bucket · partagé</span> — '
            + escapeHtml(e.meta ? detail(e.meta) : e.snapshots.length + ' relevés')
            + '</li>').join('');
        blocs.push('<p class="font-medium text-gray-700">Servis par le bucket</p>'
            + '<ul class="divide-y divide-gray-100">' + lignes + '</ul>');
    }

    if (relevesJob.length) {
        blocs.push('<p class="text-gray-600">Relevé quotidien du job n8n : '
            + relevesJob.length + ' relevé(s).</p>');
    }

    // Les imports locaux : propres à ce navigateur, retirables.
    if (historique) {
        const lignes = historique.imports.map((i) => {
            const ignore = importsIgnores.find(x => x.ligne.id === i.id);
            return '<li class="flex items-baseline justify-between gap-3 py-1'
                + (ignore ? ' text-gray-400' : '') + '">'
                + '<span><span class="font-medium' + (ignore ? '' : ' text-gray-700') + '">'
                + escapeHtml(i.libelle) + '</span>'
                + (ignore
                    ? '<span class="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] '
                        + 'font-medium text-amber-800 align-middle">non compté · déjà dans '
                        + escapeHtml(ignore.source) + '</span>'
                    : '<span class="ml-2 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] '
                        + 'font-medium text-gray-600 align-middle">ce navigateur</span>')
                + ' — ' + escapeHtml(i.meta ? detail(i.meta) : '') + '</span>'
                + '<button type="button" data-remove-import="' + escapeHtml(i.id)
                + '" class="shrink-0 text-xs text-red-600 hover:underline">Retirer</button>'
                + '</li>';
        }).join('');
        blocs.push('<p class="mt-3 font-medium text-gray-700">Importés dans ce navigateur</p>'
            + '<ul class="divide-y divide-gray-100">' + lignes + '</ul>');
    }

    if (!blocs.length) {
        el.innerHTML = '';
        el.textContent = 'Aucun historique : ni export dans le bucket, ni import local, '
            + 'ni relevé du job n8n. La dépense d\'inférence est donc à zéro.';
        if (btn) btn.classList.add('hidden');
        return;
    }

    // Le total ne compte QUE ce qui entre réellement dans les indicateurs.
    const comptes = exportsDistants.map(e => e.meta).filter(Boolean)
        .concat((historique ? historique.imports : [])
            .filter(i => !importsIgnores.some(x => x.ligne.id === i.id))
            .map(i => i.meta).filter(Boolean));
    if (comptes.length > 1) {
        const total = comptes.reduce((a, m) => a + (Number(m.totalUsd) || 0), 0);
        blocs.push('<p class="mt-2 font-medium text-gray-700">Total compté : '
            + escapeHtml(eur(KPICosts.toEur(total, 'USD', taux)))
            + ' (' + total.toFixed(2) + ' $)</p>');
    }

    el.innerHTML = blocs.join('');
    if (btn) btn.classList.toggle('hidden', !historique);
}

// Les libellés viennent d'un nom de fichier choisi par l'utilisateur : jamais
// injectés tels quels dans du HTML.
function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// Import de l'export CSV « total usage » d'OpenRouter.
function onImportCsv(file) {
    const statut = document.getElementById('csv-status');
    const reader = new FileReader();
    reader.onload = () => {
        const res = KPICosts.parseOpenRouterCsv(String(reader.result));
        if (!res.ok) {
            statut.textContent = 'Import refusé : ' + res.erreurs.join(', ');
            return;
        }
        // L'import S'AJOUTE aux précédents : une migration de compte laisse
        // deux exports disjoints, et écraser le premier perdrait son passé.
        const message = 'Ajouter ' + res.meta.nbJours + ' jour(s) de dépense, du '
            + jourLibelle(res.meta.premierJour) + ' au ' + jourLibelle(res.meta.dernierJour)
            + ', pour ' + res.meta.totalUsd.toFixed(2) + ' $ ?'
            + (historique ? '\n\nIl s\'ajoutera aux ' + historique.imports.length
                + ' export(s) déjà importé(s), sans les remplacer.' : '')
            + (res.meta.nbIgnorees ? '\n\n' + res.meta.nbIgnorees + ' ligne(s) du fichier seront ignorées.' : '');
        if (!window.confirm(message)) {
            statut.textContent = 'Import annulé.';
            return;
        }
        const ajout = KPICosts.addHistorique(res, undefined, file.name || 'export CSV');
        if (!ajout.ok) {
            statut.textContent = (ajout.motif === 'doublon')
                ? 'Import refusé : ce fichier est déjà importé (même période, même total). '
                    + 'L\'ajouter compterait la dépense deux fois.'
                : 'Enregistrement impossible : ' + ajout.motif + '.';
            return;
        }
        rechargerReleves();
        statut.textContent = res.meta.nbJours + ' jour(s) ajouté(s)'
            + (res.meta.nbIgnorees ? ', ' + res.meta.nbIgnorees + ' ligne(s) ignorée(s)' : '') + '.';
        recompute();
        initPeriodeDefaults();
        render();
    };
    reader.onerror = () => { statut.textContent = 'Fichier illisible.'; };
    reader.readAsText(file);
}

// Recharge les imports locaux depuis le stockage après un ajout ou un retrait.
// Les sources distantes (exports du bucket, relevés du job) vivent dans leurs
// propres variables : elles n'ont pas à être refetchées pour autant.
function rechargerReleves() {
    historique = KPICosts.loadHistorique();
    recomposerReleves();
    recompute();
    initPeriodeDefaults();
    render();
}

function onRemoveImport(id) {
    if (!historique) return;
    const cible = historique.imports.find(i => i.id === id);
    if (!cible) return;
    const m = cible.meta || {};
    if (!window.confirm('Retirer « ' + cible.libelle + ' » ('
        + jourLibelle(m.premierJour) + ' → ' + jourLibelle(m.dernierJour)
        + ') ? La dépense de cette période disparaîtra des indicateurs.')) return;
    KPICosts.removeHistorique(id);
    rechargerReleves();
    document.getElementById('csv-status').textContent = 'Export retiré.';
}

function onClearHistorique() {
    if (!historique) return;
    if (!window.confirm('Supprimer les ' + historique.imports.length
        + ' export(s) importé(s) (' + jourLibelle(historique.premierJour) + ' → '
        + jourLibelle(historique.dernierJour)
        + ') ? La dépense d\'inférence de cette période disparaîtra des indicateurs.')) return;
    KPICosts.clearHistorique();
    rechargerReleves();
    document.getElementById('csv-status').textContent = 'Historique supprimé.';
}

function onImportJson(file) {
    const statut = document.getElementById('import-status');
    const reader = new FileReader();
    reader.onload = () => {
        const res = KPICosts.importJson(String(reader.result));
        if (!res.ok) {
            statut.textContent = 'Import refusé : ' + res.erreurs.join(', ');
            return;
        }
        // L'import REMPLACE le registre : on le dit avant, pas après.
        const message = 'Remplacer les ' + registre.length + ' ligne(s) actuelles par '
            + res.registre.length + ' ligne(s) importée(s) ?'
            + (res.erreurs.length ? '\n\n' + res.erreurs.length + ' ligne(s) du fichier seront ignorées.' : '');
        if (!window.confirm(message)) {
            statut.textContent = 'Import annulé.';
            return;
        }
        registre = res.registre;
        params = res.parametres;
        KPICosts.saveRegistre(registre);
        KPICosts.saveParams(params);
        statut.textContent = res.registre.length + ' ligne(s) importée(s)'
            + (res.erreurs.length ? ', ' + res.erreurs.length + ' ignorée(s)' : '') + '.';
        recompute();
        initPeriodeDefaults();
        render();
    };
    reader.onerror = () => { statut.textContent = 'Fichier illisible.'; };
    reader.readAsText(file);
}

function bindEvents() {
    startMonthEl.addEventListener('change', onPeriodeChange);
    endMonthEl.addEventListener('change', onPeriodeChange);
    resetPeriodBtn.addEventListener('click', () => {
        initPeriodeDefaults();
        render();
    });

    document.getElementById('add-ligne').addEventListener('click', onAddLigne);
    document.getElementById('save-params').addEventListener('click', onSaveParams);
    document.getElementById('export-json').addEventListener('click', onExportJson);

    document.getElementById('import-csv-input').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) onImportCsv(file);
        e.target.value = ''; // permet de réimporter le même fichier
    });
    document.getElementById('clear-historique').addEventListener('click', onClearHistorique);

    // Délégation : la liste des imports est réécrite à chaque rendu.
    document.getElementById('historique-status').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-remove-import]');
        if (btn) onRemoveImport(btn.getAttribute('data-remove-import'));
    });

    document.getElementById('import-json-input').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) onImportJson(file);
        e.target.value = ''; // permet de réimporter le même fichier
    });

    // Délégation : le tableau est réécrit à chaque rendu.
    document.getElementById('registre-tbody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-delete-id]');
        if (btn) onDeleteLigne(btn.getAttribute('data-delete-id'));
    });
}

// ==================== INIT ====================

(async function init() {
    bindEvents();

    // Pas de cache de réponse webhook : les URLs sont SIGNÉES (12 h), un cache
    // servirait des liens expirés.
    localStorage.removeItem('roi_auth_result');

    const storedPwd = localStorage.getItem('roi_password');
    if (storedPwd) {
        const ok = await authenticateWithPassword(storedPwd);
        if (ok) { await loadData(); return; }
    }

    loadingEl.classList.add('hidden');
    const loginModal = document.createElement('div');
    loginModal.className = 'fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50';
    loginModal.innerHTML = '<div class="bg-white rounded-lg shadow-xl p-8 w-96">'
        + '<h2 class="text-xl font-bold text-gray-900 mb-6">Accès sécurisé</h2>'
        + '<form id="login-form">'
        + '<input type="password" id="pwd-input" placeholder="Mot de passe" class="w-full px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4" required />'
        + '<p id="login-error" class="hidden text-red-600 text-sm mb-3">Mot de passe incorrect.</p>'
        + '<button type="submit" class="w-full px-4 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium">Se connecter</button>'
        + '</form></div>';
    document.body.appendChild(loginModal);

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('pwd-input').value;
        const ok = await authenticateWithPassword(pwd);
        if (ok) {
            localStorage.setItem('roi_password', pwd);
            document.body.removeChild(loginModal);
            await loadData();
        } else {
            document.getElementById('login-error').classList.remove('hidden');
        }
    });
})();
