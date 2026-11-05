// Tests du module shared/claude.js
// Lancer :  node --test tests/claude.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/claude.js');

const membres = (o) => Object.assign({
    sieges: 10, premium: 2, actifs_periode: 9, actifs_7j: 8, reguliers: 5, conversations: 40,
    messages_chat: 100, messages_cowork: 200, sessions_cowork: 30, sessions_code: 0, pull_requests: 0,
    projets_crees: 3, artefacts: 20, artefacts_cowork: 12, artefacts_code: 0, artefacts_chat: 8,
    utilisateurs_cowork: 6, utilisateurs_code: 0, part_top20: 1,
    entites: { 'BTP Consultants': { sieges: 10, messages: 300, artefacts: 20, jours: 90 } },
    top_utilisateurs: [{ nom: 'A', messages: 200 }, { nom: 'B', messages: 100 }],
}, o);

const KPIS = {
    version: 1,
    teams: {
        groupe: { historique: [
            { date: '2026-11-02', membres: membres({ actifs_7j: 6 }) },
            { date: '2026-11-09', membres: membres({ actifs_7j: 8 }), skills: { skills_distincts: 3, skills_nommes: 2, invocations: 50, invocations_anthropic: 20, top: [{ nom: 'docx', utilisateurs: 2, invocations: 20, origine: 'anthropic' }] } },
        ] },
        ppi: { historique: [
            { date: '2026-11-09', membres: membres({ sieges: 4, actifs_7j: 3, messages_chat: 10, messages_cowork: 0, entites: { Citae: { sieges: 4, messages: 10, artefacts: 1, jours: 8 } }, top_utilisateurs: [{ nom: 'C', messages: 150 }] }),
              skills: { skills_distincts: 1, skills_nommes: 1, invocations: 5, invocations_anthropic: 5, top: [{ nom: 'docx', utilisateurs: 1, invocations: 5, origine: 'anthropic' }] } },
        ] },
    },
};

test('teamsAvailable — ordre fixe, Teams sans relevé exclues', () => {
    assert.deepEqual(C.teamsAvailable(KPIS), ['groupe', 'ppi']);
    assert.deepEqual(C.teamsAvailable({ teams: { ppi: { historique: [] } } }), []);
    assert.deepEqual(C.teamsAvailable(null), []);
});

test('view — une Team : relevé courant et précédent', () => {
    const v = C.view(KPIS, 'groupe', 'membres');
    assert.equal(v.cur.actifs_7j, 8);
    assert.equal(v.prev.actifs_7j, 6);
    assert.equal(v.date, '2026-11-09');
});

test('view — deux Teams : sommes exactes, pas d\'évolution sans relevé précédent partout', () => {
    const v = C.view(KPIS, 'tous', 'membres');
    assert.equal(v.cur.sieges, 14);
    assert.equal(v.cur.actifs_7j, 11);
    assert.equal(v.prev, null);
    assert.deepEqual(Object.keys(v.cur.entites).sort(), ['BTP Consultants', 'Citae']);
});

test('combineMembres — top 20 fusionné et part recalculée', () => {
    const m = C.combineMembres([membres({}), membres({ messages_chat: 10, messages_cowork: 0, top_utilisateurs: [{ nom: 'C', messages: 150 }] })]);
    assert.deepEqual(m.top_utilisateurs.map((u) => u.nom), ['A', 'C', 'B']);
    assert.equal(m.part_top20, 450 / 310);
});

test('combineSkills — un même skill s\'additionne entre Teams', () => {
    const v = C.view(KPIS, 'tous', 'skills');
    assert.equal(v.cur.invocations, 55);
    assert.deepEqual(v.cur.top, [{ nom: 'docx', utilisateurs: 3, invocations: 25, origine: 'anthropic' }]);
});

test('combineFonctionnalites — part recalculée sur les actifs réunis', () => {
    const f = C.combineFonctionnalites([
        { skills_utilises: 5, serveurs_mcp: 3, adoption: [{ fonction: 'Skills', utilisateurs: 8, actifs: 10, part: 0.8 }], mcp: [] },
        { skills_utilises: 2, serveurs_mcp: 1, adoption: [{ fonction: 'Skills', utilisateurs: 2, actifs: 10, part: 0.2 }], mcp: [] },
    ]);
    assert.equal(f.adoption[0].part, 0.5);
    assert.equal(f.skills_utilises, 7);
    assert.equal(f.serveurs_mcp, 3);
});

test('series — par date, et en « tous » seulement aux dates communes', () => {
    assert.deepEqual(C.series(KPIS, 'groupe', 'actifs_7j'), [{ date: '2026-11-02', value: 6 }, { date: '2026-11-09', value: 8 }]);
    assert.deepEqual(C.series(KPIS, 'tous', 'actifs_7j'), [{ date: '2026-11-09', value: 11 }]);
});

test('delta — absolu et relatif, null sans précédent', () => {
    assert.deepEqual(C.delta(12, 10), { abs: 2, pct: 0.2 });
    assert.deepEqual(C.delta(3, 0), { abs: 3, pct: null });
    assert.equal(C.delta(3, undefined), null);
});
