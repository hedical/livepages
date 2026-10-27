// Tests du module partagé shared/adoption.js
// Lancer :  node --test tests/adoption.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const KPIAdoption = require('../shared/adoption.js');

const helpers = { isDescriptifRow: () => true, isNFHabitatItem: () => true };

// ===================== itemAgency =====================

test('itemAgency — agence portée, puis numéro d\'affaire, puis libellé ; « Non spécifié » = vide', () => {
    assert.equal(KPIAdoption.itemAgency({ agencyCode: 'lyct' }), 'LYCT');
    assert.equal(KPIAdoption.itemAgency({ contractNumber: 'C-BXCT-2026-001' }), 'BXCT');
    assert.equal(KPIAdoption.itemAgency({ agency: 'Non spécifié' }), '');
    assert.equal(KPIAdoption.itemAgency({}), '');
});

// ===================== lastMonths / periodFromFilter =====================

test('lastMonths — six mois glissants, bornes incluses', () => {
    const p = KPIAdoption.lastMonths(new Date(2026, 9, 15, 10, 0), 6);
    assert.deepEqual([p.start.getFullYear(), p.start.getMonth(), p.start.getDate()], [2026, 3, 16]);
    assert.deepEqual([p.end.getMonth(), p.end.getDate(), p.end.getHours()], [9, 15, 23]);
    assert.deepEqual(KPIAdoption.lastMonths(null, 6), { start: null, end: null });
});

test('periodFromFilter — sans filtre, aucune borne', () => {
    assert.deepEqual(KPIAdoption.periodFromFilter({ startDate: null, endDate: null }), { start: null, end: null });
    const p = KPIAdoption.periodFromFilter({ startDate: '2026-04-16', endDate: '2026-10-15' });
    assert.equal(p.start.getHours(), 0);
    assert.equal(p.end.getHours(), 23);
});

// ===================== collect =====================

const iso = (y, m, d) => new Date(y, m - 1, d, 10, 0).toISOString();

function sample() {
    return KPIAdoption.catalogue({
        expertCT: [
            // a : chaque semaine pendant 10 semaines, agence LYCT
            ...Array.from({ length: 10 }, (_, i) => ({ email: 'a@btp-consultants.fr', createdAt: iso(2026, 8, 3 + 7 * i), agencyCode: 'LYCT' })),
            // b : une session, agence BXCT
            { email: 'b@btp-consultants.fr', createdAt: iso(2026, 10, 1), agencyCode: 'BXCT' },
            // hors domaine : ignoré
            { email: 'x@autre.fr', createdAt: iso(2026, 10, 1), agencyCode: 'LYCT' },
        ],
        // a travaille surtout sur des affaires LYCT, une fois sur BXCT
        comparateur: [{ email: 'A@btp-consultants.fr', createdAt: iso(2026, 9, 1), contractNumber: 'C-BXCT-1-' }],
    }, helpers);
}

test('collect — une ligne par email et filiale, domaine filtré, agence majoritaire', () => {
    const r = KPIAdoption.collect(sample(), { start: null, end: null });
    assert.equal(r.users.length, 2);
    const a = r.users.find(u => u.email === 'a@btp-consultants.fr');
    assert.equal(a.agency, 'LYCT');
    assert.equal(a.sessions, 11);
    assert.deepEqual([...a.features].sort(), ['Comparateur', 'Expert']);
    assert.equal(r.refDate.getMonth(), 9); // dernier usage : octobre
});

test('collect — la période limite les sessions, pas le rattachement', () => {
    const r = KPIAdoption.collect(sample(), { start: new Date(2026, 9, 1), end: new Date(2026, 9, 31, 23, 59) });
    assert.deepEqual(r.users.map(u => u.email).sort(), ['a@btp-consultants.fr', 'b@btp-consultants.fr']);
    const a = r.users.find(u => u.email === 'a@btp-consultants.fr');
    assert.equal(a.sessions, 1);
    assert.equal(a.agency, 'LYCT');
});

test('collect — déterministe : même entrée, même note', () => {
    const one = KPIAdoption.collect(sample(), { start: null, end: null }).users.map(u => u.adoption.score);
    const two = KPIAdoption.collect(sample(), { start: null, end: null }).users.map(u => u.adoption.score);
    assert.deepEqual(one, two);
});

// ===================== agencyAppropriation =====================

const user = (agency, score, filiale = 'BTP Consultants') => ({ agency, filiale, adoption: { score } });

test('agencyAppropriation — taux = notes ≥ 60 ÷ effectif, non-utilisateurs comptés à zéro', () => {
    const r = KPIAdoption.agencyAppropriation(
        [user('LYCT', 80), user('LYCT', 60), user('LYCT', 59), user('BXCT', 10), user('ZZCT', 90), user('LYCT', 95, 'BTP Consultants SPS')],
        [{ dr: 'DR Centre-Est', agencyCode: 'LYCT', effectif: 10 }, { dr: 'DR Aquitaine', agencyCode: 'BXCT', effectif: 4 }, { dr: 'DR Nord', agencyCode: 'AMCT', effectif: 3 }]);
    const ly = r.rows.find(x => x.agency === 'LYCT');
    assert.deepEqual([ly.actifs, ly.appropries, ly.taux, ly.mediane], [3, 2, 0.2, 60]);
    assert.equal(ly.niveauMediane, 'Régulier');
    assert.equal(ly.sansUsage, 7);
    const am = r.rows.find(x => x.agency === 'AMCT');
    assert.deepEqual([am.actifs, am.appropries, am.taux, am.mediane], [0, 0, 0, null]);
    assert.deepEqual(r.totals, { effectif: 17, appropries: 2, taux: 2 / 17 });
    assert.equal(r.medianTaux, 0);
    assert.deepEqual(r.horsPopulation, { utilisateurs: 1, appropries: 1 });
});

test('agencyAppropriation — seuil paramétrable et aligné sur le profil Régulier', () => {
    assert.equal(KPIAdoption.APPROPRIATION_MIN, 60);
    const r = KPIAdoption.agencyAppropriation([user('LYCT', 45)], [{ agencyCode: 'LYCT', effectif: 1 }], { threshold: 40 });
    assert.equal(r.rows[0].taux, 1);
});

// ===================== sources : population =====================

test('parsePopulationRows — CSV « ; », CSV « , » et JSON Metabase', () => {
    const vm = require('node:vm');
    const ctx = { KPI: require('../shared/utils.js'), console };
    vm.createContext(ctx);
    vm.runInContext(require('node:fs').readFileSync(require('node:path').join(__dirname, '../shared/sources.js'), 'utf8'), ctx);
    const expected = [{ dr: 'DR Aquitaine', agencyCode: 'BXCT', effectif: 7 }, { dr: 'DR Aquitaine', agencyCode: 'LRCT', effectif: 3 }];
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.parsePopulationRows('DR;Agence;Effectif\nDR Aquitaine;BXCT;7\nDR Aquitaine;lrct;3'))), expected);
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.parsePopulationRows('DR,Agence,Effectif\nDR Aquitaine,BXCT,7\nDR Aquitaine,LRCT,3\n'))), expected);
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.parsePopulationRows(JSON.stringify([{ DR: 'DR Aquitaine', Agence: 'BXCT', Effectif: 7 }, { DR: 'DR Aquitaine', Agence: 'LRCT', Effectif: '3' }])))), expected);
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.parsePopulationRows(JSON.stringify([{ data: 'DR,Agence,Effectif\nDR Aquitaine,BXCT,7\nDR Aquitaine,LRCT,3' }])))), expected);
    // Format réel du bucket : ligne « data » puis le CSV entre guillemets
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.parsePopulationRows('data\n"DR,Agence,Effectif\nDR Aquitaine,BXCT,7\nDR Aquitaine,LRCT,3\n"'))), expected);
});
