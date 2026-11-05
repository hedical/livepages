// Tests du nœud n8n « CCTP AnalyzTech » (tools/n8n-cctp-analyztech.js) :
// les lignes produites doivent se lire comme celles de la card 160.
// Lancer :  node --test tests/cctp-at.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const AT = require('../tools/n8n-cctp-analyztech.js');
const KPI = require('../shared/utils.js');

const DELIVERABLE = {
    id: 'd1', type: 'CCTP_VS_REFERENTIEL', status: 'COMPLETED',
    createdAt: '2026-10-29T11:12:25.577Z', updatedAt: '2026-10-29T11:23:53.976Z',
    createdByUserId: 'u1',
    project: { id: 'p1', name: 'Escalier A, 1 bis rue de Lutèce' },
    attribution: { source: 'USAGE_HISTORY', status: 'RECORDED', entries: [{ companyId: AT.GROUPE_COMPANY_ID, buId: 'bu' }] },
};
const DETAIL = {
    long_result: {
        type: 'CCTP_VS_REFERENTIEL',
        input: { missions: ['S', 'F'] },
        summary: { totalMissions: 2, failedMissions: 0, totalElements: 25 },
        avis: [
            { statut: 'defavorable', criticite: 'critique', missionCode: 'S' },
            { statut: 'defavorable', criticite: 'eleve', missionCode: 'S' },
            { statut: 'suspendu', criticite: 'critique', missionCode: 'F' },
            { statut: 'favorable', criticite: 'faible', missionCode: 'F', horsMission: true },
            { statut: 'a_verifier', criticite: 'modere', missionCode: 'F' },
        ],
    },
};

test('rowFromDeliverable — compteurs au format card 160', () => {
    const r = AT.rowFromDeliverable(DELIVERABLE, DETAIL, 'Laurent.X@btp-consultants.fr');
    assert.equal(r.Source, 'AT');
    assert.equal(r.UserEmail, 'laurent.x@btp-consultants.fr');
    assert.equal(r.Missions, 'S,F');
    assert.equal(r.TotalElements, 25);
    assert.equal(r.TotalAvis, 5);
    assert.deepEqual([r.AvisFavorable, r.AvisSuspendu, r.AvisDefavorable, r.AvisAutre], [1, 1, 2, 1]);
    assert.deepEqual([r.AvisCritique, r.AvisEleve, r.AvisHorsMission], [2, 1, 1]);
    assert.equal(r.AvisParMission, 'F:3;S:2');
    assert.equal(r.ContractNumber, '');
    assert.equal(r.AvisInjectes, 0);
});

test('rowFromDeliverable — livrable en erreur, sans détail', () => {
    const r = AT.rowFromDeliverable(Object.assign({}, DELIVERABLE, { status: 'ERROR' }), null, '');
    assert.equal(r.Status, 'ERROR');
    assert.equal(r.TotalAvis, 0);
    assert.equal(r.Missions, '');
});

test('rowFromDeliverable → KPI.parseCctpRows : la ligne se lit comme une analyse AT', () => {
    const [item] = KPI.parseCctpRows([AT.rowFromDeliverable(DELIVERABLE, DETAIL, 'a@btp-consultants.fr')]);
    assert.equal(item.source, 'AT');
    assert.equal(item.projectId, 'p1');
    assert.deepEqual(item.missions, ['S', 'F']);
    assert.deepEqual(item.avisParMission, { F: 3, S: 2 });
    assert.equal(item.exploitee, false);
    const s = KPI.aggregateCctp([item]);
    assert.equal(s.totalOperations, 1);
    assert.equal(s.operationsAT, 1);
    assert.equal(s.uniqueContracts, 1);
});

test('inScope — BTP Consultants, ou Groupe quand le lanceur est inconnu', () => {
    assert.equal(AT.inScope(DELIVERABLE, 'a@btp-consultants.fr'), true);
    assert.equal(AT.inScope(DELIVERABLE, 'hedi@databuildr.com'), false);
    assert.equal(AT.inScope(DELIVERABLE, ''), true);
    assert.equal(AT.inScope(Object.assign({}, DELIVERABLE, { attribution: { entries: [] } }), ''), false);
});

test('reusable — même updatedAt et statut final', () => {
    const prev = { DeliverableId: 'd1', UpdatedAt: DELIVERABLE.updatedAt, Status: 'COMPLETED' };
    assert.equal(AT.reusable(prev, DELIVERABLE), true);
    assert.equal(AT.reusable(Object.assign({}, prev, { UpdatedAt: 'autre' }), DELIVERABLE), false);
    assert.equal(AT.reusable(Object.assign({}, prev, { Status: 'PROGRESS' }), DELIVERABLE), false);
    assert.equal(AT.reusable(undefined, DELIVERABLE), false);
});

// Faux contexte n8n : httpRequest répond selon l'URL.
function fakeCtx(routes) {
    return { helpers: { httpRequest: async ({ url }) => {
        const hit = Object.keys(routes).find(k => url.includes(k));
        if (!hit) throw new Error('404 ' + url);
        const r = routes[hit];
        if (r instanceof Error) throw r;
        return typeof r === 'function' ? r(url) : r;
    } } };
}

test('main — lignes + item _diag, fichier précédent absent', async () => {
    const ctx = fakeCtx({
        '/deliverables?type=': { items: [DELIVERABLE], totalPages: 1 },
        '/deliverables/d1': DETAIL,
        '/users/u1': { email: 'a@btp-consultants.fr' },
    });
    const out = await AT.main(ctx, { token: 't' }, 'k', {});
    const rows = out.filter(i => i.json.DeliverableId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].json.UserEmail, 'a@btp-consultants.fr');
    const diag = out.find(i => i.json._diag).json._diag;
    assert.equal(diag.livrables, 1);
    assert.equal(diag.lignes, 1);
    assert.ok(diag.previousError);
});

test('main — échec de la liste : seul _diag sort (rien à uploader)', async () => {
    await assert.rejects(AT.main(fakeCtx({ '/deliverables?type=': new Error('401') }), { token: 't' }, 'k', {}));
    const out = await AT.main(fakeCtx({}), {}, 'k', {});
    assert.equal(out.length, 1);
    assert.ok(out[0].json._diag.error);
});
