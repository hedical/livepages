// ============================================================================
// tools/n8n-cctp-analyztech.js — code du nœud n8n « CCTP AnalyzTech »
// (workflow « ROI Global »), qui écrit `analyse_cctp_at.json` : les analyses
// CCTP vs Référentiel lancées DIRECTEMENT dans AnalyzTech, hors S+.
//
// Ce fichier est la source de vérité : on le colle tel quel dans le nœud Code
// (mode « Run Once for All Items »). Hors n8n ($input absent), il exporte ses
// fonctions pures pour les tests (tests/cctp-at.test.js).
//
// Chaîne : Token AnalyzTech → CCTP AnalyzTech → CCTP AT OK ? (garde les items
//          qui ont un DeliverableId) → Convert to File CCTP AT
//          → POST CCTP AT (upsert analyse_cctp_at.json) → Respond to Webhook
//
// AUCUNE CLÉ ICI (le dépôt est publié en public) : la clé d'API AnalyzTech est
// lue dans les paramètres du nœud `GET Auto Control1` (dans `Token AnalyzTech`
// elle n'est qu'une expression vers celui-ci), le jeton dans la sortie de
// `Token AnalyzTech`,
// les en-têtes Supabase dans ceux de `POST Acoustique`. Renommer ces nœuds
// casse la chaîne.
//
// Sources AnalyzTech (spec : https://api.analyztech.com/api-json) :
//   GET /v1/deliverables?type=CCTP_VS_REFERENTIEL  (superadmin) : id, statut,
//       dates, createdByUserId, projet, attribution company/BU — pas d'avis ;
//   GET /v1/deliverables/{id} : long_result (avis[], input.missions, summary),
//       ~160 KB — lu UNE fois par livrable, puis repris du fichier précédent ;
//   GET /v1/users/{id} : e-mail du lanceur (createdByUserId, renseigné
//       depuis le 19/10/2026) ;
//   GET /v1/admin/projects-by-type : e-mail du propriétaire du projet, pour les
//       livrables plus anciens (createdByUserId null).
//
// Le nœud sort TOUJOURS un item `_diag` (comptages, ou message d'erreur) en
// plus des lignes : c'est ce qu'on lit dans l'exécution n8n pour diagnostiquer.
// L'IF `CCTP AT OK ?` l'écarte avant l'upload. En cas d'échec (jeton, liste),
// seul `_diag` sort : l'IF ne laisse rien passer et le fichier précédent reste
// en place (jamais d'erreur écrite par-dessus la donnée, cf. l'incident
// auto_control.json de septembre 2026).
// Une ligne = mêmes colonnes que la card 160 (KPI.parseCctpRows), + Source,
// ProjectId, ProjectName, UpdatedAt.
// ============================================================================

const API = 'https://api.analyztech.com/v1';
const BUCKET = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/DataFromMetabase';
const FILE = 'analyse_cctp_at.json';
// Company AnalyzTech « Groupe BTP-Consultants » : périmètre retenu quand le
// lanceur n'est pas identifiable (projet supprimé).
const GROUPE_COMPANY_ID = 'ec82845a-21b7-4342-8ad9-1af91ca3d3e0';
const DOMAIN = '@btp-consultants.fr';
const FINAL = new Set(['COMPLETED', 'ERROR']);

// ----- Fonctions pures (testées) -----

// Livrable de la liste + détail (ou null) + e-mail → ligne au format card 160.
// Le long_result AnalyzTech porte les avis à la racine (S+ : sous `cctp`).
function rowFromDeliverable(d, detail, email) {
    const lr = (detail && detail.long_result) || {};
    const c = lr.cctp || lr;
    const avis = Array.isArray(c.avis) ? c.avis : [];
    const count = f => avis.filter(f).length;
    const VERDICTS = ['favorable', 'suspendu', 'defavorable'];
    const parMission = {};
    avis.forEach(a => {
        const m = a.missionCode || '?';
        parMission[m] = (parMission[m] || 0) + 1;
    });
    const missions = (c.input && Array.isArray(c.input.missions) && c.input.missions)
        || (Array.isArray(c.missions) && c.missions)
        || (Array.isArray(c.missionsStatus) ? c.missionsStatus.map(m => m.missionCode).filter(Boolean) : []);
    const sum = c.summary || {};
    return {
        DeliverableId: d.id,
        EventDate: d.createdAt,
        UpdatedAt: d.updatedAt,
        Status: d.status,
        Source: 'AT',
        ProjectId: (d.project && d.project.id) || '',
        ProjectName: (d.project && d.project.name) || '',
        UserEmail: (email || '').toLowerCase(),
        ContractNumber: '',
        DR: '',
        Agence: '',
        Missions: missions.join(','),
        TotalMissions: sum.totalMissions || missions.length,
        FailedMissions: sum.failedMissions || 0,
        TotalElements: sum.totalElements || 0,
        TotalAvis: avis.length,
        AvisFavorable: count(a => a.statut === 'favorable'),
        AvisSuspendu: count(a => a.statut === 'suspendu'),
        AvisDefavorable: count(a => a.statut === 'defavorable'),
        AvisAutre: count(a => !VERDICTS.includes(a.statut)),
        AvisCritique: count(a => a.criticite === 'critique'),
        AvisEleve: count(a => a.criticite === 'eleve'),
        AvisHorsMission: count(a => a.horsMission === true || a.horsMission === 'true'),
        AvisParMission: Object.keys(parMission).sort().map(k => k + ':' + parMission[k]).join(';'),
        ReportId: '',
        AvisInjectes: 0,
        NoticesCreees: 0,
        Injecteurs: '',
    };
}

// Périmètre : lanceur BTP Consultants ; lanceur inconnu → attribution
// historique à la company du Groupe. Le reste (comptes Databuildr, autres
// clients AnalyzTech) est écarté.
function inScope(d, email) {
    if (email) return email.toLowerCase().endsWith(DOMAIN);
    const entries = (d.attribution && d.attribution.entries) || [];
    return entries.some(e => e && e.companyId === GROUPE_COMPANY_ID);
}

// Ligne précédente réutilisable : même livrable, même updatedAt, statut final.
function reusable(prev, d) {
    return !!prev && prev.UpdatedAt === d.updatedAt && FINAL.has(prev.Status);
}

// ----- Exécution n8n -----

async function main(ctx, tokenJson, apiKey, supa) {
    const http = opts => ctx.helpers.httpRequest(Object.assign({ json: true, timeout: 60000 }, opts));
    const token = tokenJson.token || tokenJson.accessToken || tokenJson.access_token;
    if (!token || !apiKey) return [{ json: { _diag: { error: 'pas de jeton ou de clé', token: !!token, apiKey: !!apiKey } } }];
    const at = { 'x-api-key': apiKey, Authorization: 'Bearer ' + token };

    // 1. Livrables CCTP (paginé, 100 max par page).
    const list = [];
    for (let page = 1; page <= 100; page++) {
        const r = await http({ url: `${API}/deliverables?type=CCTP_VS_REFERENTIEL&page=${page}&limit=100`, headers: at });
        if (!r || !Array.isArray(r.items)) throw new Error('Réponse inattendue de /deliverables');
        list.push(...r.items);
        if (page >= (r.totalPages || 1)) break;
    }
    const done = list.filter(d => FINAL.has(d.status));

    // 2. Fichier précédent (absent au premier passage).
    let previous = [];
    let previousError = '';
    try {
        const prev = await http({ url: `${BUCKET}/${FILE}`, headers: supa });
        previous = Array.isArray(prev) ? prev : [];
    } catch (e) { previousError = e.message; }
    const prevById = new Map(previous.map(r => [r.DeliverableId, r]));

    // 3. E-mails : lanceur (users/{id}), sinon propriétaire du projet.
    const emails = new Map(); // deliverableId → email
    const userCache = new Map();
    const needOwner = new Set();
    for (const d of done) {
        const prev = prevById.get(d.id);
        if (prev && prev.UserEmail) { emails.set(d.id, prev.UserEmail); continue; }
        if (d.createdByUserId) {
            if (!userCache.has(d.createdByUserId)) {
                try {
                    const u = await http({ url: `${API}/users/${d.createdByUserId}`, headers: at });
                    userCache.set(d.createdByUserId, (u && u.email) || '');
                } catch (e) { userCache.set(d.createdByUserId, ''); }
            }
            if (userCache.get(d.createdByUserId)) { emails.set(d.id, userCache.get(d.createdByUserId)); continue; }
        }
        if (d.project && d.project.id) needOwner.add(d.project.id);
    }
    if (needOwner.size) {
        const owners = new Map();
        for (const type of ['REPORT', 'PROJECT']) {
            for (let page = 1; page <= 200 && owners.size < needOwner.size; page++) {
                let r;
                try { r = await http({ url: `${API}/admin/projects-by-type?type=${type}&page=${page}&limit=100`, headers: at }); }
                catch (e) { break; }
                const items = (r && r.projects) || [];
                items.forEach(p => { if (needOwner.has(p.id) && p.user && p.user.email) owners.set(p.id, p.user.email); });
                const tp = (r && r.pagination && r.pagination.totalPages) || 1;
                if (!items.length || page >= tp) break;
            }
        }
        done.forEach(d => {
            if (!emails.has(d.id) && d.project && owners.has(d.project.id)) emails.set(d.id, owners.get(d.project.id));
        });
    }

    // 4. Détail (avis) des livrables nouveaux ou modifiés, 5 à la fois. La
    // ligne est calculée dès réception et le détail (~160 KB) aussitôt
    // abandonné : jamais plus de 5 détails en mémoire (n8n cloud est serré).
    const scoped = done.filter(d => inScope(d, emails.get(d.id)));
    const toFetch = scoped.filter(d => d.status === 'COMPLETED' && !reusable(prevById.get(d.id), d));
    const fresh = new Map(); // deliverableId → ligne calculée
    for (let i = 0; i < toFetch.length; i += 5) {
        await Promise.all(toFetch.slice(i, i + 5).map(async d => {
            try {
                const detail = await http({ url: `${API}/deliverables/${d.id}`, headers: at });
                fresh.set(d.id, rowFromDeliverable(d, detail, emails.get(d.id)));
            } catch (e) { /* réessayé au prochain passage */ }
        }));
    }

    const rows = [];
    scoped.forEach(d => {
        const prev = prevById.get(d.id);
        if (fresh.has(d.id)) { rows.push(fresh.get(d.id)); return; }
        if (reusable(prev, d)) { rows.push(Object.assign({}, prev, { UserEmail: emails.get(d.id) || prev.UserEmail || '' })); return; }
        if (d.status === 'COMPLETED') { if (prev) rows.push(prev); return; } // détail illisible : réessayé au prochain passage
        rows.push(rowFromDeliverable(d, null, emails.get(d.id)));
    });
    const diag = {
        livrables: list.length, finals: done.length, perimetre: scoped.length, lignes: rows.length,
        precedentes: previous.length, previousError, detailsLus: fresh.size, detailsDemandes: toFetch.length,
        sansEmail: done.filter(d => !emails.get(d.id)).length,
    };
    return rows.map(json => ({ json })).concat([{ json: { _diag: diag } }]);
}

if (typeof $input === 'undefined') {
    module.exports = { rowFromDeliverable, inScope, reusable, main, GROUPE_COMPANY_ID };
} else {
    // Pas d'await au niveau du fichier : il doit rester lisible par Node (tests).
    // `.params` rend la valeur BRUTE, expression non évaluée : on ne lit que
    // des nœuds où la valeur est en clair. Dans `Token AnalyzTech`, la clé est
    // une expression qui renvoie vers `GET Auto Control1` → on lit celui-ci.
    const param = (node, name) => {
        const v = ($(node).params.headerParameters.parameters.find(p => p.name === name) || {}).value;
        if (typeof v === 'string' && v.startsWith('=')) throw new Error(`${node} › ${name} est une expression, pas une valeur`);
        return v;
    };
    const run = () => main(this, $input.first().json || {}, param('GET Auto Control1', 'x-api-key'), {
        Authorization: param('POST Acoustique', 'Authorization'),
        apikey: param('POST Acoustique', 'apikey'),
    });
    return Promise.resolve().then(run).catch(e => [{ json: { _diag: { error: String(e && e.message || e) } } }]);
}
