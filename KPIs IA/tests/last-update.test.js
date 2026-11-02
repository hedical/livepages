// Tests du module shared/last-update.js (date de mise à jour des données)
// Lancer :  node --test tests/last-update.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../shared/last-update.js');

const BUCKET = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object';

test('storageFileName — fichiers du bucket uniquement', () => {
    assert.equal(L.storageFileName(`${BUCKET}/sign/DataFromMetabase/descriptif.json?token=abc`), 'descriptif.json');
    assert.equal(L.storageFileName(`${BUCKET}/public/DataFromMetabase/population_cible.csv`), 'population_cible.csv');
    assert.equal(L.storageFileName(`${BUCKET}/sign/DataFromMetabase/explorer_total_usage_2025-2026.csv?token=x`), 'explorer_total_usage_2025-2026.csv');
    assert.equal(L.storageFileName('https://databuildr.app.n8n.cloud/webhook/passwordROI'), null);
    assert.equal(L.storageFileName('https://docs.google.com/spreadsheets/d/x/export?format=csv'), null);
    assert.equal(L.storageFileName('pas une url'), null);
});

test('latestOf — date la plus récente, entrées invalides ignorées', () => {
    const a = new Date('2026-11-01T05:02:00Z');
    const b = new Date('2026-11-02T05:02:00Z');
    assert.equal(L.latestOf([{ file: 'a', date: a }, { file: 'b', date: b }, { file: 'c', date: new Date('x') }]), b);
    assert.equal(L.latestOf([]), null);
    assert.equal(L.latestOf(null), null);
});

test('formatDate — heure de Paris', () => {
    assert.equal(L.formatDate('2026-11-02T05:02:00Z'), '2 novembre 2026 à 06:02');
    assert.equal(L.formatDate('2026-07-15T22:30:00Z'), '16 juillet 2026 à 00:30');
});

test('record / latest / sources — relevés de la page', () => {
    assert.equal(L.latest(), null);
    L.record('population_cible.csv', 'Mon, 05 Oct 2026 09:00:00 GMT');
    L.record('descriptif.json', 'Mon, 02 Nov 2026 05:02:00 GMT');
    L.record('vide.json', 'pas une date');
    assert.equal(L.latest(), '2026-11-02T05:02:00.000Z');
    assert.deepEqual(L.sources().map(s => s.file), ['descriptif.json', 'population_cible.csv']);
});
