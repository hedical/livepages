// Tests du module shared/cctp-rict.js (adoption CCTP dans les RICT, card 161)
// Lancer :  node --test tests/cctp-rict.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../shared/cctp-rict.js');

const HEADER = 'ReportId,DiffusedAt,ContractNumber,UserEmail,AuthorEmail,AuthorDR,AuthorAgence,DR,Agence,AnalysesAvant,AvisIaEmis,AvisIaEmisParMission,AvisRapport,AvisRapportIa,AvisRapportIaParMission,AvisIaInjectes,AvisIaSupprimes';
const CSV = [
    HEADER,
    // RICT avec IA : 30 émis (L 20, S 10), 40 avis au rapport dont 6 IA (L 4, S 2), 10 injectés dont 4 supprimés
    'r1,2026-10-20T10:00:00.000,C-CT75-2026-20-1,Ca@btp-consultants.fr,ra@btp-consultants.fr,DR IDF Nord,CT75,DR IDF Nord,CT75,1,30,L:20;S:10,40,6,L:4;S:2,10,4',
    // RICT avec IA, rien gardé : 10 émis (P1), 20 avis tous humains
    'r2,2026-10-21T10:00:00.000,C-CT92S-2026-20-2,cb@btp-consultants.fr,cb@btp-consultants.fr,DR IDF Sud,CT92S,DR IDF Sud,CT92S,2,10,P1:10,20,0,,0,0',
    // RICT sans IA
    'r3,2026-10-22T10:00:00.000,C-CT92S-2026-20-3,cb@btp-consultants.fr,cb@btp-consultants.fr,DR IDF Sud,CT92S,DR IDF Sud,CT92S,0,0,,30,0,,0,0',
    // test YIELD : exclu
    'r4,2026-10-22T10:00:00.000,C-YIELD-STUDIO-1,x@btp-consultants.fr,x@btp-consultants.fr,,,,,1,5,L:5,5,5,L:5,5,0',
].join('\n');

test('parsePayload — CSV brut et enveloppe n8n, YIELD exclu, emails en minuscules', () => {
    const items = R.parsePayload(CSV);
    assert.equal(items.length, 3);
    assert.equal(R.parsePayload(JSON.stringify([{ data: CSV }])).length, 3);
    const [a] = items;
    assert.equal(a.email, 'ca@btp-consultants.fr');
    assert.equal(a.author, 'ra@btp-consultants.fr');
    assert.equal(a.createdAt, '2026-10-20T10:00:00.000');
    assert.equal(a.avecIa, true);
    assert.deepEqual(a.avisIaEmisParMission, { L: 20, S: 10 });
    assert.deepEqual(a.avisRapportIaParMission, { L: 4, S: 2 });
    assert.equal(items[2].avecIa, false);
    assert.deepEqual(R.parsePayload(''), []);
    assert.deepEqual(R.parsePayload(HEADER), []);
});

test('aggregate — recours, part IA, utilisation, déchet décomposé', () => {
    const s = R.aggregate(R.parsePayload(CSV));
    assert.equal(s.rict, 3);
    assert.equal(s.rictAvecIa, 2);
    assert.equal(s.rictAvecAvisIa, 1);
    assert.equal(s.tauxRecours, 2 / 3);
    // part IA : sur les RICT avec IA seulement (40 + 20 avis), pas sur r3
    assert.equal(s.avisRapportAvecIa, 60);
    assert.equal(s.avisRapport, 90);
    assert.equal(s.partIa, 6 / 60);
    // utilisation / déchet : 6 retenus sur 40 émis
    assert.equal(s.avisIaEmis, 40);
    assert.equal(s.tauxUtilisation, 6 / 40);
    assert.equal(s.avisNonRetenus, 34);
    assert.equal(s.tauxDechet, 34 / 40);
    assert.equal(s.supprimes, 4);
    assert.equal(s.jamaisInjectes, 30);
});

test('aggregate — déchet par mission', () => {
    const s = R.aggregate(R.parsePayload(CSV));
    assert.deepEqual(
        { emis: s.byMission.L.emis, repris: s.byMission.L.repris, dechet: s.byMission.L.dechet },
        { emis: 20, repris: 4, dechet: 16 });
    assert.equal(s.byMission.L.tauxDechet, 16 / 20);
    assert.equal(s.byMission.P1.tauxDechet, 1);
    assert.equal(s.byMission.S.dechet, 8);
    assert.equal(s.byMission.F.tauxDechet, null); // jamais émis : pas de taux, pas 0 %
});

test('aggregate — garde-fous : plus d\'avis IA au rapport qu\'émis, supprimés > déchet, doublons', () => {
    const items = R.parseRows([
        { ReportId: 'x', ContractNumber: 'C-A-1', AnalysesAvant: 1, AvisIaEmis: 5, AvisIaEmisParMission: 'L:5', AvisRapport: 10, AvisRapportIa: 8, AvisRapportIaParMission: 'L:8', AvisIaSupprimes: 3 },
    ]);
    const s = R.aggregate(items.concat(items));
    assert.equal(s.rict, 1);
    assert.equal(s.avisNonRetenus, 0);
    assert.equal(s.supprimes, 0);
    assert.equal(s.byMission.L.repris, 5);
    assert.equal(s.byMission.L.dechet, 0);
});

test('aggregate — lot vide : ratios null (pas 0 %)', () => {
    const s = R.aggregate([]);
    assert.equal(s.rict, 0);
    assert.equal(s.tauxRecours, null);
    assert.equal(s.partIa, null);
    assert.equal(s.tauxDechet, null);
});

test('groupBy — par rédacteur et par agence, tri par nombre de RICT', () => {
    const items = R.parsePayload(CSV);
    const parAuteur = R.groupBy(items, i => i.author);
    assert.deepEqual(parAuteur.map(g => [g.key, g.rict, g.rictAvecIa]), [
        ['cb@btp-consultants.fr', 2, 1],
        ['ra@btp-consultants.fr', 1, 1],
    ]);
    assert.equal(parAuteur[0].tauxRecours, 0.5);
    const parAgence = R.groupBy(items, i => i.authorAgency);
    assert.deepEqual(parAgence.map(g => g.key), ['CT92S', 'CT75']);
    assert.deepEqual(R.groupBy(items, () => ''), []);
});

test('RICT en cours : comptés à part, jamais dans les taux', () => {
    const items = R.parseRows([
        { ReportId: 'd1', Statut: 'DIFFUSE', DiffusedAt: '2026-10-20T10:00:00', ContractNumber: 'C-A-1', AuthorEmail: 'a@btp-consultants.fr', AnalysesAvant: 1, AvisIaEmis: 10, AvisRapport: 20, AvisRapportIa: 2 },
        { ReportId: 'e1', Statut: 'EN_COURS', DiffusedAt: '', DerniereActiviteIa: '2026-10-26T11:26:00', ContractNumber: 'C-A-2', AuthorEmail: 'loic@btp-consultants.fr', AnalysesAvant: 1, AvisIaEmis: 40, AvisRapport: 124, AvisRapportIa: 5 },
        { ReportId: 'e2', Statut: 'EN_COURS', DiffusedAt: '', DerniereActiviteIa: '2026-10-27T09:00:00', ContractNumber: 'C-A-3', AuthorEmail: 'loic@btp-consultants.fr', AnalysesAvant: 1, AvisIaEmis: 12, AvisRapport: 0, AvisRapportIa: 0 },
    ]);
    assert.equal(items[1].diffuse, false);
    assert.equal(items[1].createdAt, '2026-10-26T11:26:00'); // date d'activité pour les filtres
    const s = R.aggregate(items);
    assert.equal(s.rict, 1);
    assert.equal(s.tauxRecours, 1);
    assert.equal(s.avisIaEmis, 10);         // les 52 avis des RICT en cours n'y sont pas
    assert.equal(s.partIa, 2 / 20);
    assert.equal(s.enCours, 2);
    assert.equal(s.enCoursAvecIa, 2);
    assert.equal(s.enCoursAvecAvisIa, 1);
    assert.equal(s.enCoursAvisIa, 5);
    const loic = R.groupBy(items, i => i.author).find(g => g.key === 'loic@btp-consultants.fr');
    assert.equal(loic.rict, 0);             // aucun RICT diffusé…
    assert.equal(loic.enCoursAvecAvisIa, 1); // …mais visible grâce au RICT en cours
    assert.equal(loic.tauxRecours, null);
});

test('Ancien fichier sans colonne Statut : tout est considéré diffusé', () => {
    const [it] = R.parseRows([{ ReportId: 'x', DiffusedAt: '2026-10-20', ContractNumber: 'C-A-1' }]);
    assert.equal(it.diffuse, true);
});

test('RICT en cours actifs : total = diffusés + en cours, date = plus récente activité', () => {
    const items = R.parseRows([
        { ReportId: 'd1', Statut: 'DIFFUSE', DiffusedAt: '2026-10-20T10:00:00', ContractNumber: 'C-A-1', AuthorEmail: 'a@btp-consultants.fr', AuthorAgence: 'CT75', AnalysesAvant: 1, AvisIaEmis: 10, AvisRapport: 20, AvisRapportIa: 2 },
        // brouillon sans IA, modifié le 25/10
        { ReportId: 'e1', Statut: 'EN_COURS', DerniereModification: '2026-10-25T08:00:00', DerniereActiviteIa: '', ContractNumber: 'C-A-2', AuthorEmail: 'a@btp-consultants.fr', AuthorAgence: 'CT75' },
        // brouillon modifié le 22/10, avis IA injectés le 26/10
        { ReportId: 'e2', Statut: 'EN_COURS', DerniereModification: '2026-10-22T08:00:00', DerniereActiviteIa: '2026-10-26T11:26:00', ContractNumber: 'C-A-3', AuthorEmail: 'b@btp-consultants.fr', AuthorAgence: 'CT75', AnalysesAvant: 1, AvisRapportIa: 3 },
    ]);
    assert.equal(items[1].createdAt, '2026-10-25T08:00:00');
    assert.equal(items[2].createdAt, '2026-10-26T11:26:00');
    const s = R.aggregate(items);
    assert.equal(s.rict, 1);
    assert.equal(s.enCours, 2);
    assert.equal(s.rictTotal, 3);
    assert.equal(s.enCoursAvecIa, 1);
    assert.equal(s.enCoursAvecAvisIa, 1);
    assert.equal(s.tauxRecours, 1);          // taux sur les diffusés seulement
    const [ct75] = R.groupBy(items, i => i.authorAgency);
    assert.deepEqual([ct75.key, ct75.rict, ct75.enCours, ct75.rictTotal], ['CT75', 1, 2, 3]);
});
