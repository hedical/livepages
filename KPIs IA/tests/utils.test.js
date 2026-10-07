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

// ===================== chatEmail =====================

test('chatEmail — email a la racine (ancien format S+)', () => {
    assert.equal(KPI.chatEmail({ email: 'jean.dupont@btp-consultants.fr' }), 'jean.dupont@btp-consultants.fr');
});

test('chatEmail — repli sur metadata.email (app SPS « C+ »)', () => {
    const session = { email: null, metadata: { email: 'a.b@btp-consultants.fr', source_id: 'c+' } };
    assert.equal(KPI.chatEmail(session), 'a.b@btp-consultants.fr');
});

test('chatEmail — repli sur metadata.userEmail', () => {
    assert.equal(KPI.chatEmail({ email: '', metadata: { userEmail: 'c.d@citae.fr' } }), 'c.d@citae.fr');
});

test('chatEmail — la racine gagne sur metadata', () => {
    const session = { email: 'racine@x.fr', metadata: { email: 'meta@x.fr' } };
    assert.equal(KPI.chatEmail(session), 'racine@x.fr');
});

test('chatEmail — session vraiment anonyme → chaine vide', () => {
    assert.equal(KPI.chatEmail({ email: null, metadata: {} }), '');
    assert.equal(KPI.chatEmail({}), '');
    assert.equal(KPI.chatEmail(null), '');
});

test('chatEmail — trim et valeur non-chaine', () => {
    assert.equal(KPI.chatEmail({ metadata: { email: '  e.f@btp-consultants.fr  ' } }), 'e.f@btp-consultants.fr');
    assert.equal(KPI.chatEmail({ email: 42 }), '');
});

// ============================================================================
// Export CSV du backoffice BTP Force (Autocontact SPS) : séparateur ';' et
// date/heure en colonnes séparées.
// ============================================================================

test('parseFullCSV — séparateur point-virgule', () => {
    const csv = 'Date;Origine;Société\n17/09/2026;IA;CLE MILLET\n18/09/2026;Humain;ACME';
    const rows = KPI.parseFullCSV(csv, ';');
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], ['Date', 'Origine', 'Société']);
    assert.deepEqual(rows[1], ['17/09/2026', 'IA', 'CLE MILLET']);
});

test('parseFullCSV — virgule par défaut inchangée, et virgule interne avec sep ;', () => {
    assert.deepEqual(KPI.parseFullCSV('a,b\n1,2')[1], ['1', '2']);
    // Une virgule dans un champ ne coupe plus rien quand le séparateur est ';'
    assert.deepEqual(KPI.parseFullCSV('a;b\nDupont, Jean;PARIS', ';')[1], ['Dupont, Jean', 'PARIS']);
});

test('parseFullCSV — champ entre guillemets contenant le séparateur', () => {
    const rows = KPI.parseFullCSV('a;b\n"x;y";z', ';');
    assert.deepEqual(rows[1], ['x;y', 'z']);
});

test('parseFrDateTime — date + heure du backoffice', () => {
    const d = KPI.parseFrDateTime('17/09/2026', '07:49');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 8);
    assert.equal(d.getDate(), 17);
    assert.equal(d.getHours(), 7);
    assert.equal(d.getMinutes(), 49);
});

test('parseFrDateTime — heure absente ou vide → minuit', () => {
    assert.equal(KPI.parseFrDateTime('01/03/2026').getHours(), 0);
    assert.equal(KPI.parseFrDateTime('01/03/2026', '').getMinutes(), 0);
});

test('parseFrDateTime — dates impossibles rejetées (pas de report silencieux)', () => {
    assert.equal(KPI.parseFrDateTime('31/02/2026', '10:00'), null);
    assert.equal(KPI.parseFrDateTime('17/13/2026', '10:00'), null);
});

test('parseFrDateTime — repli sur parseFrenchDate pour un ISO', () => {
    const d = KPI.parseFrDateTime('2026-09-17T05:49:05.255Z');
    assert.equal(d instanceof Date, true);
    assert.equal(d.getUTCDate(), 17);
});

test('parseFrDateTime — entrée vide', () => {
    assert.equal(KPI.parseFrDateTime(''), null);
    assert.equal(KPI.parseFrDateTime(null), null);
});

// ===================== Analyse CCTP vs Référentiel (card 160) =====================

const CCTP_HEADER = 'EventId,EventName,EventDate,DeliverableId,Status,ContractNumber,SubAffairUserId,UserEmail,DR,Agence,Missions,TotalMissions,FailedMissions,TotalElements,TotalAvis,AvisFavorable,AvisSuspendu,AvisDefavorable,AvisAutre,AvisCritique,AvisEleve,AvisHorsMission,AvisParMission,ReportId,AvisInjectes,NoticesCreees';
const CCTP_CSV = [
    CCTP_HEADER,
    // Missions entre guillemets : c'est ainsi que Metabase exporte "L,P1"
    'd1,CCTP_VS_REFERENTIEL,2026-10-02T12:43:51.791,d1,COMPLETED,C-CT75-2024-20-216852,u1,a@btp-consultants.fr,DR IDF Nord,CT75,"L,P1",2,0,44,28,13,12,3,0,13,15,0,L:20;P1:8,,0,0',
    'd2,CCTP_VS_REFERENTIEL,2026-09-28T09:00:00.000,d2,COMPLETED,C-CT92S-2025-20-2639,u2,b@btp-consultants.fr,DR IDF Sud,CT92S,"L,P1,PV,F",4,0,89,48,16,23,7,2,17,29,6,F:16;L:15;P1:11;PV:6,r1,5,3',
    'd3,CCTP_VS_REFERENTIEL,2026-09-27T09:00:00.000,d3,ERROR,C-CT92S-2025-20-9999,u2,b@btp-consultants.fr,DR IDF Sud,CT92S,,0,0,0,0,0,0,0,0,0,0,0,,,0,0',
].join('\n');

test('parseMissionCounts — chaîne SQL "code:n;code:n"', () => {
    assert.deepEqual(KPI.parseMissionCounts('F:11;L:19;P1:14'), { F: 11, L: 19, P1: 14 });
    assert.deepEqual(KPI.parseMissionCounts(''), {});
    assert.deepEqual(KPI.parseMissionCounts(null), {});
    assert.deepEqual(KPI.parseMissionCounts('L:2;bad;:3;P1:x'), { L: 2 });
});

test('parseCctpPayload — CSV brut : virgules des missions entre guillemets', () => {
    const items = KPI.parseCctpPayload(CCTP_CSV);
    assert.equal(items.length, 3);
    assert.deepEqual(items[0].missions, ['L', 'P1']);
    assert.deepEqual(items[1].missions, ['L', 'P1', 'PV', 'F']);
    // pas de décalage de colonnes après le champ entre guillemets
    assert.equal(items[1].totalAvis, 48);
    assert.equal(items[1].avisDefavorable, 7);
    assert.equal(items[1].agencyCode, 'CT92S');
    assert.deepEqual(items[1].avisParMission, { F: 16, L: 15, P1: 11, PV: 6 });
});

test('parseCctpPayload — enveloppes n8n [{data}], {data} et JSON direct', () => {
    const viaArray = KPI.parseCctpPayload(JSON.stringify([{ data: CCTP_CSV }]));
    const viaObj = KPI.parseCctpPayload(JSON.stringify({ data: CCTP_CSV }));
    assert.equal(viaArray.length, 3);
    assert.equal(viaObj.length, 3);
    const json = KPI.parseCctpPayload(JSON.stringify([
        { DeliverableId: 'x', EventDate: '2026-10-01', Status: 'COMPLETED', TotalAvis: 10, Missions: 'L,F', AvisParMission: 'F:4;L:6' },
    ]));
    assert.equal(json.length, 1);
    assert.equal(json[0].totalAvis, 10);
    assert.deepEqual(json[0].missions, ['L', 'F']);
});

test('parseCctpPayload — entrée vide ou invalide', () => {
    assert.deepEqual(KPI.parseCctpPayload(''), []);
    assert.deepEqual(KPI.parseCctpPayload(null), []);
    assert.deepEqual(KPI.parseCctpPayload(CCTP_HEADER), []);
});

test('parseCctpRows — exploitée = rapport, avis statués ou notices injectées', () => {
    const [a, b] = KPI.parseCctpPayload(CCTP_CSV);
    assert.equal(a.exploitee, false);
    assert.equal(b.exploitee, true);
    assert.equal(KPI.parseCctpRows([{ DeliverableId: 'z', ReportId: 'r9' }])[0].exploitee, true);
});

test('parseCctpRows — avis repris = max(avis statués, notices injectées)', () => {
    const [a, b, c] = KPI.parseCctpRows([
        { DeliverableId: 'a', AvisInjectes: 0, NoticesCreees: 4 },
        { DeliverableId: 'b', AvisInjectes: 6, NoticesCreees: 2 },
        { DeliverableId: 'c' },
    ]);
    assert.equal(a.avisRepris, 4);
    assert.equal(b.avisRepris, 6);
    assert.equal(c.avisRepris, 0);
});

test('parseCctpRows — exclut YIELD et lignes sans livrable', () => {
    const items = KPI.parseCctpRows([
        { DeliverableId: 'a', ContractNumber: 'C-YIELD-STUDIO-1' },
        { DeliverableId: '', ContractNumber: 'C-CT75-1' },
        { DeliverableId: 'b', ContractNumber: 'C-CT75-1' },
    ]);
    assert.deepEqual(items.map(i => i.deliverableId), ['b']);
});

test('aggregateCctp — totaux, échecs à part, dédup DeliverableId', () => {
    const items = KPI.parseCctpPayload(CCTP_CSV);
    const s = KPI.aggregateCctp(items.concat([items[0]])); // doublon volontaire
    assert.equal(s.totalLaunches, 3);
    assert.equal(s.totalOperations, 2);
    assert.equal(s.totalErrors, 1);
    assert.equal(s.uniqueContracts, 2);
    assert.equal(s.uniqueUsers, 2);
    assert.equal(s.uniqueAgencies, 2);
    assert.equal(s.totalAvis, 76);
    assert.equal(s.favorable, 29);
    assert.equal(s.suspendu, 35);
    assert.equal(s.defavorable, 10);
    assert.equal(s.critique, 30);
    assert.equal(s.analysesExploitees, 1);
    assert.equal(s.avisInjectes, 5);
    assert.equal(s.noticesCreees, 3);
    assert.equal(s.avisRepris, 5); // max(5 statués, 3 notices)
    assert.deepEqual(s.byMission.L, { analyses: 2, avis: 35 });
    assert.deepEqual(s.byMission.PV, { analyses: 1, avis: 6 });
});

test('aggregateCctp — lot vide', () => {
    const s = KPI.aggregateCctp([]);
    assert.equal(s.totalOperations, 0);
    assert.equal(s.totalAvis, 0);
    assert.deepEqual(s.byMission, {});
});

// ===================== note d'adoption =====================

test('weekIndex — lundi → dimanche dans la même semaine', () => {
    const lundi = new Date(2026, 9, 5), dimanche = new Date(2026, 9, 11, 23, 59), lundiSuivant = new Date(2026, 9, 12);
    assert.equal(KPI.weekIndex(lundi), KPI.weekIndex(dimanche));
    assert.equal(KPI.weekIndex(lundiSuivant), KPI.weekIndex(lundi) + 1);
});

test('exposureWeight — 0 au lancement, prorata, plein après 8 semaines', () => {
    const launch = new Date(2026, 8, 17);
    assert.equal(KPI.exposureWeight(launch, new Date(2026, 8, 17)), 0);
    assert.equal(KPI.exposureWeight(launch, new Date(2026, 9, 8)), 3 / 8);
    assert.equal(KPI.exposureWeight(launch, new Date(2026, 11, 31)), 1);
    assert.equal(KPI.exposureWeight(new Date(2026, 11, 1), new Date(2026, 9, 1)), 0); // lancé après la référence
    assert.equal(KPI.exposureWeight(null, new Date()), 1);
});

test('adoptionLevel — seuils', () => {
    assert.equal(KPI.adoptionLevel(100), 'Adopté');
    assert.equal(KPI.adoptionLevel(80), 'Adopté');
    assert.equal(KPI.adoptionLevel(79), 'Régulier');
    assert.equal(KPI.adoptionLevel(40), 'Occasionnel');
    assert.equal(KPI.adoptionLevel(39), 'Découverte');
    assert.equal(KPI.adoptionLevel(0), 'Découverte');
});

test('adoptionScore — utilisateur assidu : note maximale', () => {
    const ref = new Date(2026, 9, 6);
    const r = KPI.adoptionScore({
        sessions: 582, activeWeeks: 10, firstDate: new Date(2026, 7, 3), lastDate: new Date(2026, 9, 5),
        modulesUsed: 8, exposure: 7.4,
    }, ref);
    assert.equal(r.score, 100);
    assert.equal(r.level, 'Adopté');
});

test('adoptionScore — une seule session aujourd\'hui : Découverte', () => {
    const ref = new Date(2026, 9, 6);
    const r = KPI.adoptionScore({
        sessions: 1, activeWeeks: 1, firstDate: ref, lastDate: ref, modulesUsed: 1, exposure: 3,
    }, ref);
    // récurrence 1/8 · volume ln2/ln101 · diversité 1/3 · fraîcheur pleine
    assert.equal(r.details.weeksObserved, 8);
    assert.equal(r.score, Math.round(35 / 8 + 25 * Math.log(2) / Math.log(101) + 20 / 3 + 20));
    assert.equal(r.level, 'Découverte');
});

test('adoptionScore — fraîcheur par paliers', () => {
    const ref = new Date(2026, 9, 6);
    const at = days => KPI.adoptionScore({
        sessions: 0, activeWeeks: 0, firstDate: null, lastDate: new Date(2026, 9, 6 - days), modulesUsed: 0, exposure: 1,
    }, ref).parts.freshness;
    assert.equal(at(7), 20);
    assert.equal(at(8), 14);
    assert.equal(at(30), 14);
    assert.equal(at(60), 8);
    assert.equal(at(90), 4);
    assert.equal(at(91), 0);
});

test('adoptionScore — un module récent ne pénalise pas, l\'utiliser tôt rapporte', () => {
    const ref = new Date(2026, 9, 6);
    const base = { sessions: 10, activeWeeks: 4, firstDate: new Date(2026, 8, 1), lastDate: ref };
    const sansNouveau = KPI.adoptionScore(Object.assign({ modulesUsed: 5, exposure: 7 }, base), ref);
    const nouveauAjoute = KPI.adoptionScore(Object.assign({ modulesUsed: 5, exposure: 7 + 0.375 }, base), ref);
    const avecNouveau = KPI.adoptionScore(Object.assign({ modulesUsed: 6, exposure: 7 + 0.375 }, base), ref);
    assert.ok(sansNouveau.parts.diversity - nouveauAjoute.parts.diversity < 1);
    assert.ok(avecNouveau.parts.diversity > sansNouveau.parts.diversity);
    // jamais plus que le plein score
    assert.equal(KPI.adoptionScore(Object.assign({ modulesUsed: 6, exposure: 5.2 }, base), ref).parts.diversity, 20);
});

test('adoptionScore — déterministe (indépendant de l\'heure d\'appel)', () => {
    const u = { sessions: 13, activeWeeks: 5, firstDate: new Date(2026, 6, 28), lastDate: new Date(2026, 9, 3), modulesUsed: 2, exposure: 3 };
    const ref = new Date(2026, 9, 6);
    assert.deepEqual(KPI.adoptionScore(u, ref), KPI.adoptionScore(Object.assign({}, u), new Date(2026, 9, 6, 23, 0)));
});

test('median — impair, pair, vide', () => {
    assert.equal(KPI.median([3, 1, 2]), 2);
    assert.equal(KPI.median([10, 40, 20, 30]), 25);
    assert.equal(KPI.median([]), null);
    assert.equal(KPI.median(null), null);
});

test('mode — plus fréquent, égalité départagée par ordre alphabétique, vides ignorés', () => {
    assert.equal(KPI.mode(['LYCT', 'BXCT', 'LYCT']), 'LYCT');
    assert.equal(KPI.mode(['LYCT', 'BXCT']), 'BXCT');
    assert.equal(KPI.mode(['', '', 'BXCT']), 'BXCT');
    assert.equal(KPI.mode(['', null]), null);
});

test('adoptionSummary — effectif, médiane, niveaux à zéro inclus, part Régulier et plus', () => {
    const s = KPI.adoptionSummary([
        { score: 90, level: 'Adopté' }, { score: 65, level: 'Régulier' },
        { score: 45, level: 'Occasionnel' }, { score: 10, level: 'Découverte' },
    ]);
    assert.equal(s.count, 4);
    assert.equal(s.median, 55);
    assert.deepEqual(s.levels, { 'Adopté': 1, 'Régulier': 1, 'Occasionnel': 1, 'Découverte': 1 });
    assert.equal(s.regularShare, 0.5);
    const vide = KPI.adoptionSummary([]);
    assert.equal(vide.median, null);
    assert.equal(vide.regularShare, null);
    assert.equal(vide.levels['Adopté'], 0);
});
