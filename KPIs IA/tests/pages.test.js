// Garde-fou : aucune page transverse ne décroche du catalogue des modules.
// Lancer :  node --test tests/pages.test.js
//
// Une page « transverse » lit les sources de plusieurs modules IA. Elle doit
// les charger par loadCatalogueSources (shared/sources.js) à partir du
// catalogue (shared/adoption.js) : un module ajouté au catalogue y apparaît
// alors sans la modifier. Une page transverse qui tient sa propre liste de
// sources fait échouer ce test, sauf exemption motivée ci-dessous.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

global.KPI = require('../shared/utils.js');
const KPIAdoption = require('../shared/adoption.js');
const { CATALOGUE_SOURCES, loadCatalogueSources } = require('../shared/sources.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Variables d'URL lues aussi pour vérifier le mot de passe (présence dans la
// réponse du webhook) : leur mention ne dit pas qu'une page charge la source.
const AUTH_PROBES = new Set(['DESCRIPTIF_URL', 'AUTOCONTACT_URL', 'COMPARATEUR_URL']);

// Pages transverses qui chargent encore leurs sources à la main. Chaque
// entrée dit pourquoi ; en migrer une = la retirer d'ici.
const EXEMPT = {
    'app.js': 'Tableau de bord principal : chargement historique, source par source ; il alimente le catalogue mais ne passe pas encore par loadCatalogueSources (à migrer).',
    'retention.js': 'Rétention : liste à la main sans Géotech, Acoustique, CCTP, NF Habitat ni Autocontact SPS (à migrer).',
    'explorer-chats.js': 'Explorateur des sessions chat et expert : son périmètre est les chats, pas les modules.',
};

// Sources de modules qu'un script lit à la main (hors sondes d'authentification).
function handLoadedSources(script) {
    return Object.keys(CATALOGUE_SOURCES).filter(key => CATALOGUE_SOURCES[key].urls
        .some(v => !AUTH_PROBES.has(v) && new RegExp('\\b' + v + '\\b').test(script)));
}

const pageScripts = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));

// ===================== catalogue ↔ sources =====================

test('chaque module du catalogue déclare une source, lue par CATALOGUE_SOURCES', () => {
    const modules = KPIAdoption.catalogue({}, { isDescriptifRow: () => true, isNFHabitatItem: () => true });
    const ids = new Set();
    modules.forEach(m => {
        assert.ok(!ids.has(m.id), `id de module en double : ${m.id}`);
        ids.add(m.id);
        assert.ok(m.source, `module ${m.id} : champ source manquant`);
        assert.ok(CATALOGUE_SOURCES[m.source],
            `module ${m.id} : la source « ${m.source} » n'est pas déclarée dans CATALOGUE_SOURCES (shared/sources.js)`);
    });
});

test('events() de chaque module ne lit que sa propre source', () => {
    const read = [];
    const data = new Proxy({}, { get: (_, key) => { read.push(key); return []; } });
    KPIAdoption.catalogue(data, { isDescriptifRow: () => true, isNFHabitatItem: () => true }).forEach(m => {
        read.length = 0;
        m.events();
        assert.deepEqual([...new Set(read)], [m.source], `module ${m.id} : events() lit ${read.join(', ')}`);
    });
});

test('sourcesFor — sources des modules d\'une filiale, dans l\'ordre du catalogue', () => {
    const ct = KPIAdoption.sourcesFor(KPIAdoption.FILIALES.CT);
    assert.ok(ct.includes('descriptif') && ct.includes('cctp') && ct.includes('acoustique'));
    assert.ok(!ct.includes('chatSps'));
    assert.deepEqual(KPIAdoption.modulesOf(KPIAdoption.FILIALES.CT).map(m => m.source), ct);
});

test('chaque source déclarée se lit sans erreur sur un fichier absent ou vide', async () => {
    const fetched = [];
    global.fetch = async url => { fetched.push(url); return { ok: true, text: async () => '' }; };
    const urls = {};
    Object.values(CATALOGUE_SOURCES).forEach(s => s.urls.forEach(v => { urls[v] = 'https://exemple.test/' + v; }));
    delete urls.GEOTECH_URL; // une variable absente du webhook
    const r = await loadCatalogueSources(urls, null, ['POPULATION_CIBLE_URL']);
    Object.keys(CATALOGUE_SOURCES).forEach(k => assert.deepEqual(r.data[k], [], `source ${k}`));
    assert.deepEqual(r.missing.sort(), ['GEOTECH_URL', 'POPULATION_CIBLE_URL']);
    // Chaque URL n'est lue qu'une fois.
    assert.equal(fetched.length, new Set(fetched).size);
    delete global.fetch;
});

test('loadCatalogueSources refuse une source non déclarée', async () => {
    await assert.rejects(loadCatalogueSources({}, ['inconnue']), /CATALOGUE_SOURCES/);
});

// ===================== pages =====================

test('aucune page transverse ne tient sa propre liste de sources de modules', () => {
    const offenders = pageScripts
        .filter(f => !EXEMPT[f])
        .map(f => ({ f, sources: handLoadedSources(read(f)) }))
        .filter(x => x.sources.length >= 2);
    assert.deepEqual(offenders, [],
        'Ces pages lisent plusieurs sources de modules à la main ; passer par loadCatalogueSources '
        + '(shared/sources.js) et KPIAdoption.sourcesFor, ou ajouter une exemption motivée dans tests/pages.test.js : '
        + offenders.map(x => `${x.f} (${x.sources.join(', ')})`).join(' ; '));
});

test('les exemptions sont toujours nécessaires', () => {
    Object.keys(EXEMPT).forEach(f => {
        assert.ok(fs.existsSync(path.join(ROOT, f)), `exemption pour un fichier disparu : ${f}`);
        assert.ok(handLoadedSources(read(f)).length >= 2,
            `${f} ne lit plus plusieurs sources à la main : retirer son exemption de tests/pages.test.js`);
    });
});

test('les pages qui chargent par le catalogue incluent les modules partagés, dans l\'ordre', () => {
    const consumers = pageScripts.filter(f => /\bloadCatalogueSources\s*\(/.test(read(f)));
    assert.ok(consumers.includes('agencesCT.js') && consumers.includes('adoption-agences.js'));
    consumers.forEach(js => {
        const html = js.replace(/\.js$/, '.html');
        assert.ok(fs.existsSync(path.join(ROOT, html)), `${js} : page ${html} introuvable`);
        const src = [...read(html).matchAll(/<script\s+src="([^"?]+)/g)].map(m => m[1]);
        const pos = name => src.indexOf(name);
        ['shared/utils.js', 'shared/sources.js', 'shared/adoption.js', 'shared/cctp-rict.js'].forEach(dep =>
            assert.ok(pos(dep) >= 0 && pos(dep) < pos(js), `${html} : ${dep} doit être chargé avant ${js}`));
        assert.ok(pos('shared/utils.js') < pos('shared/sources.js') && pos('shared/sources.js') < pos('shared/adoption.js'),
            `${html} : ordre attendu utils → sources → adoption`);
        assert.match(read(js), /KPIAdoption\.(sourcesFor|modulesOf)\(/,
            `${js} : choisir les sources par KPIAdoption.sourcesFor, pas par une liste écrite à la main`);
    });
});
