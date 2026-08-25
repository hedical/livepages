// Tests du module shared/costs.js (pilotage économique)
// Lancer :  node --test tests/
// (Node >= 18, aucune dépendance)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/costs.js');

// Faux storage : suffit à tester load/save sans navigateur.
function fakeStore(initial) {
    const map = new Map(Object.entries(initial || {}));
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
        _dump: () => Object.fromEntries(map),
    };
}

// Relevé OpenRouter brut.
function releve(ts, usage, keyName) {
    return { ts, usage, keyName: keyName || 'prod' };
}

// ===================== HELPERS MOIS =====================

test('monthKey — ISO, Date et timestamp, en UTC', () => {
    assert.equal(C.monthKey('2026-08-24T10:00:00.000Z'), '2026-08');
    assert.equal(C.monthKey(new Date('2026-01-01T00:00:00.000Z')), '2026-01');
    assert.equal(C.monthKey(Date.UTC(2026, 11, 31)), '2026-12');
});

test('monthKey — date invalide retourne null', () => {
    assert.equal(C.monthKey('pas une date'), null);
});

test('addMonths — passage d annee dans les deux sens', () => {
    assert.equal(C.addMonths('2026-12', 1), '2027-01');
    assert.equal(C.addMonths('2026-01', -1), '2025-12');
    assert.equal(C.addMonths('2026-06', -18), '2024-12');
    assert.equal(C.addMonths('2026-13', 1), null);
});

test('monthsRange — inclusif, et vide si bornes inversees', () => {
    assert.deepEqual(C.monthsRange('2026-11', '2027-01'), ['2026-11', '2026-12', '2027-01']);
    assert.deepEqual(C.monthsRange('2026-05', '2026-05'), ['2026-05']);
    assert.deepEqual(C.monthsRange('2026-05', '2026-04'), []);
    assert.deepEqual(C.monthsRange('nope', '2026-04'), []);
});

test('daysInMonthRange — annee pleine, annee bissextile, mois seul', () => {
    assert.equal(C.daysInMonthRange('2026-01', '2026-12'), 365);
    assert.equal(C.daysInMonthRange('2028-01', '2028-12'), 366);
    assert.equal(C.daysInMonthRange('2026-02', '2026-02'), 28);
    assert.equal(C.daysInMonthRange('2026-05', '2026-04'), 0);
});

// ===================== DEVISES =====================

test('toEur — USD converti, EUR inchange', () => {
    assert.equal(C.toEur(100, 'USD', 0.9), 90);
    assert.equal(C.toEur(100, 'EUR', 0.9), 100);
});

test('toEur — taux absent ou absurde retombe sur le defaut, pas sur zero', () => {
    assert.equal(C.toEur(100, 'USD', 0), 100 * C.DEFAULT_PARAMS.tauxUsdEur);
    assert.equal(C.toEur(100, 'USD', undefined), 100 * C.DEFAULT_PARAMS.tauxUsdEur);
    assert.equal(C.toEur(100, 'USD', -1), 100 * C.DEFAULT_PARAMS.tauxUsdEur);
});

test('toEur — montant non numerique vaut zero', () => {
    assert.equal(C.toEur('abc', 'EUR', 0.9), 0);
    assert.equal(C.toEur(null, 'USD', 0.9), 0);
});

// ===================== REGISTRE =====================

test('validateLigne — ligne complete acceptee, defauts appliques', () => {
    const r = C.validateLigne({ mois: '2026-08', categorie: 'infra', fournisseur: 'Supabase', montant: 25 });
    assert.equal(r.ok, true);
    assert.equal(r.ligne.devise, 'EUR');
    assert.equal(r.ligne.nature, 'variable');
    assert.ok(r.ligne.id);
});

test('validateLigne — montant vide ou nul refuse, pas converti en zero', () => {
    // Number('') vaut 0 : sans garde, un champ laisse vide passerait en ligne a 0 EUR.
    assert.equal(C.validateLigne({ mois: '2026-08', categorie: 'infra', fournisseur: 'X', montant: '' }).ok, false);
    assert.equal(C.validateLigne({ mois: '2026-08', categorie: 'infra', fournisseur: 'X', montant: 0 }).ok, false);
    assert.match(
        C.validateLigne({ mois: '2026-08', categorie: 'infra', fournisseur: 'X', montant: '' }).erreurs.join(),
        /montant/
    );
});

test('validateLigne — refus mois, montant, categorie, fournisseur', () => {
    assert.equal(C.validateLigne({ mois: '2026-8', categorie: 'infra', fournisseur: 'X', montant: 1 }).ok, false);
    assert.equal(C.validateLigne({ mois: '2026-13', categorie: 'infra', fournisseur: 'X', montant: 1 }).ok, false);
    assert.equal(C.validateLigne({ mois: '2026-08', categorie: 'infra', fournisseur: 'X', montant: -5 }).ok, false);
    assert.equal(C.validateLigne({ mois: '2026-08', categorie: 'zzz', fournisseur: 'X', montant: 1 }).ok, false);
    assert.equal(C.validateLigne({ mois: '2026-08', categorie: 'infra', fournisseur: '  ', montant: 1 }).ok, false);
});

test('validateLigne — cumule les motifs de refus', () => {
    const r = C.validateLigne({});
    assert.equal(r.ok, false);
    assert.ok(r.erreurs.length >= 3);
});

test('loadRegistre / saveRegistre — aller-retour et rejet des lignes invalides', () => {
    const st = fakeStore();
    C.saveRegistre([
        { mois: '2026-08', categorie: 'ocr', fournisseur: 'Mistral', montant: 12, devise: 'USD' },
        { mois: 'invalide', categorie: 'ocr', fournisseur: 'Mistral', montant: 12 },
    ], st);
    const lu = C.loadRegistre(st);
    assert.equal(lu.length, 1);
    assert.equal(lu[0].fournisseur, 'Mistral');
    assert.equal(lu[0].devise, 'USD');
});

test('loadRegistre — JSON corrompu ne casse pas la page', () => {
    const st = fakeStore({ kpi_couts_ia: '{ ceci nest pas du json' });
    assert.deepEqual(C.loadRegistre(st), []);
});

test('loadRegistre — storage absent retourne un registre vide', () => {
    assert.deepEqual(C.loadRegistre(null), []);
});

// ===================== PARAMETRES =====================

test('normalizeParams — defauts et bornes', () => {
    const p = C.normalizeParams({});
    assert.equal(p.caGroupe, 44000000);
    assert.equal(p.heuresAnnuelles, 1607);
    assert.equal(p.tauxUsdEur, 0.92);
    assert.equal(p.effectifOverride, null);
    assert.equal(p.masseSalarialeAnnuelle, 0);
});

test('normalizeParams — valeurs absurdes remplacees, pas propagees', () => {
    const p = C.normalizeParams({ caGroupe: 0, heuresAnnuelles: -3, tauxUsdEur: 'abc', masseSalarialeAnnuelle: -10, effectifOverride: 0 });
    assert.equal(p.caGroupe, 44000000);
    assert.equal(p.heuresAnnuelles, 1607);
    assert.equal(p.tauxUsdEur, 0.92);
    assert.equal(p.masseSalarialeAnnuelle, 0);
    assert.equal(p.effectifOverride, null);
});

test('loadParams / saveParams — aller-retour', () => {
    const st = fakeStore();
    C.saveParams({ masseSalarialeAnnuelle: 12000000, budgetAnnuelIA: 50000, effectifOverride: 200 }, st);
    const p = C.loadParams(st);
    assert.equal(p.masseSalarialeAnnuelle, 12000000);
    assert.equal(p.budgetAnnuelIA, 50000);
    assert.equal(p.effectifOverride, 200);
});

// ===================== PARSING RELEVES OPENROUTER =====================

test('parseOpenRouterUsage — tableau JSON direct', () => {
    const r = C.parseOpenRouterUsage([releve('2026-08-01T00:00:00Z', 10)]);
    assert.equal(r.length, 1);
    assert.equal(r[0].usageCumule, 10);
    assert.equal(r[0].keyName, 'prod');
});

test('parseOpenRouterUsage — enveloppe n8n [{data:"..."}]', () => {
    const inner = JSON.stringify([releve('2026-08-01T00:00:00Z', 10)]);
    assert.equal(C.parseOpenRouterUsage([{ data: inner }]).length, 1);
});

test('parseOpenRouterUsage — enveloppe {data:[...]} et chaine JSON brute', () => {
    assert.equal(C.parseOpenRouterUsage({ data: [releve('2026-08-01T00:00:00Z', 10)] }).length, 1);
    assert.equal(C.parseOpenRouterUsage(JSON.stringify([releve('2026-08-01T00:00:00Z', 10)])).length, 1);
});

test('parseOpenRouterUsage — lignes inexploitables ecartees, pas de crash', () => {
    const r = C.parseOpenRouterUsage([
        releve('2026-08-01T00:00:00Z', 10),
        releve('pas une date', 10),
        releve('2026-08-02T00:00:00Z', -5),
        releve('2026-08-03T00:00:00Z', 'abc'),
        null,
    ]);
    assert.equal(r.length, 1);
});

test('parseOpenRouterUsage — entree non exploitable retourne un tableau vide', () => {
    assert.deepEqual(C.parseOpenRouterUsage('pas du json'), []);
    assert.deepEqual(C.parseOpenRouterUsage(null), []);
    assert.deepEqual(C.parseOpenRouterUsage(42), []);
});

// ===================== DELTA DE CUMULE =====================

test('spreadDelta — intervalle interne a un mois', () => {
    const acc = {};
    C.spreadDelta(Date.UTC(2026, 7, 5), Date.UTC(2026, 7, 15), 100, acc);
    assert.deepEqual(Object.keys(acc), ['2026-08']);
    assert.equal(acc['2026-08'], 100);
});

test('spreadDelta — intervalle a cheval reparti au prorata des jours', () => {
    const acc = {};
    // 31 jan 00:00 -> 2 fev 00:00 : un jour dans chaque mois.
    C.spreadDelta(Date.UTC(2026, 0, 31), Date.UTC(2026, 1, 2), 300, acc);
    assert.equal(acc['2026-01'], 150);
    assert.equal(acc['2026-02'], 150);
});

test('spreadDelta — conserve le total sur une lacune de plusieurs mois', () => {
    const acc = {};
    C.spreadDelta(Date.UTC(2026, 0, 15), Date.UTC(2026, 3, 10), 1000, acc);
    const total = Object.values(acc).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1000) < 1e-9);
    assert.deepEqual(Object.keys(acc).sort(), ['2026-01', '2026-02', '2026-03', '2026-04']);
});

test('spreadDelta — delta nul ou negatif, ou bornes inversees : sans effet', () => {
    const acc = {};
    C.spreadDelta(Date.UTC(2026, 0, 15), Date.UTC(2026, 0, 20), 0, acc);
    C.spreadDelta(Date.UTC(2026, 0, 15), Date.UTC(2026, 0, 20), -10, acc);
    C.spreadDelta(Date.UTC(2026, 0, 20), Date.UTC(2026, 0, 15), 10, acc);
    assert.deepEqual(acc, {});
});

test('monthlySpendFromSnapshots — depense = croissance du cumule', () => {
    const r = C.monthlySpendFromSnapshots(C.parseOpenRouterUsage([
        releve('2026-08-01T00:00:00Z', 0),
        releve('2026-08-15T00:00:00Z', 120),
        releve('2026-09-01T00:00:00Z', 200),
    ]));
    assert.ok(Math.abs(r.usdParMois['2026-08'] - 200) < 1e-9);
    assert.equal(r.usdParMois['2026-09'], undefined);
    assert.equal(r.premierMois, '2026-08');
});

test('monthlySpendFromSnapshots — un releve manquant ne perd pas le mois', () => {
    // Trou de 20 jours entre deux relevés : le total du mois reste exact.
    const r = C.monthlySpendFromSnapshots(C.parseOpenRouterUsage([
        releve('2026-08-01T00:00:00Z', 0),
        releve('2026-08-21T00:00:00Z', 300),
        releve('2026-09-01T00:00:00Z', 400),
    ]));
    assert.ok(Math.abs(r.usdParMois['2026-08'] - 400) < 1e-9);
});

test('monthlySpendFromSnapshots — compteur redemarre : aucun delta negatif', () => {
    const r = C.monthlySpendFromSnapshots(C.parseOpenRouterUsage([
        releve('2026-08-01T00:00:00Z', 0),
        releve('2026-08-15T00:00:00Z', 500),
        releve('2026-08-25T00:00:00Z', 50), // clé recréée
    ]));
    assert.ok(r.usdParMois['2026-08'] >= 500);
    assert.equal(r.anomalies.length, 1);
    assert.equal(r.anomalies[0].motif, 'compteur redémarré');
    Object.values(r.usdParMois).forEach(v => assert.ok(v >= 0));
});

test('monthlySpendFromSnapshots — plusieurs cles additionnees', () => {
    const r = C.monthlySpendFromSnapshots(C.parseOpenRouterUsage([
        releve('2026-08-01T00:00:00Z', 0, 'chat'),
        releve('2026-09-01T00:00:00Z', 100, 'chat'),
        releve('2026-08-01T00:00:00Z', 0, 'descriptif'),
        releve('2026-09-01T00:00:00Z', 40, 'descriptif'),
    ]));
    assert.ok(Math.abs(r.usdParMois['2026-08'] - 140) < 1e-9);
    assert.equal(r.nbCles, 2);
});

test('monthlySpendFromSnapshots — premier mois partiel seulement si cumule initial non nul', () => {
    const depuisZero = C.monthlySpendFromSnapshots(C.parseOpenRouterUsage([
        releve('2026-08-01T00:00:00Z', 0),
        releve('2026-09-01T00:00:00Z', 100),
    ]));
    assert.equal(depuisZero.moisPartiel, null);

    const avecPasse = C.monthlySpendFromSnapshots(C.parseOpenRouterUsage([
        releve('2026-08-01T00:00:00Z', 4500),
        releve('2026-09-01T00:00:00Z', 4600),
    ]));
    assert.equal(avecPasse.moisPartiel, '2026-08');
});

test('monthlySpendFromSnapshots — moisPartiel designe la cle aveugle, pas la plus ancienne', () => {
    // Cas du relais : une serie complete depuis avril (ancre a zero) et une cle
    // du job qui entre en scene en aout avec tout le passe du compte au compteur.
    // Accuser avril serait faux : c'est aout que cette cle-la ne detaille pas.
    const r = C.monthlySpendFromSnapshots(C.parseOpenRouterUsage([
        { ts: '2026-04-01T00:00:00Z', keyName: 'export-csv', usageCumule: 0 },
        { ts: '2026-05-01T00:00:00Z', keyName: 'export-csv', usageCumule: 100 },
        { ts: '2026-08-01T00:00:00Z', keyName: 'cle-job', usageCumule: 30000 },
        { ts: '2026-09-01T00:00:00Z', keyName: 'cle-job', usageCumule: 30050 },
    ]));
    assert.equal(r.moisPartiel, '2026-08');
    assert.equal(r.nbCles, 2);
    // Et le cumule de reference de la cle du job n'est jamais compte en depense.
    assert.ok(Math.abs(r.usdParMois['2026-04'] - 100) < 1e-9);
    assert.ok(Math.abs(r.usdParMois['2026-08'] - 50) < 1e-9);
    assert.equal(r.usdParMois['2026-05'], undefined);
});

test('monthlySpendFromSnapshots — toutes les cles partant de zero : aucun mois partiel', () => {
    const r = C.monthlySpendFromSnapshots(C.parseOpenRouterUsage([
        { ts: '2026-04-01T00:00:00Z', keyName: 'a', usageCumule: 0 },
        { ts: '2026-05-01T00:00:00Z', keyName: 'a', usageCumule: 10 },
        { ts: '2026-06-01T00:00:00Z', keyName: 'b', usageCumule: 0 },
        { ts: '2026-07-01T00:00:00Z', keyName: 'b', usageCumule: 20 },
    ]));
    assert.equal(r.moisPartiel, null);
});

test('monthlySpendFromSnapshots — tous les mois aveugles sont listes', () => {
    // Deux cles entrant en scene a des dates differentes, chacune avec du passe
    // au compteur : les deux lacunes doivent etre visibles, pas seulement la
    // plus ancienne, sinon la seconde passe en silence.
    const r = C.monthlySpendFromSnapshots(C.parseOpenRouterUsage([
        { ts: '2026-04-01T00:00:00Z', keyName: 'complete', usageCumule: 0 },
        { ts: '2026-05-01T00:00:00Z', keyName: 'complete', usageCumule: 100 },
        { ts: '2026-06-01T00:00:00Z', keyName: 'aveugle-juin', usageCumule: 500 },
        { ts: '2026-07-01T00:00:00Z', keyName: 'aveugle-juin', usageCumule: 560 },
        { ts: '2026-11-01T00:00:00Z', keyName: 'aveugle-nov', usageCumule: 900 },
        { ts: '2026-12-01T00:00:00Z', keyName: 'aveugle-nov', usageCumule: 950 },
    ]));
    assert.deepEqual(r.moisPartiels, ['2026-06', '2026-11']);
    assert.equal(r.moisPartiel, '2026-06'); // le plus ancien, pour compatibilite
});

test('monthlySpendFromSnapshots — aucune cle aveugle : liste vide', () => {
    const r = C.monthlySpendFromSnapshots(C.parseOpenRouterUsage([
        { ts: '2026-04-01T00:00:00Z', keyName: 'a', usageCumule: 0 },
        { ts: '2026-05-01T00:00:00Z', keyName: 'a', usageCumule: 10 },
    ]));
    assert.deepEqual(r.moisPartiels, []);
    assert.equal(r.moisPartiel, null);
});

test('monthlySpendFromSnapshots — un seul releve ne produit aucune depense', () => {
    const r = C.monthlySpendFromSnapshots(C.parseOpenRouterUsage([releve('2026-08-01T00:00:00Z', 100)]));
    assert.deepEqual(r.usdParMois, {});
    assert.equal(r.premierMois, null);
});

// ===================== AGREGATION ET RECONCILIATION =====================

test('aggregateMonthly — OpenRouter converti en euros', () => {
    const agg = C.aggregateMonthly({
        openRouter: { usdParMois: { '2026-08': 100 } },
        registre: [],
        params: { tauxUsdEur: 0.9 },
    });
    assert.equal(agg.parMois['2026-08'].openRouterEur, 90);
    assert.equal(agg.parMois['2026-08'].totalEur, 90);
    assert.equal(agg.parMois['2026-08'].variableEur, 90);
});

test('aggregateMonthly — ligne inference sur un mois couvert : exclue ET signalee', () => {
    const agg = C.aggregateMonthly({
        openRouter: { usdParMois: { '2026-08': 100 } },
        registre: [
            { id: 'l1', mois: '2026-08', categorie: 'inference', fournisseur: 'OpenRouter', montant: 95, devise: 'EUR', nature: 'variable' },
        ],
        params: { tauxUsdEur: 1 },
    });
    const m = agg.parMois['2026-08'];
    assert.equal(m.registreEur, 0);
    assert.equal(m.totalEur, 100);
    assert.equal(m.lignesIgnorees.length, 1);
    assert.equal(m.lignesIgnorees[0].id, 'l1');
    assert.match(m.lignesIgnorees[0].motif, /OpenRouter/);
});

test('aggregateMonthly — ligne inference sur un mois NON couvert : comptee', () => {
    const agg = C.aggregateMonthly({
        openRouter: { usdParMois: { '2026-08': 100 } },
        registre: [
            { id: 'l1', mois: '2026-05', categorie: 'inference', fournisseur: 'OpenRouter', montant: 80, devise: 'EUR', nature: 'variable' },
        ],
        params: { tauxUsdEur: 1 },
    });
    assert.equal(agg.parMois['2026-05'].totalEur, 80);
    assert.equal(agg.parMois['2026-05'].lignesIgnorees.length, 0);
});

test('aggregateMonthly — hors inference jamais evince, meme sur un mois couvert', () => {
    const agg = C.aggregateMonthly({
        openRouter: { usdParMois: { '2026-08': 100 } },
        registre: [
            { id: 'i', mois: '2026-08', categorie: 'infra', fournisseur: 'Supabase', montant: 25, devise: 'EUR', nature: 'fixe' },
            { id: 'o', mois: '2026-08', categorie: 'ocr', fournisseur: 'Mistral', montant: 40, devise: 'EUR', nature: 'variable' },
        ],
        params: { tauxUsdEur: 1 },
    });
    const m = agg.parMois['2026-08'];
    assert.equal(m.totalEur, 165);
    assert.equal(m.fixeEur, 25);
    assert.equal(m.variableEur, 140); // 100 inférence + 40 OCR
    assert.equal(m.parCategorie.infra, 25);
    assert.equal(m.parFournisseur.Mistral, 40);
    assert.equal(m.parFournisseur.OpenRouter, 100);
});

test('aggregateMonthly — fixe + variable = total', () => {
    const agg = C.aggregateMonthly({
        openRouter: { usdParMois: { '2026-08': 100 } },
        registre: [
            { id: 'a', mois: '2026-08', categorie: 'licence', fournisseur: 'n8n', montant: 50, devise: 'EUR', nature: 'fixe' },
            { id: 'b', mois: '2026-08', categorie: 'autre', fournisseur: 'X', montant: 10, devise: 'EUR', nature: 'variable' },
        ],
        params: { tauxUsdEur: 1 },
    });
    const m = agg.parMois['2026-08'];
    assert.equal(m.fixeEur + m.variableEur, m.totalEur);
});

test('aggregateMonthly — sans aucune source : agregat vide, pas d erreur', () => {
    const agg = C.aggregateMonthly({});
    assert.deepEqual(agg.parMois, {});
    assert.deepEqual(agg.moisCouvertsOpenRouter, []);
});

test('sumRange — somme la plage et ignore le hors-plage', () => {
    const agg = C.aggregateMonthly({
        openRouter: { usdParMois: { '2026-07': 10, '2026-08': 20, '2026-09': 40 } },
        registre: [],
        params: { tauxUsdEur: 1 },
    });
    const s = C.sumRange(agg.parMois, '2026-07', '2026-08');
    assert.equal(s.totalEur, 30);
    assert.equal(s.moisAvecDonnees, 2);
    assert.equal(C.sumRange(agg.parMois, '2026-01', '2026-12').totalEur, 70);
    assert.equal(C.sumRange(agg.parMois, '2025-01', '2025-12').totalEur, 0);
});

test('sumRange — remonte les lignes ignorees de la plage', () => {
    const agg = C.aggregateMonthly({
        openRouter: { usdParMois: { '2026-08': 100 } },
        registre: [{ id: 'l1', mois: '2026-08', categorie: 'inference', fournisseur: 'OpenRouter', montant: 95, devise: 'EUR', nature: 'variable' }],
        params: { tauxUsdEur: 1 },
    });
    assert.equal(C.sumRange(agg.parMois, '2026-08', '2026-08').lignesIgnorees.length, 1);
});

// ===================== KPIS =====================

test('ratio — division gardee, jamais Infinity ni NaN', () => {
    assert.equal(C.ratio(10, 2), 5);
    assert.equal(C.ratio(10, 0), null);
    assert.equal(C.ratio('abc', 2), null);
    assert.equal(C.ratio(10, null), null);
});

test('computeKpis — taux horaire identique a celui du dashboard', () => {
    const k = C.computeKpis({ depenseEur: 0, effectif: 192, params: {} });
    assert.ok(Math.abs(k.tauxHoraire - 44000000 / (192 * 1607)) < 1e-9);
});

test('computeKpis — cout par collaborateur et par utilisateur actif', () => {
    const k = C.computeKpis({ depenseEur: 9600, effectif: 192, utilisateursActifs: 48, params: {} });
    assert.equal(k.coutParCollaborateur, 50);
    assert.equal(k.coutParUtilisateurActif, 200);
});

test('computeKpis — pourcentage de masse salariale proratise sur la periode', () => {
    // 1 000 EUR de dépense sur une année pleine, masse 1 000 000 => 0,1 %.
    const annee = C.computeKpis({
        depenseEur: 1000, effectif: 192, joursPeriode: 365,
        params: { masseSalarialeAnnuelle: 1000000 },
    });
    assert.ok(Math.abs(annee.pctMasseSalariale - 0.1) < 1e-9);

    // Même dépense sur un semestre : la masse de référence est deux fois
    // plus petite, donc le pourcentage double.
    const semestre = C.computeKpis({
        depenseEur: 1000, effectif: 192, joursPeriode: 182.5,
        params: { masseSalarialeAnnuelle: 1000000 },
    });
    assert.ok(Math.abs(semestre.pctMasseSalariale - 0.2) < 1e-9);
});

test('computeKpis — masse salariale a zero rend le pourcentage non calculable', () => {
    const k = C.computeKpis({ depenseEur: 1000, effectif: 192, joursPeriode: 365, params: { masseSalarialeAnnuelle: 0 } });
    assert.equal(k.pctMasseSalariale, null);
});

test('computeKpis — ratio de levier et cout par heure gagnee', () => {
    const k = C.computeKpis({
        depenseEur: 1000, effectif: 192, heuresGagnees: 100, joursPeriode: 365, params: {},
    });
    const taux = 44000000 / (192 * 1607);
    assert.ok(Math.abs(k.coutParHeureGagnee - 10) < 1e-9);
    assert.ok(Math.abs(k.ratioLevier - (100 * taux) / 1000) < 1e-9);
});

test('computeKpis — denominateurs nuls : null partout, aucun NaN ni Infinity', () => {
    const k = C.computeKpis({ depenseEur: 1000, effectif: 0, utilisateursActifs: 0, heuresGagnees: 0, joursPeriode: 0, params: {} });
    assert.equal(k.coutParCollaborateur, null);
    assert.equal(k.coutParUtilisateurActif, null);
    assert.equal(k.coutParHeureGagnee, null);
    assert.equal(k.pctMasseSalariale, null);
    assert.equal(k.tauxHoraire, null);
    assert.equal(k.ratioLevier, null);
    Object.values(k).forEach((v) => {
        if (typeof v === 'number') assert.ok(isFinite(v), 'valeur non finie detectee');
    });
});

test('computeKpis — depense nulle : aucun ratio derive, pas de faux zero', () => {
    // Une depense a zero signifie « aucun cout releve », pas « gratuit ».
    // Afficher 0 EUR par heure gagnee se lirait comme une conclusion fausse.
    const k = C.computeKpis({
        depenseEur: 0, effectif: 192, utilisateursActifs: 50, heuresGagnees: 100,
        joursPeriode: 365, params: { masseSalarialeAnnuelle: 1000000 },
    });
    assert.equal(k.depenseMesuree, false);
    assert.equal(k.ratioLevier, null);
    assert.equal(k.coutParCollaborateur, null);
    assert.equal(k.coutParUtilisateurActif, null);
    assert.equal(k.coutParHeureGagnee, null);
    assert.equal(k.pctMasseSalariale, null);
    assert.equal(k.coutPourMilleDeCA, null);
    // La depense elle-meme reste affichable telle quelle.
    assert.equal(k.depenseEur, 0);
});

test('computeKpis — depense positive : depenseMesuree passe a true', () => {
    const k = C.computeKpis({ depenseEur: 1, effectif: 192, params: {} });
    assert.equal(k.depenseMesuree, true);
    assert.ok(k.coutParCollaborateur > 0);
});

test('computeKpis — effectifOverride prend le pas sur l effectif du dashboard', () => {
    const k = C.computeKpis({ depenseEur: 1000, effectif: 192, params: { effectifOverride: 100 } });
    assert.equal(k.effectif, 100);
    assert.equal(k.coutParCollaborateur, 10);
});

test('computeKpis — cout pour mille du CA', () => {
    const k = C.computeKpis({ depenseEur: 44000, effectif: 192, params: {} });
    assert.ok(Math.abs(k.coutPourMilleDeCA - 1) < 1e-9);
});

// ===================== PROJECTION =====================

function aggFrom(totaux) {
    const parMois = {};
    Object.keys(totaux).forEach((m) => {
        parMois[m] = { mois: m, totalEur: totaux[m], openRouterEur: 0, registreEur: 0, fixeEur: 0, variableEur: 0, parCategorie: {}, parFournisseur: {}, lignesIgnorees: [] };
    });
    return parMois;
}

test('projection — run rate sur les 3 derniers mois complets, mois courant exclu', () => {
    const p = C.projection({
        parMois: aggFrom({ '2026-05': 1000, '2026-06': 1000, '2026-07': 1600, '2026-08': 200 }),
        moisCourant: '2026-08',
        params: {},
    });
    assert.equal(p.runRate3m, 1200); // (1000 + 1000 + 1600) / 3
    assert.equal(p.moisRunRate, 3);
});

test('projection — realise YTD inclut le mois courant, exclut l annee precedente', () => {
    const p = C.projection({
        parMois: aggFrom({ '2025-12': 999, '2026-01': 100, '2026-02': 200, '2026-03': 50 }),
        moisCourant: '2026-03',
        params: {},
    });
    assert.equal(p.realiseYTD, 350);
});

test('projection — extrapolation sur les mois restants', () => {
    const p = C.projection({
        parMois: aggFrom({ '2026-07': 1000, '2026-08': 1000, '2026-09': 1000, '2026-10': 500 }),
        moisCourant: '2026-10',
        params: {},
    });
    assert.equal(p.runRate3m, 1000);
    assert.equal(p.moisRestants, 2);
    assert.equal(p.projectionAnnee, 3500 + 2000);
});

test('projection — historique partiel : moyenne sur ce qui existe', () => {
    const p = C.projection({
        parMois: aggFrom({ '2026-07': 900, '2026-08': 300 }),
        moisCourant: '2026-08',
        params: {},
    });
    assert.equal(p.runRate3m, 900);
    assert.equal(p.moisRunRate, 1);
});

test('projection — aucun historique complet : run rate et projection non calculables', () => {
    const p = C.projection({ parMois: aggFrom({ '2026-08': 300 }), moisCourant: '2026-08', params: {} });
    assert.equal(p.runRate3m, null);
    assert.equal(p.projectionAnnee, null);
    assert.equal(p.realiseYTD, 300);
});

test('projection — pourcentage de budget consomme', () => {
    const p = C.projection({
        parMois: aggFrom({ '2026-01': 2500, '2026-02': 2500 }),
        moisCourant: '2026-02',
        params: { budgetAnnuelIA: 20000 },
    });
    assert.equal(p.pctBudgetConsomme, 25);
});

test('projection — sans budget, pas de pourcentage ni de date d epuisement', () => {
    const p = C.projection({
        parMois: aggFrom({ '2026-01': 1000, '2026-02': 1000, '2026-03': 1000, '2026-04': 1000 }),
        moisCourant: '2026-04',
        params: {},
    });
    assert.equal(p.pctBudgetConsomme, null);
    assert.equal(p.moisEpuisement, null);
});

test('projection — mois d epuisement du budget', () => {
    // 4 000 consommés, run rate 1 000, budget 7 000 : franchissement au 3e mois.
    const p = C.projection({
        parMois: aggFrom({ '2026-01': 1000, '2026-02': 1000, '2026-03': 1000, '2026-04': 1000 }),
        moisCourant: '2026-04',
        params: { budgetAnnuelIA: 7000 },
    });
    assert.equal(p.runRate3m, 1000);
    assert.equal(p.moisEpuisement, '2026-07');
});

test('projection — budget deja depasse : epuisement au mois courant', () => {
    const p = C.projection({
        parMois: aggFrom({ '2026-01': 5000, '2026-02': 5000, '2026-03': 5000 }),
        moisCourant: '2026-03',
        params: { budgetAnnuelIA: 10000 },
    });
    assert.equal(p.moisEpuisement, '2026-03');
});

test('projection — mois courant invalide : tout est neutre', () => {
    const p = C.projection({ parMois: aggFrom({ '2026-01': 100 }), moisCourant: 'nope', params: {} });
    assert.equal(p.runRate3m, null);
    assert.equal(p.realiseYTD, 0);
    assert.equal(p.projectionAnnee, null);
});

// ===================== GAINS =====================

test('gainsForRange — somme les heures, prend le max mensuel d utilisateurs', () => {
    const snap = {
        byMonth: {
            '2026-06': { hours: 100, users: 30 },
            '2026-07': { hours: 150, users: 45 },
            '2026-08': { hours: 50, users: 20 },
        },
    };
    const g = C.gainsForRange(snap, '2026-06', '2026-07');
    assert.equal(g.heures, 250);
    assert.equal(g.utilisateursMaxMois, 45); // jamais 75 : un collaborateur compte une fois
    assert.equal(g.moisCouverts, 2);
    assert.equal(g.usages, undefined); // pas d agregat d usages : il serait ininterpretable
});

test('gainsForRange — instantane absent ou vide', () => {
    assert.deepEqual(C.gainsForRange(null, '2026-01', '2026-12'), { heures: 0, utilisateursMaxMois: 0, moisCouverts: 0 });
    assert.equal(C.gainsForRange({ byMonth: {} }, '2026-01', '2026-12').heures, 0);
});

test('readGainsSnapshot — absent, corrompu, ou mal forme retourne null', () => {
    assert.equal(C.readGainsSnapshot(fakeStore()), null);
    assert.equal(C.readGainsSnapshot(fakeStore({ kpi_snapshot_gains: 'pas du json' })), null);
    assert.equal(C.readGainsSnapshot(fakeStore({ kpi_snapshot_gains: '{"autre":1}' })), null);
});

test('readGainsSnapshot — instantane valide relu', () => {
    const st = fakeStore({ kpi_snapshot_gains: JSON.stringify({ effectif: 192, byMonth: { '2026-08': { hours: 10, users: 3 } } }) });
    const s = C.readGainsSnapshot(st);
    assert.equal(s.effectif, 192);
    assert.equal(s.byMonth['2026-08'].hours, 10);
});

// ===================== EXPORT / IMPORT =====================

test('exportJson / importJson — aller-retour fidele', () => {
    const registre = [
        { id: 'a', mois: '2026-08', categorie: 'infra', fournisseur: 'Supabase', libelle: 'Pro', montant: 25, devise: 'EUR', nature: 'fixe' },
        { id: 'b', mois: '2026-08', categorie: 'ocr', fournisseur: 'Mistral', libelle: '', montant: 12.5, devise: 'USD', nature: 'variable' },
    ];
    const params = { masseSalarialeAnnuelle: 12000000, budgetAnnuelIA: 50000, tauxUsdEur: 0.9 };
    const back = C.importJson(C.exportJson(registre, params, '2026-08-24T00:00:00.000Z'));
    assert.equal(back.ok, true);
    assert.deepEqual(back.registre, registre);
    assert.equal(back.parametres.masseSalarialeAnnuelle, 12000000);
    assert.equal(back.parametres.tauxUsdEur, 0.9);
    assert.deepEqual(back.erreurs, []);
});

test('importJson — JSON invalide signale sans jeter', () => {
    const r = C.importJson('{ nope');
    assert.equal(r.ok, false);
    assert.deepEqual(r.registre, []);
    assert.ok(r.erreurs.length);
});

test('importJson — lignes invalides ecartees et listees', () => {
    const r = C.importJson(JSON.stringify({
        registre: [
            { mois: '2026-08', categorie: 'infra', fournisseur: 'OK', montant: 1 },
            { mois: 'bad', categorie: 'infra', fournisseur: 'KO', montant: 1 },
        ],
    }));
    assert.equal(r.ok, true);
    assert.equal(r.registre.length, 1);
    assert.equal(r.erreurs.length, 1);
    assert.match(r.erreurs[0], /ligne 2/);
});

// ===================== COHERENCE D ENSEMBLE =====================

test('coherence — la somme des mois egale la depense de la periode', () => {
    const or = C.monthlySpendFromSnapshots(C.parseOpenRouterUsage([
        releve('2026-06-01T00:00:00Z', 0),
        releve('2026-07-01T00:00:00Z', 100),
        releve('2026-08-01T00:00:00Z', 250),
        releve('2026-09-01T00:00:00Z', 400),
    ]));
    const agg = C.aggregateMonthly({
        openRouter: or,
        registre: [
            { id: 'a', mois: '2026-07', categorie: 'infra', fournisseur: 'Supabase', montant: 25, devise: 'EUR', nature: 'fixe' },
            { id: 'b', mois: '2026-08', categorie: 'ocr', fournisseur: 'Mistral', montant: 10, devise: 'USD', nature: 'variable' },
        ],
        params: { tauxUsdEur: 1 },
    });
    const s = C.sumRange(agg.parMois, '2026-06', '2026-08');
    const parMoisTotal = ['2026-06', '2026-07', '2026-08']
        .map(m => (agg.parMois[m] ? agg.parMois[m].totalEur : 0))
        .reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(s.totalEur - parMoisTotal) < 1e-9);
    // 400 USD de cumulé au 1er sept, dont tout est attribué à juin/juillet/août.
    assert.ok(Math.abs(s.openRouterEur - 400) < 1e-9);
    assert.ok(Math.abs(s.registreEur - 35) < 1e-9);
});

test('coherence — les categories et fournisseurs somment au total', () => {
    const agg = C.aggregateMonthly({
        openRouter: { usdParMois: { '2026-08': 100 } },
        registre: [
            { id: 'a', mois: '2026-08', categorie: 'infra', fournisseur: 'Supabase', montant: 25, devise: 'EUR', nature: 'fixe' },
            { id: 'b', mois: '2026-08', categorie: 'ocr', fournisseur: 'Mistral', montant: 40, devise: 'EUR', nature: 'variable' },
        ],
        params: { tauxUsdEur: 1 },
    });
    const s = C.sumRange(agg.parMois, '2026-08', '2026-08');
    const parCat = Object.values(s.parCategorie).reduce((a, b) => a + b, 0);
    const parFour = Object.values(s.parFournisseur).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(parCat - s.totalEur) < 1e-9);
    assert.ok(Math.abs(parFour - s.totalEur) < 1e-9);
});

// ===================== IMPORT CSV (HISTORIQUE OPENROUTER) =====================

const CSV_ENTETE = 'date__day,model,total_usage';

// Petit CSV de référence : 4 jours à cheval sur une bascule de mois, plusieurs
// modèles par jour, un jour absent (aucune dépense).
const CSV_REF = [
    CSV_ENTETE,
    '2026-04-29,Claude Sonnet 4.6,10',
    '2026-04-29,Other,5',
    '2026-04-30,Claude Sonnet 4.6,20',
    // 2026-05-01 absent : aucune dépense ce jour-là
    '2026-05-02,Gemini 3.5 Flash,7',
    '2026-05-02,Claude Sonnet 4.6,3',
].join('\n');

test('parseOpenRouterCsv — agrege par jour et pose une ancre a zero', () => {
    const r = C.parseOpenRouterCsv(CSV_REF);
    assert.equal(r.ok, true);
    assert.deepEqual(r.erreurs, []);
    assert.equal(r.meta.premierJour, '2026-04-29');
    assert.equal(r.meta.dernierJour, '2026-05-02');
    assert.equal(r.meta.nbJours, 4);
    assert.equal(r.meta.joursAvecDepense, 3);
    assert.equal(r.meta.joursSansDepense, 1);
    assert.equal(r.meta.nbLignes, 5);
    assert.equal(r.meta.totalUsd, 45);

    // Une ancre + un relevé par jour de la plage, jours vides compris : tout
    // delta couvre alors exactement une journée.
    assert.equal(r.snapshots.length, 5);
    assert.equal(r.snapshots[0].usageCumule, 0);
    assert.equal(r.snapshots[0].ts, '2026-04-29T00:00:00.000Z');
    assert.deepEqual(r.snapshots.map(s => s.usageCumule), [0, 15, 35, 35, 45]);
    // Le relevé de la journée D porte l'instant D+1 : c'est ce décalage qui
    // rattache le delta au bon mois sans prorata.
    assert.equal(r.snapshots[1].ts, '2026-04-30T00:00:00.000Z');
    assert.equal(r.snapshots[4].ts, '2026-05-03T00:00:00.000Z');
    // Cumulé strictement croissant : jamais de faux « compteur redémarré ».
    for (let i = 1; i < r.snapshots.length; i++) {
        assert.ok(r.snapshots[i].usageCumule >= r.snapshots[i - 1].usageCumule);
    }
});

test('parseOpenRouterCsv — attribution mensuelle EXACTE, sans prorata', () => {
    const r = C.parseOpenRouterCsv(CSV_REF);
    const or = C.monthlySpendFromSnapshots(r.snapshots);
    // Avril = 15 + 20, mai = 10. Le 30 avril ne doit rien laisser fuir en mai,
    // et le trou du 1er mai ne doit pas ramener de mai vers avril.
    assert.ok(Math.abs(or.usdParMois['2026-04'] - 35) < 1e-9);
    assert.ok(Math.abs(or.usdParMois['2026-05'] - 10) < 1e-9);
    assert.equal(or.anomalies.length, 0);
    // L'ancre à zéro dit que rien n'a précédé : le premier mois est complet.
    assert.equal(or.moisPartiel, null);
});

test('parseOpenRouterCsv — le total des mois egale le total du fichier', () => {
    const r = C.parseOpenRouterCsv(CSV_REF);
    const or = C.monthlySpendFromSnapshots(r.snapshots);
    const somme = Object.values(or.usdParMois).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(somme - r.meta.totalUsd) < 1e-9);
});

test('parseOpenRouterCsv — ventilation par modele, triee', () => {
    const r = C.parseOpenRouterCsv(CSV_REF);
    assert.deepEqual(r.meta.modeles, [
        { modele: 'Claude Sonnet 4.6', usd: 33 },
        { modele: 'Gemini 3.5 Flash', usd: 7 },
        { modele: 'Other', usd: 5 },
    ]);
});

test('parseOpenRouterCsv — bornes dateMin / dateMax incluses', () => {
    const r = C.parseOpenRouterCsv(CSV_REF, { dateMin: '2026-04-30', dateMax: '2026-05-02' });
    assert.equal(r.ok, true);
    assert.equal(r.meta.premierJour, '2026-04-30');
    assert.equal(r.meta.totalUsd, 30);
    assert.equal(r.meta.nbHorsBornes, 2);
    const or = C.monthlySpendFromSnapshots(r.snapshots);
    assert.ok(Math.abs(or.usdParMois['2026-04'] - 20) < 1e-9);
    assert.ok(Math.abs(or.usdParMois['2026-05'] - 10) < 1e-9);
});

test('parseOpenRouterCsv — bornes qui ne laissent rien : refus explicite', () => {
    const r = C.parseOpenRouterCsv(CSV_REF, { dateMin: '2027-01-01' });
    assert.equal(r.ok, false);
    assert.equal(r.snapshots.length, 0);
    assert.deepEqual(r.erreurs, ['aucune ligne dans les bornes demandées']);
});

test('parseOpenRouterCsv — lignes invalides ecartees, jamais fatales', () => {
    const r = C.parseOpenRouterCsv([
        CSV_ENTETE,
        '2026-04-29,Claude Sonnet 4.6,10',
        'pas-une-date,Modele,5',      // date illisible
        '2026-04-29,Modele,abc',      // montant non numérique
        '2026-04-29,Modele,-3',       // avoir : ferait reculer le cumulé
        '2026-04-29,Modele,',         // montant vide
        '2026-13-45,Modele,4',        // date syntaxiquement fausse
    ].join('\n'));
    assert.equal(r.ok, true);
    assert.equal(r.meta.totalUsd, 10);
    assert.equal(r.meta.nbIgnorees, 5);
});

test('parseOpenRouterCsv — colonnes dans un autre ordre, en-tete respecte', () => {
    const r = C.parseOpenRouterCsv([
        'total_usage,date__day,model',
        '12,2026-06-01,Claude Sonnet 5',
    ].join('\n'));
    assert.equal(r.ok, true);
    assert.equal(r.meta.totalUsd, 12);
    assert.deepEqual(r.meta.modeles, [{ modele: 'Claude Sonnet 5', usd: 12 }]);
});

test('parseOpenRouterCsv — sans en-tete, ordre par defaut', () => {
    const r = C.parseOpenRouterCsv('2026-06-01,Claude Sonnet 5,12');
    assert.equal(r.ok, true);
    assert.equal(r.meta.totalUsd, 12);
    assert.equal(r.meta.nbLignes, 1);
});

test('parseOpenRouterCsv — champs entre guillemets et virgule interne', () => {
    const r = C.parseOpenRouterCsv([
        CSV_ENTETE,
        '2026-06-01,"Modele A, variante B",8',
        '2026-06-01,"Guillemet ""double""",2',
    ].join('\n'));
    assert.equal(r.ok, true);
    assert.equal(r.meta.totalUsd, 10);
    assert.deepEqual(r.meta.modeles.map(m => m.modele),
        ['Modele A, variante B', 'Guillemet "double"']);
});

test('parseOpenRouterCsv — CRLF et ligne vide finale', () => {
    const r = C.parseOpenRouterCsv(CSV_ENTETE + '\r\n2026-06-01,M,5\r\n\r\n');
    assert.equal(r.ok, true);
    assert.equal(r.meta.totalUsd, 5);
});

test('parseOpenRouterCsv — entrees vides ou absurdes refusees proprement', () => {
    for (const mauvais of ['', '   ', null, undefined]) {
        const r = C.parseOpenRouterCsv(mauvais);
        assert.equal(r.ok, false);
        assert.deepEqual(r.snapshots, []);
        assert.equal(r.meta, null);
        assert.ok(r.erreurs.length);
    }
    // Un fichier qui n'a qu'un en-tête n'a aucune ligne exploitable.
    const seulEntete = C.parseOpenRouterCsv(CSV_ENTETE);
    assert.equal(seulEntete.ok, false);
    assert.deepEqual(seulEntete.erreurs, ['aucune ligne exploitable']);
});

test('parseOpenRouterCsv — une seule journee reste calculable', () => {
    const r = C.parseOpenRouterCsv(CSV_ENTETE + '\n2026-06-15,M,42');
    assert.equal(r.ok, true);
    assert.equal(r.meta.nbJours, 1);
    assert.equal(r.snapshots.length, 2); // ancre + la journée
    const or = C.monthlySpendFromSnapshots(r.snapshots);
    assert.ok(Math.abs(or.usdParMois['2026-06'] - 42) < 1e-9);
});

test('parseOpenRouterCsv — annee bissextile : le 29 fevrier existe', () => {
    const r = C.parseOpenRouterCsv([
        CSV_ENTETE,
        '2028-02-28,M,1',
        '2028-02-29,M,2',
        '2028-03-01,M,4',
    ].join('\n'));
    assert.equal(r.meta.nbJours, 3);
    assert.equal(r.meta.joursSansDepense, 0);
    const or = C.monthlySpendFromSnapshots(r.snapshots);
    assert.ok(Math.abs(or.usdParMois['2028-02'] - 3) < 1e-9);
    assert.ok(Math.abs(or.usdParMois['2028-03'] - 4) < 1e-9);
});

test('historique — ajout, relecture, suppression', () => {
    const st = fakeStore();
    const r = C.parseOpenRouterCsv(CSV_REF);
    const ajout = C.addHistorique(r, st, 'export.csv');
    assert.equal(ajout.ok, true);

    const relu = C.loadHistorique(st);
    assert.equal(relu.imports.length, 1);
    assert.equal(relu.snapshots.length, r.snapshots.length);
    assert.equal(relu.totalUsd, 45);
    assert.equal(relu.premierJour, '2026-04-29');
    assert.equal(relu.dernierJour, '2026-05-02');
    assert.equal(relu.imports[0].libelle, 'export.csv');
    assert.ok(relu.imports[0].importeLe);
    // Les relevés relus doivent redonner exactement les mêmes mois.
    const or = C.monthlySpendFromSnapshots(relu.snapshots);
    assert.ok(Math.abs(or.usdParMois['2026-04'] - 35) < 1e-9);
    assert.ok(Math.abs(or.usdParMois['2026-05'] - 10) < 1e-9);

    assert.equal(C.clearHistorique(st), true);
    assert.equal(C.loadHistorique(st), null);
});

test('historique — deux exports disjoints (migration de compte) se cumulent', () => {
    const st = fakeStore();
    // Compte historique, ferme fin mars ; puis compte actuel, a partir d'avril.
    const ancien = C.parseOpenRouterCsv([
        CSV_ENTETE,
        '2026-03-30,Claude Sonnet 4.6,60',
        '2026-03-31,Claude Sonnet 4.6,40',
    ].join('\n'));
    assert.equal(C.addHistorique(ancien, st, 'avant-migration.csv').ok, true);
    assert.equal(C.addHistorique(C.parseOpenRouterCsv(CSV_REF), st, 'apres-migration.csv').ok, true);

    const relu = C.loadHistorique(st);
    assert.equal(relu.imports.length, 2);
    assert.equal(relu.totalUsd, 145);
    assert.equal(relu.premierJour, '2026-03-30');
    assert.equal(relu.dernierJour, '2026-05-02');
    // Chaque import a SA cle : deux compteurs cumules distincts ne doivent
    // jamais se retrouver dans la meme serie, sinon la bascule de l'un a
    // l'autre produirait un faux delta.
    const cles = new Set(relu.snapshots.map(s => s.keyName));
    assert.equal(cles.size, 2);

    const or = C.monthlySpendFromSnapshots(relu.snapshots);
    assert.ok(Math.abs(or.usdParMois['2026-03'] - 100) < 1e-9);
    assert.ok(Math.abs(or.usdParMois['2026-04'] - 35) < 1e-9);
    assert.ok(Math.abs(or.usdParMois['2026-05'] - 10) < 1e-9);
    assert.equal(or.moisPartiel, null); // les deux series partent de zero
    assert.equal(or.nbCles, 2);
});

test('historique — reimporter le meme fichier est refuse (double comptage)', () => {
    const st = fakeStore();
    assert.equal(C.addHistorique(C.parseOpenRouterCsv(CSV_REF), st, 'a.csv').ok, true);
    const rejet = C.addHistorique(C.parseOpenRouterCsv(CSV_REF), st, 'copie-de-a.csv');
    assert.equal(rejet.ok, false);
    assert.equal(rejet.motif, 'doublon');
    // Et surtout : le total n'a pas double.
    assert.equal(C.loadHistorique(st).totalUsd, 45);
    assert.equal(C.loadHistorique(st).imports.length, 1);
});

test('historique — retirer un import ne touche pas les autres', () => {
    const st = fakeStore();
    const a = C.addHistorique(C.parseOpenRouterCsv(
        CSV_ENTETE + '\n2026-03-31,M,100'), st, 'ancien.csv');
    C.addHistorique(C.parseOpenRouterCsv(CSV_REF), st, 'recent.csv');
    assert.equal(C.loadHistorique(st).imports.length, 2);

    assert.equal(C.removeHistorique(a.id, st), true);
    const reste = C.loadHistorique(st);
    assert.equal(reste.imports.length, 1);
    assert.equal(reste.totalUsd, 45);
    assert.equal(reste.imports[0].libelle, 'recent.csv');

    // Retirer un id inconnu ne detruit rien et le dit.
    assert.equal(C.removeHistorique('inexistant', st), false);
    assert.equal(C.loadHistorique(st).imports.length, 1);

    // Retirer le dernier vide proprement le stockage.
    assert.equal(C.removeHistorique(reste.imports[0].id, st), true);
    assert.equal(C.loadHistorique(st), null);
});

test('historique — un parse en echec n\'ecrase pas l\'historique en place', () => {
    const st = fakeStore();
    C.addHistorique(C.parseOpenRouterCsv(CSV_REF), st, 'bon.csv');
    const echec = C.parseOpenRouterCsv('');
    const r = C.addHistorique(echec, st, 'vide.csv');
    assert.equal(r.ok, false);
    assert.equal(C.loadHistorique(st).totalUsd, 45); // intact
});

test('historique — l\'ancien format a plat est remonte, pas jete', () => {
    // Un import fait avant la bascule multi-fichiers doit survivre a la mise
    // a jour du code : le perdre en silence serait pire qu'une erreur.
    const v1 = JSON.stringify({
        version: 1,
        importeLe: '2026-08-24T10:00:00.000Z',
        meta: { premierJour: '2026-04-29', dernierJour: '2026-05-02', totalUsd: 45, nbJours: 4 },
        snapshots: C.parseOpenRouterCsv(CSV_REF).snapshots,
    });
    const relu = C.loadHistorique(fakeStore({ [C.LS_HISTORIQUE]: v1 }));
    assert.equal(relu.imports.length, 1);
    assert.equal(relu.totalUsd, 45);
    const or = C.monthlySpendFromSnapshots(relu.snapshots);
    assert.ok(Math.abs(or.usdParMois['2026-04'] - 35) < 1e-9);
});

test('historique — stockage corrompu ou vide : null, jamais d\'exception', () => {
    assert.equal(C.loadHistorique(fakeStore()), null);
    assert.equal(C.loadHistorique(fakeStore({ [C.LS_HISTORIQUE]: '{{{' })), null);
    assert.equal(C.loadHistorique(fakeStore({ [C.LS_HISTORIQUE]: 'null' })), null);
    assert.equal(C.loadHistorique(fakeStore({ [C.LS_HISTORIQUE]: '{"imports":"pas un tableau"}' })), null);
    assert.equal(C.loadHistorique(fakeStore({ [C.LS_HISTORIQUE]: '{"imports":[]}' })), null);
    // Un import dont tous les relevés sont invalides ne vaut pas mieux que rien.
    assert.equal(C.loadHistorique(fakeStore({
        [C.LS_HISTORIQUE]: '{"imports":[{"id":"csv1","snapshots":[{"ts":"nawak","usageCumule":"x"}]}]}',
    })), null);
});

test('historique + job n8n — les deux series se cumulent sans double comptage', () => {
    const hist = C.parseOpenRouterCsv(CSV_REF);
    // Le job démarre le 2 mai avec un cumulé DÉJÀ élevé (tout l'historique du
    // compte) : ce premier relevé pose une référence et ne doit rien ajouter.
    const job = C.parseOpenRouterUsage([
        { ts: '2026-05-02T12:00:00Z', keyName: 'cle-chat', usageCumule: 900 },
        { ts: '2026-05-03T12:00:00Z', keyName: 'cle-chat', usageCumule: 906 },
    ]);
    const or = C.monthlySpendFromSnapshots(hist.snapshots.concat(job));
    assert.ok(Math.abs(or.usdParMois['2026-04'] - 35) < 1e-9);
    // 10 de l'historique + 6 de delta du job, et surtout PAS les 900.
    assert.ok(Math.abs(or.usdParMois['2026-05'] - 16) < 1e-9);
    assert.equal(or.nbCles, 2);
});

test("parseOpenRouterFichier — reconnait l'export CSV", () => {
    const r = C.parseOpenRouterFichier(CSV_REF, { keyName: 'bucket:test' });
    assert.equal(r.type, 'csv');
    assert.equal(r.meta.totalUsd, 45);
    // La cle demandee est bien appliquee : c'est elle qui isole la serie.
    assert.ok(r.snapshots.every(x => x.keyName === 'bucket:test'));
});

test('parseOpenRouterFichier — reconnait les releves JSON du job', () => {
    const r = C.parseOpenRouterFichier(JSON.stringify([
        { ts: '2026-08-01T00:00:00Z', keyName: 'k', usageCumule: 10 },
        { ts: '2026-08-02T00:00:00Z', keyName: 'k', usageCumule: 25 },
    ]));
    assert.equal(r.type, 'json');
    assert.equal(r.snapshots.length, 2);
    assert.equal(r.meta, null);
    const or = C.monthlySpendFromSnapshots(r.snapshots);
    assert.ok(Math.abs(or.usdParMois['2026-08'] - 15) < 1e-9);
});

test('parseOpenRouterFichier — enveloppe {data} du projet', () => {
    const r = C.parseOpenRouterFichier(JSON.stringify({ data: [
        { ts: '2026-08-01T00:00:00Z', keyName: 'k', usageCumule: 0 },
        { ts: '2026-08-02T00:00:00Z', keyName: 'k', usageCumule: 7 },
    ] }));
    assert.equal(r.type, 'json');
    assert.equal(r.snapshots.length, 2);
});

test('parseOpenRouterFichier — repli si le format ne correspond pas au premier caractere', () => {
    // Un CSV sans en-tete commence par un chiffre : le reniflage tente le CSV,
    // ce qui marche. Un JSON vide de releves doit basculer sur le CSV, et
    // inversement — jamais de page vide sans explication.
    const sansEntete = C.parseOpenRouterFichier('2026-06-01,M,12');
    assert.equal(sansEntete.type, 'csv');
    assert.equal(sansEntete.meta.totalUsd, 12);

    const jsonVide = C.parseOpenRouterFichier('[]');
    assert.equal(jsonVide.type, null);
    assert.ok(jsonVide.erreurs.length);
});

test('parseOpenRouterFichier — BOM, vide et charabia', () => {
    const avecBom = C.parseOpenRouterFichier('﻿' + CSV_REF);
    assert.equal(avecBom.type, 'csv');
    assert.equal(avecBom.meta.totalUsd, 45);

    for (const mauvais of ['', '   ', null, undefined]) {
        const r = C.parseOpenRouterFichier(mauvais);
        assert.equal(r.type, null);
        assert.deepEqual(r.snapshots, []);
        assert.deepEqual(r.erreurs, ['fichier vide']);
    }
    const nawak = C.parseOpenRouterFichier("bonjour ceci n'est pas un fichier");
    assert.equal(nawak.type, null);
    assert.ok(/format non reconnu/.test(nawak.erreurs[0]));
});

test('memeCouverture — meme plage et meme total', () => {
    const a = { premierJour: '2026-04-14', dernierJour: '2026-08-24', totalUsd: 20634.07 };
    assert.equal(C.memeCouverture(a, Object.assign({}, a)), true);
    // Tolerance au centime : le CSV et le JSON n'arrondissent pas pareil.
    assert.equal(C.memeCouverture(a, Object.assign({}, a, { totalUsd: 20634.075 })), true);
    assert.equal(C.memeCouverture(a, Object.assign({}, a, { totalUsd: 20635 })), false);
    assert.equal(C.memeCouverture(a, Object.assign({}, a, { dernierJour: '2026-08-25' })), false);
    assert.equal(C.memeCouverture(a, null), false);
    assert.equal(C.memeCouverture(null, null), false);
});

test('chevauchements — periodes disjointes : aucune paire', () => {
    assert.deepEqual(C.chevauchements([
        { premierJour: '2026-01-01', dernierJour: '2026-03-31' },
        { premierJour: '2026-04-01', dernierJour: '2026-08-24' },
    ]), []);
    assert.deepEqual(C.chevauchements([]), []);
    assert.deepEqual(C.chevauchements(null), []);
});

test("chevauchements — recouvrement detecte, meme d'un seul jour", () => {
    const paires = C.chevauchements([
        { premierJour: '2026-04-01', dernierJour: '2026-08-24' },
        { premierJour: '2026-01-01', dernierJour: '2026-04-01' },
    ]);
    assert.equal(paires.length, 1);
    // Triees par date de debut : la plus ancienne d'abord.
    assert.equal(paires[0][0].premierJour, '2026-01-01');
    assert.equal(paires[0][1].premierJour, '2026-04-01');
});

test('chevauchements — couvertures invalides ignorees', () => {
    assert.deepEqual(C.chevauchements([
        { premierJour: 'nawak', dernierJour: '2026-03-31' },
        { premierJour: '2026-01-01', dernierJour: null },
        { premierJour: '2026-01-01', dernierJour: '2026-12-31' },
    ]), []);
});

test('historique — la depense importee alimente bien les KPIs en euros', () => {
    const hist = C.parseOpenRouterCsv(CSV_REF);
    const or = C.monthlySpendFromSnapshots(hist.snapshots);
    const agg = C.aggregateMonthly({ openRouter: or, registre: [], params: { tauxUsdEur: 0.9 } });
    const s = C.sumRange(agg.parMois, '2026-04', '2026-05');
    // 45 USD * 0,9 = 40,50 €, entièrement en inférence et en coût variable.
    assert.ok(Math.abs(s.totalEur - 40.5) < 1e-9);
    assert.ok(Math.abs(s.openRouterEur - 40.5) < 1e-9);
    assert.ok(Math.abs(s.parCategorie.inference - 40.5) < 1e-9);
    assert.ok(Math.abs(s.variableEur - 40.5) < 1e-9);
});
