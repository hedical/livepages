# AnalyzTech - KPIs IA Groupe BTP Consultants

Tableau de bord d'analyse des données d'utilisation des fonctionnalités IA déployées dans l'entreprise.

## Fonctionnalités

- **Indicateurs généraux** :
  - Utilisation totales des fonctionnalités IA
  - Gain total estimé en heures
  - Nombre total d'utilisateurs

- **Indicateurs par fonctionnalité** :
  - Descriptif sommaire des travaux
  - Auto Contacts
  - Comparateur d'indices

- **Filtres** :
  - Filtrage par période (date de début et date de fin)
  - Filtrage par agence

## Utilisation

Ouvrez simplement le fichier `index.html` dans votre navigateur web. Aucune installation ou serveur n'est nécessaire !

### Option 1 : Double-clic
Double-cliquez sur le fichier `index.html` pour l'ouvrir dans votre navigateur par défaut.

### Option 2 : Serveur local (optionnel)
Si vous rencontrez des problèmes avec les requêtes CORS, vous pouvez utiliser un serveur HTTP local :

```bash
# Avec Python 3
python -m http.server 8000

# Avec Python 2
python -m SimpleHTTPServer 8000

# Avec Node.js (npx)
npx http-server

# Avec PHP
php -S localhost:8000
```

Puis ouvrez `http://localhost:8000` dans votre navigateur.

## Structure des données

Les données sont récupérées depuis un bucket Supabase et filtrent automatiquement les affaires contenant "YIELD" dans le numéro de contrat.

## Technologies

- HTML5
- CSS3 (Tailwind CSS via CDN)
- JavaScript (Vanilla JS)
- Aucune dépendance externe requise (sauf Tailwind CDN)

## Fichiers

- `index.html` : Structure HTML du tableau de bord
- `app.js` : Logique JavaScript pour le traitement des données et l'affichage
- `pilotage-ia.html` / `pilotage-ia.js` : Page « Pilotage économique » (coût, budget, retour)
- `shared/utils.js` : Module partagé (parsing CSV/JSON, dates, prédicats métier, constantes)
- `shared/costs.js` : Module de calcul économique (registre, relevés OpenRouter, KPIs, projection)
- `tests/utils.test.js`, `tests/costs.test.js` : Tests des modules partagés
- `README.md` : Documentation du projet

## Développement

### Module partagé (`shared/utils.js`)

Toute fonction pure dupliquée entre plusieurs pages doit vivre dans `shared/utils.js`
(namespace global `KPI`). Les pages qui l'utilisent le chargent AVANT leur script :

```html
<script src="shared/utils.js"></script>
<script src="ma-page.js"></script>
```

Les fonctions locales des pages délèguent au module (même nom, même signature) pour
ne pas casser les call sites existants. Pages migrées : `index.html` (app.js),
`descriptif.html`, `retention.html`, `analyse-ao.html`.

Constantes métier centralisées : `KPI.DESCRIPTIF_TYPE`, `KPI.AO_MODULE_START_DATE`
(mise en place du module Analyse AO : 06/06/2026 — les marchés détectés avant sont exclus).

### Pilotage économique (`pilotage-ia.html`)

Page macro, accessible depuis le bouton « Pilotage économique » de l'en-tête du
dashboard. Elle croise la **dépense IA réelle** avec les **gains déjà calculés**.
Calculs **globaux, niveau groupe** : aucune ventilation par fonctionnalité.

Toute la logique de calcul vit dans `shared/costs.js` (namespace `KPICosts`),
testée en Node. `pilotage-ia.js` ne fait que charger, orchestrer et peindre.

**Ordre de chargement obligatoire** :

```html
<script src="shared/utils.js"></script>
<script src="shared/costs.js"></script>
<script src="pilotage-ia.js"></script>
```

#### Sécurité : la clé OpenRouter ne doit jamais entrer dans ce repo

Ces pages sont déployées vers un repo **public** (`hedical/livepages`). Une clé
dans du JS navigateur serait publiquement lisible, et une clé Management
OpenRouter peut **créer et supprimer des clés** du compte.

La clé vit donc **uniquement dans les credentials n8n**. Le front ne lit qu'un
fichier de relevés déjà signé, et ne contacte jamais `openrouter.ai`.

#### Les trois sources de dépense

| Source | Périmètre |
|---|---|
| **API OpenRouter** (via n8n → bucket → URL signée `OPENROUTER_USAGE_URL`) | fait foi pour l'inférence, sur tout mois qu'elle couvre — mais seulement à partir du jour où le job tourne |
| **Exports CSV « total usage »** (déposés dans le bucket, signés par n8n → `OPENROUTER_EXPORT*`) | rattrapent l'inférence *antérieure* au job — le seul moyen de récupérer le passé. Source **partagée** : tous les postes voient la même chose |
| **Les mêmes exports importés à la main** dans la page | dépannage avant que le bucket ne soit câblé. Local à un navigateur, et **écarté** s'il double un export du bucket |
| **Registre saisi** (`localStorage`) | tout le hors-inférence (infra, OCR, licences) **et** l'inférence des mois qu'aucune des deux autres sources ne couvre |

Les deux premières sources se **cumulent** sans double comptage : ce sont des
séries de clés distinctes, et le moteur ne compte que des *deltas*. Le premier
relevé d'une clé pose une référence et n'est jamais compté comme de la dépense —
même si son cumulé vaut déjà plusieurs milliers de dollars.

**Règle anti-double-comptage** : sur un mois couvert par l'API, une ligne de
registre de catégorie `inference` est exclue du total **et signalée dans l'UI**
(bandeau « Lignes exclues du total »). Jamais silencieusement.

Le `totalCostInDollars` des briques chat/expert n'entre **jamais** dans le total.
Il n'est pas non plus affiché comme « écart » : en calcul globalisé, il couvre 8
briques sur 15, donc le comparer à la dépense OpenRouter totale produirait un
faux écart égal au coût des autres briques.

#### Contrainte d'historique OpenRouter

`GET /api/v1/keys` (Management key) retourne `usage` (cumulé) et
`usage_daily/weekly/monthly`. **Il n'existe aucun endpoint d'historique.**
`usage_monthly` est remis à zéro le 1er du mois UTC : une exécution n8n manquée
en fin de mois perdrait le mois définitivement, sans aucun signal.

Le job relève donc **`usage` cumulé chaque jour** et **empile** les relevés dans
`openrouter_usage.json` (lecture-modification-écriture, **jamais d'écrasement** :
le fichier *est* l'historique). La dépense mensuelle est calculée par **delta de
cumulé**, réparti au prorata du temps sur les mois traversés — insensible aux
relevés manquants, et sans le décalage d'un jour qu'introduirait une affectation
au seul mois de la borne haute.

Format attendu de chaque relevé (les alias `ts`/`date`, `usage`/`usageCumule`
sont tolérés, comme les 4 enveloppes de données du projet) :

```json
[ { "ts": "2026-08-24T00:05:00Z", "keyName": "prod", "usageCumule": 2400 } ]
```

Conséquences assumées :
- les mois **antérieurs** au démarrage du job sont irrécupérables *par API* → à rattraper par l'export CSV (ci-dessous), ou à défaut à saisir dans le registre ;
- toute clé dont le **premier relevé** est à un cumulé non nul fait marquer *son* mois d'entrée en scène comme incomplet — pas le premier mois toutes clés confondues, sans quoi une série complète plus ancienne serait accusée à tort. La page tait ce signalement quand l'historique importé couvre déjà le mois ;
- une **baisse** du cumulé (clé recréée, rotation) est traitée comme un redémarrage de compteur, jamais comme un delta négatif, et remontée en anomalie.

#### Rattraper l'historique par l'export CSV

L'API ne sert que le cumulé de l'instant, mais le tableau de bord OpenRouter
sait exporter la dépense **jour par jour** : *Activity → Export CSV*, colonnes
`date__day, model, total_usage`. C'est le seul chemin vers le passé.

Deux chemins, le même parseur derrière :

- **le bucket** (en place) : l'export est déposé, signé par n8n, et lu par la
  page au chargement — tout le monde voit la même chose ;
- **l'import local** : section « Registre des coûts et réglages » → **Historique
  OpenRouter** → *Importer un export CSV*. Utile pour travailler avant le
  câblage n8n, mais ne vaut que pour ce navigateur.

La conversion est faite par `KPICosts.parseOpenRouterCsv` :

- les lignes sont agrégées **par jour**, toutes lignes de modèles confondues ;
- un relevé est émis pour **chaque** jour de la plage, jours sans dépense
  compris, avec une **ancre à 0** au début du premier jour ;
- le relevé de la journée `D` porte l'instant `D+1 à 00:00 UTC`. Chaque delta
  couvre donc exactement `]D, D+1]`, un intervalle qui ne franchit jamais une
  frontière de mois : l'attribution mensuelle est **exacte**, sans prorata.

#### Organisation des fichiers dans le bucket

**Un fichier par période, jamais « le plus récent gagne ».** La page additionne
*tous* les exports qu'on lui donne ; elle n'en choisit pas un. Prendre seulement
le plus récent perdrait tout ce que cet export ne couvre pas — et un export
demandé sur 12 mois glissants finira, avec le temps, par ne plus atteindre le
début de l'historique.

La règle est donc : des fichiers **disjoints**, à noms **stables**, un par ère ou
par année.

```
DataFromMetabase/
  explorer_total_usage_ancien-compte.csv   (figé : ce compte est fermé)
  explorer_total_usage_2026.csv            (remplacé par un export plus frais)
  explorer_total_usage_2027.csv            (le jour où l'export ne remonte plus assez loin)
```

Rafraîchir = **remplacer** le fichier de la période concernée, jamais en ajouter
un second qui la recouvre. Chaque fichier garde son nom, donc l'URL signée dans
n8n ne change pas.

Deux garde-fous couvrent les erreurs de manipulation :

- deux exports de **même plage et même total** (deux variables n8n sur le même
  fichier, ou un import local doublant le bucket) : le second est **écarté** du
  calcul et signalé. Deux comptes distincts ne produisent pas le même total au
  centime sur la même plage ;
- un recouvrement **partiel** est ambigu — deux comptes réellement actifs en même
  temps ont bien dépensé les deux. Il est donc **signalé mais pas corrigé** : au
  lecteur de retirer un fichier si c'est un doublon.

#### Câblage n8n des exports

✅ **Fait le 25/08/2026** (workflow « ROI Global », `nBkh9nC95rvreM3P`) :
`explorer_total_usage_2025-2026.csv` est le **17ᵉ** path signé, mappé sur
`OPENROUTER_EXPORT_2026`. Signé à **12 h** comme les autres, régénéré à chaque
authentification.

Pour ajouter un export (autre compte, autre année) — même mécanique que les 16
autres fichiers, sans rien de nouveau côté front :

1. Déposer l'export dans le bucket (`DataFromMetabase/`).
2. Ajouter son path au nœud **`Sign URLs`**.
3. Ajouter le mapping au nœud **`Build signed response`**, sous un nom qui
   **commence par `OPENROUTER_EXPORT`** :

   ```
   const OPENROUTER_EXPORT_ANCIEN = '<url signée>'
   const OPENROUTER_EXPORT_2026   = '<url signée>'
   ```

La page ramasse **toute** variable dont le nom commence par `OPENROUTER_EXPORT`,
par ordre alphabétique. Ajouter une année ou un ancien compte = **une ligne** de
plus dans n8n, sans toucher au code.

> **Durée de vie des jetons.** Toujours passer par `Sign URLs` (12 h, régénéré
> à chaque authentification). Un export signé « à la main » pour un an expirerait
> **en silence** : la page afficherait simplement une dépense d'inférence plus
> faible, sans erreur visible.

> **`update_workflow` n'écrit qu'un BROUILLON.** Sur cette instance, `versionId`
> (brouillon) et `activeVersionId` (production) sont distincts : sans
> `publish_workflow`, les webhooks continuent de servir l'ancienne version, sans
> aucun signal. Après toute modification, vérifier que `versionId ===
> activeVersionId`.

Le format est reniflé, pas déduit du nom : un export CSV rangé par erreur sous
`OPENROUTER_USAGE_URL` (la variable des relevés JSON du job) est lu quand même.
Mieux vaut lire un fichier mal rangé que d'afficher une page vide.

**Plusieurs exports coexistent, et c'est le cas normal.** Une migration de
compte OpenRouter laisse deux exports disjoints, chacun avec son propre compteur
cumulé. Chaque import reçoit donc sa **propre clé** (`import:csv1`, `import:csv2`,
…) et le moteur traite les séries indépendamment : jamais de faux delta au moment
de la bascule d'un compte à l'autre. Les imports sont listés un par un dans la
page, chacun retirable séparément.

Le **réimport du même fichier** est refusé (même plage *et* même total) : c'est
le seul chevauchement qui serait à coup sûr un double comptage. Deux exports qui
se recouvrent réellement sont, eux, additionnés — deux comptes actifs en même
temps ont bien dépensé les deux — mais le bandeau le signale explicitement.

L'historique importé vit dans `localStorage['kpi_openrouter_historique']` — donc
**local à ce navigateur**, comme le registre. Pour le partager, deux options :
convertir le CSV en `openrouter_usage.json` et le déposer dans le bucket (la
page le lira par `OPENROUTER_USAGE_URL`), ou réimporter le CSV sur chaque poste.

**Recouvrement avec le job** : `parseOpenRouterCsv` accepte `{ dateMin, dateMax }`
(bornes incluses). Quand le job tourne, borner l'import à la veille de son
démarrage — sinon la période commune serait comptée deux fois. Aucun garde-fou
automatique ne le fait pour ce cas-là : les deux sources s'additionnent par
construction.

> Les données de dépense ne partent **jamais** vers GitHub : `openrouter_usage.json`
> et `*usage*.csv` sont exclus de `.gitignore` **et** de `prepare-upload.ps1`
> (`robocopy /MIR` emporterait sinon tout fichier posé dans le dossier, et la
> cible du déploiement est un repo **public**).

#### Câblage n8n à réaliser (hors repo)

1. **Cron quotidien** → `GET https://openrouter.ai/api/v1/keys`, en-tête
   `Authorization: Bearer <Management key>` stockée en **credential n8n**.
2. Pour chaque clé, produire `{ ts, keyName, usageCumule }` à partir de
   `name` et `usage`.
3. **Lire** `openrouter_usage.json` du bucket, **concaténer** les nouveaux
   relevés, **réécrire**. Ne jamais écraser : le fichier est l'historique.
4. Ajouter le path au nœud `Sign URLs` et le mapping
   `OPENROUTER_USAGE_URL` au nœud `Build signed response` du webhook
   `passwordROI`. La règle de tolérance existante s'applique : un fichier non
   signé donne une page sans inférence, pas un webhook cassé.

À faire au plus tôt — mais le passé n'est plus en jeu : l'export CSV le rattrape.

L'export du compte actuel démarre au **14/04/2026** (0,31 $ ce jour-là, une
journée d'amorçage) bien qu'il ait été demandé depuis le 23/08/2025 : ce n'est
pas une limite de rétention, c'est une **migration de compte**. La dépense
antérieure vit dans l'export de l'ancien compte, à importer en second — d'où le
support de plusieurs exports.

Ce qui reste en jeu sans le job, c'est la **fraîcheur** : l'historique importé
est figé à la date de l'export, et il faut réexporter à la main pour l'actualiser.

#### Schéma du registre

```js
// localStorage['kpi_couts_ia']
{ id, mois: '2026-08',
  categorie: 'inference' | 'infra' | 'licence' | 'ocr' | 'autre',
  fournisseur, libelle,
  montant,                  // strictement positif
  devise: 'EUR' | 'USD',
  nature: 'fixe' | 'variable' }

// localStorage['kpi_params_macro']
{ masseSalarialeAnnuelle, budgetAnnuelIA, tauxUsdEur,
  effectifOverride,         // null = effectif de population_cible.csv
  caGroupe, heuresAnnuelles }
```

**Limite assumée** : cette saisie est locale au navigateur. Elle n'est ni
partagée entre utilisateurs ni sauvegardée côté serveur, et un vidage de cache
l'efface. D'où l'export/import JSON, qui sert aussi de chemin de migration vers
un `couts_externes.csv` du bucket (pattern `population_cible.csv`) le jour où la
saisie doit devenir collective.

#### Instantané des gains

Le ratio de levier et le coût par heure gagnée ont besoin des heures gagnées et
des utilisateurs actifs. Plutôt que de recharger les 15 sources, `app.js` publie
en fin de `loadData()` un instantané compact (`publishGainsSnapshot`) dans
**`sessionStorage['kpi_snapshot_gains']`** :

```js
{ generatedAt, effectif,
  byMonth: { '2026-08': { hours, users } },   // users = uniques du mois
  totalUsersAllTime }
```

Il est toujours calculé **sans filtre** (date, filiale, direction, agence sont
neutralisés puis restaurés), pour que la page macro reçoive le périmètre groupe.

`sessionStorage` et non `localStorage` : effacé à la fermeture de l'onglet, donc
aucune donnée d'usage ne persiste sur le disque. **Corollaire : le lien de
l'en-tête navigue dans le même onglet** (pas de `target="_blank"`, un nouvel
onglet ne partagerait pas le `sessionStorage`). Instantané absent ⇒ ces deux
KPIs affichent « — », le reste de la page fonctionne.

#### Une dépense à zéro n'est pas « gratuit »

Quand aucun coût n'est relevé sur la période, tous les ratios dérivés affichent
« — » et non « 0 € ». Un « 0 € par heure gagnée » se lirait comme une conclusion
(l'IA ne coûte rien) alors que l'information réelle est une absence de donnée.
Même logique pour le bandeau de complétude, qui énonce en permanence ce que la
période couvre réellement et ce qui manque.

### Tests

```bash
node --test tests/utils.test.js
```

```bash
node --test tests/costs.test.js
```

Aucune dépendance requise (Node >= 18). À lancer avant tout commit touchant
`shared/utils.js` ou `shared/costs.js`. `prepare-upload.ps1` bloque déjà le
packaging si les tests échouent.

### Git

Les secrets (`cred sf.txt`, `.env`) et les données de test (`sample_ao_data.json`)
sont exclus via `.gitignore` et ne doivent JAMAIS être committés.

## Notes

- L'application fonctionne entièrement côté client
- Les données sont récupérées depuis Supabase via l'API publique
- Aucune installation de dépendances n'est requise
- Compatible avec tous les navigateurs modernes
