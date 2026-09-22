// ============================================================================
// tools/csv-to-autocontact-sps.js — convertit un export CSV du backoffice
// BTP Force (admin.btp-force.cloud/contacts) en `autocontact_sps.json`, le
// fichier que la page Autocontact SPS lit dans le bucket Supabase.
//
//     node tools/csv-to-autocontact-sps.js "chemin/vers/export.csv" [sortie.json]
//
// Puis déposer le JSON produit dans le bucket `DataFromMetabase` (remplacer le
// fichier existant). Le webhook passwordROI le signe déjà sous le nom
// AUTOCONTACT_SPS_URL : rien d'autre à faire, la page prend la nouvelle donnée
// à la prochaine ouverture.
//
// DEUX RÈGLES qui expliquent ce script :
//   1. Le bucket est PUBLIC. Les colonnes nominatives des contacts externes
//      (nom, prénom, email, téléphone, fonction, qualité, id) ne sont donc PAS
//      recopiées — la page n'en a pas besoin, elle ne compte que des volumes.
//   2. La forme de sortie est celle des items GraphQL `listContactTrackings`.
//      Le jour où l'accès API est ouvert, n8n produira le même fichier et la
//      page n'aura pas à changer.
// ============================================================================

const fs = require('fs');
const path = require('path');
const KPI = require('../shared/utils.js');

const [, , csvPath, outPathArg] = process.argv;
if (!csvPath) {
    console.error('Usage : node tools/csv-to-autocontact-sps.js "<export.csv>" [sortie.json]');
    process.exit(1);
}
const outPath = outPathArg || path.join(path.dirname(csvPath), 'autocontact_sps.json');

const rows = KPI.parseFullCSV(fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, ''), ';');
if (rows.length < 2) {
    console.error('CSV vide ou illisible :', csvPath);
    process.exit(1);
}

const headers = rows[0];
const COLUMNS = {
    date: 'Date',
    heure: 'Heure',
    origine: 'Origine',
    email: 'Utilisateur - email',
    nom: 'Utilisateur - nom',
    prenom: 'Utilisateur - prénom',
    direction: 'Direction',
    agence: 'Agence',
    service: 'Service de production',
    centre: 'Centre analytique',
    contactType: 'Contact - type',
    societe: 'Société',
    affaireNum: 'Affaire - numéro',
    affaireNom: 'Affaire - nom',
    projet: 'Projet IA',
    livrable: 'Livrable IA',
    typeLivrable: 'Type de livrable',
    proposes: 'Contacts proposés par le livrable'
};

const idx = {};
const missing = [];
for (const [key, label] of Object.entries(COLUMNS)) {
    idx[key] = headers.indexOf(label);
    if (idx[key] < 0) missing.push(label);
}
if (missing.length) {
    console.error("Colonnes absentes de l'export (le backoffice a changé ?) :", missing.join(', '));
    process.exit(1);
}

const get = (row, i) => (i < row.length ? row[i] : '');
const nullIfEmpty = v => (v && v.trim() !== '' ? v : null);

const ignored = [];
const items = rows.slice(1).map((row, i) => {
    const date = KPI.parseFrDateTime(get(row, idx.date), get(row, idx.heure));
    if (!date) { ignored.push(i + 2); return null; }
    return {
        createdAt: date.toISOString(),
        sourceType: get(row, idx.origine).toUpperCase() === 'IA' ? 'IA' : 'MANUAL',
        userEmail: get(row, idx.email),
        userFirstname: get(row, idx.prenom),
        userLastname: get(row, idx.nom),
        direction: nullIfEmpty(get(row, idx.direction)),
        agencyName: nullIfEmpty(get(row, idx.agence)),
        productionService: nullIfEmpty(get(row, idx.service)),
        analyticCenter: nullIfEmpty(get(row, idx.centre)),
        contactType: nullIfEmpty(get(row, idx.contactType)),
        companyName: nullIfEmpty(get(row, idx.societe)),
        affairNumber: nullIfEmpty(get(row, idx.affaireNum)),
        affairName: nullIfEmpty(get(row, idx.affaireNom)),
        projectId: nullIfEmpty(get(row, idx.projet)),
        deliverableId: nullIfEmpty(get(row, idx.livrable)),
        deliverableType: nullIfEmpty(get(row, idx.typeLivrable)),
        proposedCount: parseInt(get(row, idx.proposes), 10) || 0
    };
}).filter(Boolean);

fs.writeFileSync(outPath, JSON.stringify(items), 'utf8');

const ia = items.filter(i => i.sourceType === 'IA').length;
const dates = items.map(i => i.createdAt).sort();
console.log(`${items.length} lignes écrites dans ${outPath}`);
console.log(`  dont IA : ${ia} · saisie manuelle : ${items.length - ia}`);
console.log(`  période : ${dates[0]} → ${dates[dates.length - 1]}`);
if (ignored.length) console.log(`  lignes ignorées (date illisible) : ${ignored.join(', ')}`);
console.log('\nÀ faire : remplacer autocontact_sps.json dans le bucket Supabase DataFromMetabase.');
