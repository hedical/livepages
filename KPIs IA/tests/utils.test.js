// Tests du module partagé shared/utils.js
// Lancer :  node --test tests/
// (Node >= 18, aucune dépendance)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const KPI = require('../shared/utils.js');

// ===================== parseCSVLine =====================

test('parseCSVLine — ligne simple', () => {
    assert.deepEqual(KPI.parseCSVLine('a,b,c'), ['a', 'b', 'c']);
});

test('parseCSVLine — virgules dans les guillemets', () => {
    assert.deepEqual(
        KPI.parseCSVLine('"Dupont, Jean",lyon,"12, rue X"'),
        ['Dupont, Jean', 'lyon', '12, rue X']
    );
});

test('parseCSVLine — guillemets échappés ("")', () => {
    assert.deepEqual(KPI.parseCSVLine('"il a dit ""oui""",b'), ['il a dit "oui"', 'b']);
});

test('parseCSVLine — trim des valeurs', () => {
    assert.deepEqual(KPI.parseCSVLine(' a , b '), ['a', 'b']);
});

// ===================== parseFullCSV =====================

test('parseFullCSV — retours à la ligne dans les champs quotés', () => {
    const csv = 'col1,col2\n"ligne 1\nligne 2",valeur';
    const rows = KPI.parseFullCSV(csv);
    assert.equal(rows.length, 2);
    assert.equal(rows[1][0], 'ligne 1\nligne 2');
    assert.equal(rows[1][1], 'valeur');
});

test('parseFullCSV — CRLF et lignes vides ignorées', () => {
    const csv = 'a,b\r\n\r\n1,2\r\n';
    const rows = KPI.parseFullCSV(csv);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[1], ['1', '2']);
});

// ===================== parseFrenchDate =====================

test('parseFrenchDate — ISO UTC', () => {
    const d = KPI.parseFrenchDate('2026-06-06T00:00:00.000Z');
    assert.ok(d instanceof Date);
    assert.equal(d.toISOString(), '2026-06-06T00:00:00.000Z');
});

test('parseFrenchDate — format français avec heure', () => {
    const d = KPI.parseFrenchDate('5 décembre, 2025, 15:33');
    assert.ok(d);
    assert.equal(d.getFullYear(), 2025);
    assert.equal(d.getMonth(), 11);
    assert.equal(d.getDate(), 5);
    assert.equal(d.getHours(), 15);
    assert.equal(d.getMinutes(), 33);
});

test('parseFrenchDate — format français sans heure', () => {
    const d = KPI.parseFrenchDate('25 octobre, 2025');
    assert.ok(d);
    assert.equal(d.getMonth(), 9);
    assert.equal(d.getDate(), 25);
});

test('parseFrenchDate — backslashes retirés', () => {
    const d = KPI.parseFrenchDate('5 décembre\\, 2025');
    assert.ok(d);
    assert.equal(d.getMonth(), 11);
});

test('parseFrenchDate — invalide → null', () => {
    assert.equal(KPI.parseFrenchDate('pas une date'), null);
    assert.equal(KPI.parseFrenchDate(''), null);
    assert.equal(KPI.parseFrenchDate(null), null);
    assert.equal(KPI.parseFrenchDate(undefined), null);
});

test('parseFrenchDate — accepte un objet Date', () => {
    const src = new Date('2026-01-15');
    assert.equal(KPI.parseFrenchDate(src), src);
});

// ===================== findIdx / findKey =====================

test('findIdx — priorité des patterns sur l\'ordre des colonnes', () => {
    const headers = ['Report__reportType', 'AIDeliverable__type'];
    // Le pattern aideliver+type est prioritaire même si reportType vient avant
    assert.equal(KPI.findIdx(headers, ['aideliver', 'type'], ['reporttype']), 1);
});

test('findIdx — négation avec !', () => {
    const headers = ['Report__diffusedAt', 'Report__type'];
    assert.equal(KPI.findIdx(headers, ['report', 'type', '!diffusedat']), 1);
});

test('findIdx — non trouvé → -1', () => {
    assert.equal(KPI.findIdx(['a', 'b'], ['zzz']), -1);
});

test('findKey — retourne le nom de clé, null sinon', () => {
    const keys = ['User__Email', 'Agency'];
    assert.equal(KPI.findKey(keys, ['user', 'email']), 'User__Email');
    assert.equal(KPI.findKey(keys, ['zzz']), null);
});

// ===================== extractText / countWords =====================

test('extractText — retire balises et entités', () => {
    const html = '<p style="x">Bonjour <strong>le&nbsp;monde</strong></p>';
    assert.equal(KPI.extractText(html), 'Bonjour le monde');
});

test('countWords — lettres uniquement, pas les nombres', () => {
    assert.equal(KPI.countWords('Trois mots ici'), 3);
    assert.equal(KPI.countWords('123 456'), 0);
    assert.equal(KPI.countWords('bâtiment R+6 à Cléguer'), 4); // bâtiment, R, à, Cléguer
    assert.equal(KPI.countWords(''), 0);
    assert.equal(KPI.countWords(null), 0);
});

// ===================== escapeHtml =====================

test('escapeHtml — neutralise le HTML', () => {
    assert.equal(
        KPI.escapeHtml('<script>alert("x")</script>'),
        '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
    assert.equal(KPI.escapeHtml(''), '');
    assert.equal(KPI.escapeHtml(null), '');
});

// ===================== isDescriptifItem / hasAnyType =====================
// C'est LE bug du 108,9 % : les lignes au type vide ne doivent pas compter.

test('isDescriptifItem — exclut les lignes au type vide quand le dataset a des types', () => {
    const data = [
        { type: 'DESCRIPTIF_SOMMAIRE_DES_TRAVAUX' },
        { type: '' },   // RICT sans génération IA (hasAi=false)
        { type: '' },
        { type: 'DESCRIPTIF_SOMMAIRE_DES_TRAVAUX' },
    ];
    const anyHasType = KPI.hasAnyType(data);
    assert.equal(anyHasType, true);
    const kept = data.filter(i => KPI.isDescriptifItem(i, anyHasType));
    assert.equal(kept.length, 2); // et surtout PAS 4
});

test('isDescriptifItem — passthrough si query déjà filtrée (aucun type)', () => {
    const data = [{ type: '' }, { type: '' }];
    const anyHasType = KPI.hasAnyType(data);
    assert.equal(anyHasType, false);
    const kept = data.filter(i => KPI.isDescriptifItem(i, anyHasType));
    assert.equal(kept.length, 2); // on garde tout
});

test('isDescriptifItem — exclut les autres types (ex. AUTOCONTACT)', () => {
    assert.equal(KPI.isDescriptifItem({ type: 'AUTOCONTACT' }, true), false);
});

test('isDescriptifItem — match par inclusion (préfixes/suffixes tolérés)', () => {
    assert.equal(KPI.isDescriptifItem({ type: 'X_DESCRIPTIF_SOMMAIRE_DES_TRAVAUX_Y' }, true), true);
});

// ===================== isTruthyBool =====================

test('isTruthyBool — sémantique identique à app.js (fromAI)', () => {
    assert.equal(KPI.isTruthyBool(true), true);
    assert.equal(KPI.isTruthyBool('true'), true);
    assert.equal(KPI.isTruthyBool('TRUE'), true);
    assert.equal(KPI.isTruthyBool(false), false);
    assert.equal(KPI.isTruthyBool('false'), false);
    assert.equal(KPI.isTruthyBool(''), false);
    assert.equal(KPI.isTruthyBool(null), false);
    assert.equal(KPI.isTruthyBool(1), false); // strict : pas de coercition
});

// ===================== isAfterAOStart (floor 06/06/2026) =====================

test('isAfterAOStart — frontière au 6 juin 2026 UTC', () => {
    assert.equal(KPI.isAfterAOStart('2026-06-05T23:59:59.000Z'), false); // veille → exclu
    assert.equal(KPI.isAfterAOStart('2026-06-06T00:00:00.000Z'), true);  // jour J → gardé
    assert.equal(KPI.isAfterAOStart('2026-07-01T12:00:00.000Z'), true);
    assert.equal(KPI.isAfterAOStart('2026-04-14T00:00:00.000Z'), false); // données de test
});

test('isAfterAOStart — sans date valide → conservé (conservateur)', () => {
    assert.equal(KPI.isAfterAOStart(''), true);
    assert.equal(KPI.isAfterAOStart(null), true);
    assert.equal(KPI.isAfterAOStart('n/a'), true);
});
