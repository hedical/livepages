// Tests du module shared/copil.js
// Lancer :  node --test tests/copil.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/copil.js');

// ===================== mois =====================

test('monthRange — contiguë, passage d\'année', () => {
    assert.deepEqual(C.monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

test('monthRange — bornes inversées ou absentes', () => {
    assert.deepEqual(C.monthRange('2026-05', '2026-04'), []);
    assert.deepEqual(C.monthRange(null, '2026-04'), []);
});

test('previousMonth / nextMonth', () => {
    assert.equal(C.previousMonth('2026-01'), '2025-12');
    assert.equal(C.nextMonth('2026-12'), '2027-01');
});

// ===================== buildModuleSeries =====================

const MONTHS = ['2026-08', '2026-09', '2026-10'];

test('buildModuleSeries — actifs du mois et nouveaux utilisateurs', () => {
    const s = C.buildModuleSeries([
        { email: 'A@x.fr', month: '2026-08' },
        { email: 'a@x.fr ', month: '2026-09' },
        { email: 'b@x.fr', month: '2026-09' },
        { email: 'c@x.fr', month: '2026-10' },
    ], null, MONTHS);
    assert.deepEqual(s.map(r => [r.activeUsers, r.newUsers]), [[1, 1], [2, 1], [1, 1]]);
});

test('buildModuleSeries — un mois sans usage est à 0, pas absent', () => {
    const s = C.buildModuleSeries([{ email: 'a', month: '2026-08' }, { email: 'a', month: '2026-10' }], null, MONTHS);
    assert.equal(s.length, 3);
    assert.equal(s[1].activeUsers, 0);
});

test('buildModuleSeries — requêtes : 1 par défaut, sinon la valeur portée', () => {
    const s = C.buildModuleSeries([
        { email: 'a', month: '2026-08' },
        { email: 'a', month: '2026-08', requests: 7 },
    ], null, MONTHS);
    assert.equal(s[0].requests, 8);
    assert.equal(C.requestsPerUser(s[0]), 8);
});

test('buildModuleSeries — sans parc de dossiers, systématisation = null', () => {
    const s = C.buildModuleSeries([{ email: 'a', month: '2026-08', dossier: 'D1' }], null, MONTHS);
    assert.equal(s[0].dossiersIA, 1);
    assert.equal(s[0].dossiersUsers, null);
    assert.equal(C.systematisation(s[0]), null);
    assert.equal(C.penetration(s[0]), null);
});

test('buildModuleSeries — systématisation sur les dossiers des actifs du mois', () => {
    // a utilise le module en août ; b jamais.
    const events = [{ email: 'a', month: '2026-08', dossier: 'D1' }];
    const parc = [
        { email: 'a', month: '2026-08', dossier: 'D1' },
        { email: 'a', month: '2026-08', dossier: 'D2' },
        { email: 'b', month: '2026-08', dossier: 'D3' },
        { email: 'b', month: '2026-08', dossier: 'D4' },
    ];
    const [aout] = C.buildModuleSeries(events, parc, MONTHS);
    assert.equal(aout.dossiersTotal, 4);
    assert.equal(aout.dossiersUsers, 2);
    assert.equal(C.systematisation(aout), 0.5);
    assert.equal(C.penetration(aout), 0.25);
});

test('buildModuleSeries — un utilisateur d\'août inactif en septembre sort du dénominateur', () => {
    const events = [{ email: 'a', month: '2026-08', dossier: 'D1' }];
    const parc = [
        { email: 'a', month: '2026-08', dossier: 'D1' },
        { email: 'a', month: '2026-09', dossier: 'D5' },
    ];
    const s = C.buildModuleSeries(events, parc, MONTHS);
    assert.equal(s[1].dossiersUsers, 0);
    assert.equal(C.systematisation(s[1]), null);
    assert.equal(C.penetration(s[1]), 0);
});

test('buildModuleSeries — un dossier IA absent du parc reste dans le dénominateur', () => {
    const events = [{ email: 'a', month: '2026-08', dossier: 'D1' }];
    const [aout] = C.buildModuleSeries(events, [], MONTHS);
    assert.equal(aout.dossiersTotal, 1);
    assert.equal(aout.dossiersUsers, 1);
    assert.equal(C.systematisation(aout), 1);
});

test('buildModuleSeries — dossier IA compté une fois par mois', () => {
    const s = C.buildModuleSeries([
        { email: 'a', month: '2026-08', dossier: 'D1' },
        { email: 'b', month: '2026-08', dossier: 'D1' },
    ], null, MONTHS);
    assert.equal(s[0].dossiersIA, 1);
    assert.equal(s[0].activeUsers, 2);
});

// ===================== ratios =====================

test('adoption — actifs du mois / population ; population absente = null', () => {
    const row = { activeUsers: 48 };
    assert.equal(C.adoption(row, 192), 0.25);
    assert.equal(C.adoption(row, null), null);
    assert.equal(C.adoption(row, 0), null);
});

test('change — variation relative, sans base = null', () => {
    assert.equal(C.change(50, 30), -0.4);
    assert.equal(C.change(0, 0), 0);
    assert.equal(C.change(0, 5), null);
    assert.equal(C.change(null, 5), null);
});

// ===================== detectFluctuations =====================

function serie(rows) {
    return rows.map(([month, activeUsers, requests, dossiersIA, dossiersUsers]) =>
        ({ month, activeUsers, requests, dossiersIA, dossiersUsers }));
}

test('detectFluctuations — baisse de 20 % ou plus signalée, baisses en tête', () => {
    const items = [
        { id: 'libre', label: 'Usage libre', metier: 'CT', series: serie([['2026-08', 50, 1000, 0, null], ['2026-09', 30, 900, 0, null]]) },
        { id: 'desc', label: 'Descriptif', metier: 'CT', series: serie([['2026-08', 10, 10, 0, null], ['2026-09', 15, 15, 0, null]]) },
    ];
    const f = C.detectFluctuations(items, '2026-09');
    assert.equal(f[0].id, 'libre');
    assert.equal(f[0].metric, 'activeUsers');
    assert.ok(Math.abs(f[0].delta + 0.4) < 1e-9);
    assert.ok(!f.some(x => x.id === 'libre' && x.metric === 'requests'));
    assert.ok(f.some(x => x.id === 'desc' && x.metric === 'activeUsers'));
});

test('detectFluctuations — petits volumes ignorés', () => {
    const items = [{ id: 'm', label: 'M', metier: 'SPS', series: serie([['2026-08', 1, 1, 0, null], ['2026-09', 4, 4, 0, null]]) }];
    assert.deepEqual(C.detectFluctuations(items, '2026-09'), []);
});

test('detectFluctuations — systématisation en points', () => {
    const items = [{ id: 'm', label: 'M', metier: 'CT', series: serie([['2026-08', 10, 10, 50, 100], ['2026-09', 10, 10, 35, 100]]) }];
    const f = C.detectFluctuations(items, '2026-09');
    assert.equal(f.length, 1);
    assert.equal(f[0].metric, 'systematisation');
    assert.ok(Math.abs(f[0].delta + 0.15) < 1e-9);
});

test('detectFluctuations — mois précédent absent : rien', () => {
    const items = [{ id: 'm', label: 'M', metier: 'CT', series: serie([['2026-09', 50, 50, 0, null]]) }];
    assert.deepEqual(C.detectFluctuations(items, '2026-09'), []);
});
