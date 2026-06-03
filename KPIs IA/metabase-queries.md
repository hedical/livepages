# Sauvegarde des requêtes SQL Metabase — KPIs IA

> **Pourquoi ce fichier ?**
> Backup des 5 cards SQL natives créées dans la collection **KPI IA** (id `17`) sur l'instance `https://metabase.btp-force.cloud`. À utiliser si une card est supprimée, archivée par erreur, ou si la connexion entre n8n et Metabase casse.
>
> Toutes les requêtes ciblent la database **S+** (id `2`, PostgreSQL).

---

## Table des matières

1. [Cards créées](#cards-créées)
2. [Notes de schéma BTP S+](#notes-de-schéma-btp-s)
3. [Card 134 — Descriptif Sommaire (full)](#card-134--descriptif-sommaire-full)
4. [Card 135 — Autocontact](#card-135--autocontact)
5. [Card 136 — Population Cible (agrégée)](#card-136--population-cible-agrégée)
6. [Card 137 — Comparateur Indices](#card-137--comparateur-indices)
7. [Card 138 — Descriptif Sommaire LEAN](#card-138--descriptif-sommaire-lean)
8. [Requêtes diagnostiques](#requêtes-diagnostiques)
9. [Recréer une card via l'API Metabase](#recréer-une-card-via-lapi-metabase)

---

## Cards créées

| Card | Nom complet | Volume typique | Consommée par |
|---|---|---|---|
| **134** | KPIs IA - Descriptif Sommaire (SQL) | ~10 700 lignes, ~100 MB | `explorer-descriptifs.html` (HTML complet pour analyse similarité IA vs original) |
| **135** | KPIs IA - Autocontact (SQL) | ~70 000 lignes, ~12 MB | dashboards index + `autocontact.html` |
| **136** | KPIs IA - Population Cible (SQL) | ~47 lignes (1 / agence), <1 KB | dashboards (remplace l'ancien CSV statique `population_cible.csv`) |
| **137** | KPIs IA - Comparateur Indices (SQL) | ~214 lignes, <1 MB | dashboards index + `comparateur.html` |
| **138** | KPIs IA - Descriptif Sommaire LEAN (SQL) | ~10 700 lignes, ~5.5 MB | dashboards index + `descriptif.html` (sans le HTML brut, juste les comptes de mots et flag IA) |
| **139** | KPIs IA - Analyse Géotechnique (SQL) | ~24 lignes, <50 KB | dashboards index + `analyse-geotechnique.html` (brique qualité — pas de gain heures/€) |
| **n/a — Salesforce REST** | API XPL Funnel | ~5 000 marchés / ~250 leads, ~800 KB | dashboards index + `analyse-ao.html` (funnel IA AO — n'utilise PAS Metabase, voir section dédiée) |

> ⚠️ **134 vs 138** : 134 garde le HTML brut des descriptions (utile pour comparer texte source vs sortie IA), 138 strip le HTML et précalcule `descriptionWordCount` + `hasAi`. Pour les dashboards qui ne font que compter, prends **138** (20× plus léger).

---

## Notes de schéma BTP S+

> Comprises pendant le diagnostic — précieux pour debug futur.

### Tables centrales

| Table | Rôle | Colonnes clés |
|---|---|---|
| `Report` | Rapports émis (RICT, RFCT, FED, FDV, FRPB, RVRAT, RAH, FRA) | `id`, `reportType`, `subAffairId`, `name`, `diffusedAt`, `analyticalCenter`, `productionService`, `createdById` (FK User), `rictDetailId` |
| `SubAffair` | Tranche d'une affaire | `id`, `userId` (FK User), `subAffairDetailId` (FK SubAffairDetail) |
| `SubAffairDetail` | Détails métier d'une SubAffair (contrat, description) | `id`, `contractNumber`, `descriptionOfConcernedBuilding`, ~50 autres colonnes métier |
| `AIDeliverable` | Sortie d'un job IA | `id`, `type` (USER-DEFINED enum), `longResult` (jsonb), `aiProjectId` |
| `AIProject` | Projet IA (lié à une SubAffair) | `id`, `subAffairId`, `name` |
| `Contact` | Contacts liés à une affaire | `id`, `email`, `subAffairId`, `companyId`, `fromAI` (bool), `firstName`, `lastName`, `phone`, `role`, `position` |
| `User` | Comptes utilisateur BTP S+ | `id`, `email`, `firstname`, `lastname`, `isEnabled`, `position`, `matricule` |
| `AgencyToUser` | Table d'association User × Agence | `userId`, `agencyId`, `isMain` |
| `Agency` | Agences | `id`, `name`, `productionService`, `analyticalCenter`, `management`, `parentId` |

### Relations clés (FK explicites)

```
Report.subAffairId      → SubAffair.id
Report.createdById      → User.id
Report.diffusedById     → User.id

SubAffair.userId             → User.id
SubAffair.subAffairDetailId  → SubAffairDetail.id

AIDeliverable.aiProjectId → AIProject.id
AIProject.subAffairId     → SubAffair.id

Contact.subAffairId → SubAffair.id
Contact.companyId   → Company.id

AgencyToUser.userId   → User.id
AgencyToUser.agencyId → Agency.id
```

### Pièges à connaître

- **Pas de FK directe `AIDeliverable → Report`** : la jointure passe par `AIDeliverable.aiProjectId → AIProject.subAffairId = Report.subAffairId`. Comme une SubAffair peut avoir plusieurs Reports ET plusieurs AIDeliverables, **utiliser `LEFT JOIN LATERAL ... LIMIT 1`** pour éviter le produit cartésien.
- **`Report.analyticalCenter` et `Report.productionService` sont des colonnes TEXT** (pas des FK vers Agency). La jointure vers `Agency` se fait par **égalité de productionService**.
- **`Agency` n'a pas de relation directe vers User** : User ↔ Agency passe par `AgencyToUser` (m:n) avec un flag `isMain` pour l'agence principale.
- **Le `descriptionOfC_83730214` de l'ancien export Metabase** correspond en réalité à `SubAffairDetail.descriptionOfConcernedBuilding`. Le suffixe `_83730214` est juste un ID interne Metabase.
- **`type` est un enum USER-DEFINED** côté Postgres : toujours caster en `::text` pour les comparaisons string.

### Types d'AIDeliverable observés (en mai 2026)

| `type` | Count cumulé | Card associée |
|---|---|---|
| `DESCRIPTIF_SOMMAIRE_DES_TRAVAUX` | 3 135 | 134, 138 |
| `AUTOCONTACT` | 1 253 | 135 |
| `COMPARATEUR_INDICES` | 238 | 137 |
| `ETUDE_GEOTECHNIQUE` | 82 | (la brique géotech consomme `AnalyticEvent` cf. card 139, pas `AIDeliverable` directement) |

### Types de Report observés (en mai 2026, depuis 2025-01-01)

| `reportType` | Count | Utilisation dans dashboards |
|---|---|---|
| `FED` | 48 421 | — |
| `FDV` | 29 058 | — |
| `RICT` | 10 754 | **Card 134 / 138** (descriptif filtre sur RICT) |
| `RFCT` | 8 626 | — |
| `FRPB` | 7 684 | — |
| `RVRAT` | 1 569 | — |
| `RAH` | 1 389 | — |
| `FRA` | 172 | — |

---

## Card 134 — Descriptif Sommaire (full)

**URL :** `https://metabase.btp-force.cloud/question/134`
**Collection :** KPI IA (id 17)
**Format de sortie :** ~10 700 lignes, JSON ~100 MB (à cause des descriptions HTML)

### SQL

```sql
SELECT
    r."id"                                AS "id",
    sad."contractNumber"                  AS "SubAffairDetail - SubAffairDetailId__contractNumber",
    sad."descriptionOfConcernedBuilding"  AS "SubAffairDetail - SubAffairDetailId__descriptionOfC_83730214",
    aid."longResult"->>'description'      AS "AIDeliverable__longResult → description",
    aid."type"::text                      AS "AIDeliverable__type",
    r."diffusedAt"                        AS "Report__diffusedAt",
    r."reportType"::text                  AS "Report__reportType",
    r."name"                              AS "Report__name",
    u."email"                             AS "User - UserId__email",
    a."analyticalCenter"                  AS "Agency - AgencyId__analyticalCenter",
    a."productionService"                 AS "Agency - AgencyId__productionService",
    a."management"                        AS "Agency - AgencyId__management"
FROM "Report" r
LEFT JOIN "SubAffair" sa
    ON sa."id" = r."subAffairId"
LEFT JOIN "SubAffairDetail" sad
    ON sad."id" = sa."subAffairDetailId"
LEFT JOIN LATERAL (
    SELECT aid.*
    FROM "AIDeliverable" aid
    JOIN "AIProject" ap ON ap."id" = aid."aiProjectId"
    WHERE ap."subAffairId" = sa."id"
      AND aid."type"::text = 'DESCRIPTIF_SOMMAIRE_DES_TRAVAUX'
    ORDER BY aid."createdAt" DESC
    LIMIT 1
) aid ON true
LEFT JOIN "User" u
    ON u."id" = r."createdById"
LEFT JOIN "Agency" a
    ON a."productionService" = r."productionService"
WHERE r."diffusedAt" >= '2025-01-01'
  AND r."reportType"::text = 'RICT'
  AND (sad."contractNumber" IS NULL OR sad."contractNumber" NOT LIKE '%YIELD%')
ORDER BY r."diffusedAt" DESC
```

### Description (pour le formulaire Metabase)

> Reconstruit le dataset Descriptif consommé par le dashboard KPIs IA. Base = Report (RICT diffusés depuis 2025-01-01), LEFT JOIN LATERAL vers AIDeliverable de type DESCRIPTIF_SOMMAIRE_DES_TRAVAUX via AIProject. Affaires YIELD exclues.

### Volume attendu

- ~10 722 lignes (RICT diffusés depuis 2025-01-01, hors YIELD)
- 0 duplication (grâce au `LATERAL LIMIT 1`)
- ~12-15% des rows ont `AIDeliverable__type` non-null (= les RICT où le descriptif IA a été utilisé)

---

## Card 135 — Autocontact

**URL :** `https://metabase.btp-force.cloud/question/135`
**Collection :** KPI IA (id 17)
**Format de sortie :** ~70 000 lignes, JSON ~10-15 MB

### SQL

```sql
SELECT
    sa."id"                          AS "ID",
    sad."contractNumber"             AS "SubAffairDetail - SubAffairDetailId → ContractNumber",
    sad."id"                         AS "SubAffairDetail - SubAffairDetailId → ID",
    u."email"                        AS "User - UserId → Email",
    c."fromAI"                       AS "Contact → FromAI",
    c."createdAt"                    AS "Contact → CreatedAt",
    c."email"                        AS "Contact → Email",
    c."role"                         AS "Contact → Role",
    c."firstName"                    AS "Contact → FirstName",
    c."lastName"                     AS "Contact → LastName",
    c."position"::text               AS "Contact → Position",
    c."phone"                        AS "Contact → Phone",
    a."management"                   AS "Agency - AgencyId → Management",
    a."productionService"            AS "Agency - AgencyId → ProductionService",
    co."name"                        AS "Company - CompanyId → Name",
    ap."id"                          AS "AIProject → ID",
    aid."type"::text                 AS "AIDeliverable → Type",
    aid."id"                         AS "AIDeliverable → ID"
FROM "SubAffair" sa
INNER JOIN "Contact" c
    ON c."subAffairId" = sa."id"
LEFT JOIN "SubAffairDetail" sad
    ON sad."id" = sa."subAffairDetailId"
LEFT JOIN "User" u
    ON u."id" = sa."userId"
LEFT JOIN "Company" co
    ON co."id" = c."companyId"
LEFT JOIN "AgencyToUser" atu
    ON atu."userId" = u."id" AND atu."isMain" = true
LEFT JOIN "Agency" a
    ON a."id" = atu."agencyId"
LEFT JOIN LATERAL (
    SELECT aid.*, ap.id AS ap_id
    FROM "AIDeliverable" aid
    JOIN "AIProject" ap ON ap."id" = aid."aiProjectId"
    WHERE ap."subAffairId" = sa."id"
      AND aid."type"::text = 'AUTOCONTACT'
    ORDER BY aid."createdAt" DESC
    LIMIT 1
) aid ON true
LEFT JOIN "AIProject" ap
    ON ap."id" = aid."aiProjectId"
WHERE c."createdAt" >= '2025-01-01'
  AND (sad."contractNumber" IS NULL OR sad."contractNumber" NOT LIKE '%YIELD%')
ORDER BY c."createdAt" DESC
```

### Description

> Reconstruit le dataset Autocontact consommé par le dashboard KPIs IA. Base = Contact via SubAffair depuis 2025-01-01, joins User/Company/Agency (via AgencyToUser isMain), LEFT JOIN LATERAL vers AIDeliverable de type AUTOCONTACT. Affaires YIELD exclues. **`fromAI` NON filtré côté SQL** — le dashboard filtre côté JS pour calculer le taux d'adoption (numérateur AI / dénominateur total).

### Volume attendu

- ~70 948 lignes (tous contacts depuis 2025-01-01, hors YIELD)
- ~13 200 lignes avec `fromAI = true` (≈ 18.5% des contacts générés par IA)

---

## Card 136 — Population Cible (agrégée)

**URL :** `https://metabase.btp-force.cloud/question/136`
**Collection :** KPI IA (id 17)
**Format de sortie :** ~47 lignes, <1 KB
**Format colonnes :** `DR`, `Agence`, `Effectif` — drop-in pour remplacer l'ancien CSV statique `population_cible.csv`

### SQL

```sql
SELECT
    a."management"          AS "DR",
    a."productionService"   AS "Agence",
    COUNT(DISTINCT u."id") FILTER (WHERE u."isEnabled" = true) AS "Effectif"
FROM "Agency" a
LEFT JOIN "AgencyToUser" atu
    ON atu."agencyId" = a."id" AND atu."isMain" = true
LEFT JOIN "User" u
    ON u."id" = atu."userId"
GROUP BY a."management", a."productionService"
HAVING COUNT(DISTINCT u."id") FILTER (WHERE u."isEnabled" = true) > 0
ORDER BY a."management", a."productionService"
```

### Description

> Population cible agrégée (drop-in replacement du CSV statique). 1 ligne par agence avec DR/Agence/Effectif. Effectif = nombre d'users actifs (`isEnabled=true`) dont c'est l'agence principale (`AgencyToUser.isMain=true`).

### Volume attendu

- 47 agences avec ≥1 user actif principal
- Total effectif : ~345 users actifs (cf. ancien hardcoded 192 — périmètre élargi)

---

## Card 137 — Comparateur Indices

**URL :** `https://metabase.btp-force.cloud/question/137`
**Collection :** KPI IA (id 17)
**Format de sortie :** ~214 lignes, <1 MB

### SQL

```sql
SELECT
    aid."id"                                       AS "ID",
    sad."contractNumber"                           AS "ContractNumber",
    ap."id"                                        AS "AIProject → ID",
    aid."longResult"#>'{indexComparator,items}'    AS "LongResult → IndexComparator → Items",
    aid."longResult"                                AS "AIDeliverable → LongResult",
    aid."createdAt"                                AS "AIDeliverable → CreatedAt",
    aid."id"                                       AS "AIDeliverable → ID",
    u."email"                                      AS "User - UserId → Email",
    a."productionService"                          AS "Agency - AgencyId → ProductionService",
    a."management"                                 AS "Agency - AgencyId → Management"
FROM "AIDeliverable" aid
LEFT JOIN "AIProject" ap
    ON ap."id" = aid."aiProjectId"
LEFT JOIN "SubAffair" sa
    ON sa."id" = ap."subAffairId"
LEFT JOIN "SubAffairDetail" sad
    ON sad."id" = sa."subAffairDetailId"
LEFT JOIN "User" u
    ON u."id" = sa."userId"
LEFT JOIN "AgencyToUser" atu
    ON atu."userId" = u."id" AND atu."isMain" = true
LEFT JOIN "Agency" a
    ON a."id" = atu."agencyId"
WHERE aid."type"::text = 'COMPARATEUR_INDICES'
  AND aid."createdAt" >= '2025-01-01'
  AND (sad."contractNumber" IS NULL OR sad."contractNumber" NOT LIKE '%YIELD%')
ORDER BY aid."createdAt" DESC
```

### Description

> Reconstruit le dataset Comparateur d'Indices. Base = AIDeliverable filtré type=COMPARATEUR_INDICES depuis 2025-01-01. Chaîne AIDeliverable → AIProject → SubAffair → SubAffairDetail (contractNumber), SubAffair → User → AgencyToUser(isMain) → Agency. JSON `longResult.indexComparator.items` extrait pour comptage de pages.

### Volume attendu

- ~214 lignes (COMPARATEUR_INDICES depuis 2025-01-01, hors YIELD)
- L'opérateur `#>` extrait directement le tableau `items` du jsonb (sans avoir à le parser côté client).

---

## Card 138 — Descriptif Sommaire LEAN

**URL :** `https://metabase.btp-force.cloud/question/138`
**Collection :** KPI IA (id 17)
**Format de sortie :** ~10 700 lignes, **~5.5 MB** (au lieu de 100 MB pour la card 134)

> **À utiliser pour les dashboards** quand n8n est limité en mémoire. Les comptes de mots et le flag IA sont précalculés en SQL, donc le frontend skip le parsing HTML coûteux.

### SQL

```sql
SELECT
    r."id"                                            AS "id",
    sad."contractNumber"                              AS "SubAffairDetail - SubAffairDetailId__contractNumber",
    r."diffusedAt"                                    AS "Report__diffusedAt",
    r."reportType"::text                              AS "Report__reportType",
    r."name"                                          AS "Report__name",
    u."email"                                         AS "User - UserId__email",
    a."analyticalCenter"                              AS "Agency - AgencyId__analyticalCenter",
    a."productionService"                             AS "Agency - AgencyId__productionService",
    a."management"                                    AS "Agency - AgencyId__management",
    aid."type"::text                                  AS "AIDeliverable__type",
    (aid."type" IS NOT NULL)                          AS "hasAi",
    COALESCE(ARRAY_LENGTH(
        REGEXP_SPLIT_TO_ARRAY(
            TRIM(REGEXP_REPLACE(
                REGEXP_REPLACE(COALESCE(sad."descriptionOfConcernedBuilding", ''), '<[^>]+>', ' ', 'g'),
                '[^a-zA-ZÀ-ÿ]+', ' ', 'g'
            )),
            '\s+'
        ),
        1
    ), 0)                                              AS "descriptionWordCount",
    COALESCE(ARRAY_LENGTH(
        REGEXP_SPLIT_TO_ARRAY(
            TRIM(REGEXP_REPLACE(
                REGEXP_REPLACE(COALESCE(aid."longResult"->>'description', ''), '<[^>]+>', ' ', 'g'),
                '[^a-zA-ZÀ-ÿ]+', ' ', 'g'
            )),
            '\s+'
        ),
        1
    ), 0)                                              AS "aiResultWordCount"
FROM "Report" r
LEFT JOIN "SubAffair" sa
    ON sa."id" = r."subAffairId"
LEFT JOIN "SubAffairDetail" sad
    ON sad."id" = sa."subAffairDetailId"
LEFT JOIN LATERAL (
    SELECT aid.*
    FROM "AIDeliverable" aid
    JOIN "AIProject" ap ON ap."id" = aid."aiProjectId"
    WHERE ap."subAffairId" = sa."id"
      AND aid."type"::text = 'DESCRIPTIF_SOMMAIRE_DES_TRAVAUX'
    ORDER BY aid."createdAt" DESC
    LIMIT 1
) aid ON true
LEFT JOIN "User" u
    ON u."id" = r."createdById"
LEFT JOIN "Agency" a
    ON a."productionService" = r."productionService"
WHERE r."diffusedAt" >= '2025-01-01'
  AND r."reportType"::text = 'RICT'
  AND (sad."contractNumber" IS NULL OR sad."contractNumber" NOT LIKE '%YIELD%')
ORDER BY r."diffusedAt" DESC
```

### Description

> Version lean (sans HTML) du Descriptif Sommaire. WordCount précalculé en SQL. ~5.5 MB vs ~100 MB pour card 134. Idem que 134 pour les meta, mais remplace `descriptionOfConcernedBuilding` et `longResult.description` par leur word count + un flag `hasAi`.

### Explication du word count

```
COALESCE(ARRAY_LENGTH(
    REGEXP_SPLIT_TO_ARRAY(
        TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(COALESCE(text, ''), '<[^>]+>', ' ', 'g'),  -- strip HTML
            '[^a-zA-ZÀ-ÿ]+', ' ', 'g'                                  -- only keep letters
        )),
        '\s+'                                                          -- split on whitespace
    ),
    1
), 0)                                                                  -- 0 if null
```

Équivalent au JS `countWords(extractText(html))` mais ~50× plus rapide car appliqué une seule fois en base au lieu de 10 000× côté client.

---

## Card 139 — Analyse Géotechnique

**URL :** `https://metabase.btp-force.cloud/question/139`
**Collection :** KPI IA (id 17)
**Format de sortie :** ~24 lignes, <50 KB
**Source :** Table `AnalyticEvent` (id 74) — pas `AIDeliverable`. Cette brique journalise des events frontend, pas des livrables IA.

### Schéma de la table source

`AnalyticEvent` est un event log JSON. Colonnes utiles :

- `name` : type d'event (ex: `Create Notice From AI Geotech`, `Create Report From AI Geotech`)
- `date` : timestamp de l'event
- `properties` (jsonb) : contient `deliverable.{id, documentId, longResult}`, `report.{id, name}`, `notices[]`, `subAffair.{contractNumber, userId}`
- `context` (jsonb) : contient `user.{email, firstname, lastname, position, role, isEnabled, featureGroup}`, `mainAgency.{management, productionService}`

### ⚠️ Duplication structurelle à connaître

**1 opération IA géotech ⇒ 2 events** émis dans la même transaction (~30-50 ms d'écart), partageant le même `properties.deliverable.id` :

- `Create Notice From AI Geotech` : porte `properties.notices[]` (array de notices générées, normalement 1 par event)
- `Create Report From AI Geotech` : porte `properties.report.{id, name}` (le rapport créé qui inclut la notice)

**Conséquence :** côté frontend, déduper par `DeliverableId` pour obtenir le vrai nombre d'opérations. La card 139 ne déduplique PAS en SQL pour préserver la visibilité Notice vs Report.

### SQL

```sql
SELECT
    "id"                                                                AS "EventId",
    "name"                                                              AS "EventName",
    "date"                                                              AS "EventDate",
    "properties"->'deliverable'->>'id'                                  AS "DeliverableId",
    "properties"->'deliverable'->>'documentId'                          AS "DocumentId",
    "properties"->'report'->>'id'                                       AS "ReportId",
    "properties"->'report'->>'name'                                     AS "ReportName",
    jsonb_array_length(COALESCE("properties"->'notices', '[]'::jsonb))  AS "NoticesCount",
    "properties"->'notices'->0->>'id'                                   AS "FirstNoticeId",
    "properties"->'notices'->0->>'number'                               AS "FirstNoticeNumber",
    "properties"->'subAffair'->>'contractNumber'                        AS "ContractNumber",
    "properties"->'subAffair'->>'userId'                                AS "SubAffairUserId",
    "context"->'user'->>'email'                                         AS "UserEmail",
    "context"->'user'->>'firstname'                                     AS "UserFirstname",
    "context"->'user'->>'lastname'                                      AS "UserLastname",
    "context"->'user'->>'position'                                      AS "UserPosition",
    "context"->'user'->>'role'                                          AS "UserRole",
    ("context"->'user'->>'isEnabled')::boolean                          AS "UserIsEnabled",
    "context"->'mainAgency'->>'management'                              AS "DR",
    "context"->'mainAgency'->>'productionService'                       AS "Agence"
FROM "AnalyticEvent"
WHERE "name" ILIKE '%geotech%'
  AND (
    "properties"->'subAffair'->>'contractNumber' IS NULL
    OR "properties"->'subAffair'->>'contractNumber' NOT ILIKE '%YIELD%'
  )
ORDER BY "date" DESC
```

### Description

> Reconstruit le dataset Analyse Géotechnique consommé par le dashboard KPIs IA. Source = `AnalyticEvent` filtrée sur `name ILIKE '%geotech%'` (Notice + Report). Exclut les contrats YIELD-STUDIO. Pas de `longResult` ni de `notices[].comment` pour rester léger. La déduplication par `DeliverableId` (1 opération = 1 Notice + 1 Report) est faite côté frontend.

### Volume attendu (mai 2026)

- ~24 lignes (12 Notice + 12 Report après exclusion YIELD)
- 12 opérations IA distinctes (= DeliverableId distincts)
- ~10 utilisateurs uniques

### Câblage n8n / Supabase

Pour que `analyse-geotechnique.html` consomme les données, la réponse du webhook `passwordROI` doit exposer la variable `GEOTECH_URL` :

```
GEOTECH_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/analyse_geotechnique.json'
```

Le workflow n8n doit fetch `/api/card/139/query/json` (binary streaming), puis upload sur Supabase Storage à cette URL. Sans ce câblage, la tuile dashboard affiche 0 et la page détail affiche un message d'erreur clair.

---

## Brique Analyse AO — pas de Metabase, source = API Salesforce REST

> ⚠️ Cette brique est différente des autres : elle ne tape **pas** sur Metabase. Elle consomme directement l'endpoint Apex REST `XPLFunnelRestApi` exposé par Salesforce. Documentation complète : [API REST — XPL Funnel](https://app.notion.com/p/btp-consultants/API-REST-XPL-Funnel-373e3f197e2480098487cb4c1ec44db4).

### Endpoint et auth

- **URL prod** : `https://gbtp.my.salesforce.com/services/apexrest/xpl/funnel/`
- **Auth** : OAuth 2.0 Client Credentials (External Client App côté Salesforce)
- **Token endpoint** : `https://gbtp.my.salesforce.com/services/oauth2/token`
- **Paramètres recommandés** : `?limit=5000` (le funnel actuel tient en ~5 000 marchés sur les 3 derniers mois)

### Format de réponse

```json
{
  "count": 5000,
  "data": [
    {
      "marcheId": "a31bE000008Ag03QAC",
      "refMarche": "MP#45027788",
      "typeAvis": "Avis d'appel à concurrence",
      "dateDetection": "2026-06-01T00:00:00.000Z",
      "leads": [
        {
          "id": "00QbE...",
          "dateCreation": "2026-06-02T23:04:05.000Z",
          "ownerName": "Nigella GUILLAUME",
          "agence": "Direction Opérationnelle",
          "dateConvertedOpp": null,
          "opportunity": null
        }
      ]
    }
  ]
}
```

### KPIs calculés côté frontend

| KPI | Formule |
|---|---|
| **AO Captés** | `data.length` (tous les marchés détectés) |
| **AO Filtrés** | marchés où `leads.length > 0` (l'IA a créé au moins un lead) |
| **AO Analysés** | total des leads (`Σ leads.length`) |
| **AO Opportunité** | leads où `opportunity != null` |

### Câblage n8n / Supabase

Le frontend (`analyse-ao.html` + tuile dashboard) attend une URL `ANALYSE_AO_URL` exposée par le webhook `passwordROI`, pointant vers un fichier JSON sur Supabase Storage :

```
ANALYSE_AO_URL = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/analyse_ao.json'
```

**Workflow n8n à créer (déclenchement manuel pour l'instant) :**

```
[Manual Trigger]
       │
       ▼
[HTTP Request : Get SF Token]
   POST  https://gbtp.my.salesforce.com/services/oauth2/token
   Body (form-urlencoded) :
     grant_type    = client_credentials
     client_id     = {{ $credentials.salesforceXpl.clientId }}
     client_secret = {{ $credentials.salesforceXpl.clientSecret }}
   → renvoie { access_token, instance_url, ... }
       │
       ▼
[HTTP Request : Get Funnel]
   GET  https://gbtp.my.salesforce.com/services/apexrest/xpl/funnel/?limit=5000
   Headers :
     Authorization = Bearer {{ $json.access_token }}
   Response Format : JSON
       │
       ▼
[Supabase : Upload]
   Bucket   : DataFromMetabase
   Path     : analyse_ao.json
   Content  : {{ JSON.stringify($json) }}
   MIME     : application/json
   Upsert   : true (overwrite à chaque run)
```

**Credentials n8n à créer** (recommandé : credential dédiée pour réutilisation future) :
- **Type** : *Custom Auth* ou simplement deux variables exposées dans une *Generic Credential*
- **Nom** : `SF XPL Client Credentials`
- **Champs** :
  - `SF_CLIENT_ID` = Consumer Key de l'External Client App (`gbtp.my.salesforce.com`)
  - `SF_CLIENT_SECRET` = Consumer Secret
  - `SF_INSTANCE_URL` = `https://gbtp.my.salesforce.com`
- **Référencement** : `{{ $credentials.sfXplClientCreds.SF_CLIENT_ID }}` dans le node Token

> 💡 Le token a une durée de vie limitée (typiquement 2 h). Comme le workflow est en déclenchement manuel et qu'il fait token + funnel en chaîne, pas besoin de caching — le token est généré à chaque run.

**Mise à jour du webhook `passwordROI`** : ajouter une ligne dans la réponse :

```
DESCRIPTIF_URL  = 'https://...'
AUTOCONTACT_URL = 'https://...'
COMPARATEUR_URL = 'https://...'
NF_HABITAT_URL  = 'https://...'
GEOTECH_URL     = 'https://...'
ANALYSE_AO_URL          = 'https://qzgtxehqogkgsujclijk.supabase.co/storage/v1/object/public/DataFromMetabase/analyse_ao.json'   ← NEW
```

### Test sans n8n (mode fallback local)

Si `ANALYSE_AO_URL` n'est pas encore exposée dans le webhook, le frontend retombe automatiquement sur `sample_ao_data.json` à la racine du projet. Pour générer ce fichier sample en PowerShell :

```powershell
$body = @{
  grant_type    = 'client_credentials'
  client_id     = '<consumer_key>'
  client_secret = '<consumer_secret>'
}
$tok = Invoke-RestMethod -Uri "https://gbtp.my.salesforce.com/services/oauth2/token" -Method POST -Body $body
$headers = @{ "Authorization" = "Bearer $($tok.access_token)" }
$data = Invoke-RestMethod -Uri "https://gbtp.my.salesforce.com/services/apexrest/xpl/funnel/?limit=5000" -Method GET -Headers $headers
$data | ConvertTo-Json -Depth 10 -Compress | Out-File -FilePath "sample_ao_data.json" -Encoding utf8
```

> Ce fallback **n'est utilisé que tant que le webhook ne renvoie pas `ANALYSE_AO_URL`**. Une fois n8n câblé, le fallback n'est plus consulté.

### Volume attendu

- ~5 000 marchés captés sur les ~3 derniers mois (selon le scraper XPL)
- ~250 leads créés (taux de filtrage IA ~5%)
- 0-5 opportunités selon le mois (taux de conversion lead → opp encore très faible début 2026)

---

## Requêtes diagnostiques

### Lister les colonnes d'une table

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'AIDeliverable'
ORDER BY ordinal_position;
```

### Chercher une FK dans toute la base

```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE column_name ILIKE '%reportid%'  -- ou autre pattern
ORDER BY table_name, column_name;
```

### Compter les types d'AIDeliverable

```sql
SELECT type::text AS t, COUNT(*) AS n
FROM "AIDeliverable"
GROUP BY type
ORDER BY n DESC;
```

### Compter les types de Report depuis une date

```sql
SELECT "reportType"::text AS rt, COUNT(*) AS n
FROM "Report"
WHERE "diffusedAt" >= '2025-01-01'
GROUP BY "reportType"
ORDER BY n DESC;
```

### Vérifier la cardinalité Report ↔ AIDeliverable par SubAffair

```sql
WITH ai_per_subaffair AS (
    SELECT ap."subAffairId", COUNT(*) c
    FROM "AIDeliverable" aid
    JOIN "AIProject" ap ON ap.id = aid."aiProjectId"
    WHERE aid.type::text = 'DESCRIPTIF_SOMMAIRE_DES_TRAVAUX'
    GROUP BY ap."subAffairId"
)
SELECT c AS deliverables_per_subaffair, COUNT(*) AS nb_subaffairs
FROM ai_per_subaffair
GROUP BY c
ORDER BY c;
```

---

## Recréer une card via l'API Metabase

> Méthode utilisée pendant la session — utile si une card est supprimée et que tu veux la recréer rapidement par script.

### Pré-requis

Être connecté à Metabase dans un navigateur (cookie de session). Ouvrir la console F12 sur n'importe quelle page Metabase et exécuter :

```javascript
fetch('/api/card', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'KPIs IA - Descriptif Sommaire (SQL)',  // ← change selon la card
    description: 'Description ici…',
    collection_id: 17,                              // ← collection KPI IA
    dataset_query: {
      database: 2,                                  // ← S+ database
      type: 'native',
      native: {
        query: `SELECT ... ton SQL ici ...`,
        'template-tags': {}
      }
    },
    display: 'table',
    visualization_settings: {},
    type: 'question'
  })
})
.then(r => r.json())
.then(d => console.log('Created card', d.id));
```

### Modifier une card existante (PUT)

Même payload que ci-dessus mais `method: 'PUT'` et URL `'/api/card/<ID>'`.

### Tester l'output d'une card

```javascript
fetch('/api/card/138/query/json', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({})
})
.then(r => r.json())
.then(d => console.log('Rows:', d.length, 'First:', d[0]));
```

---

## Endpoints API pour n8n

Pour fetcher les datasets depuis n8n (binary streaming pour éviter l'OOM sur les gros fichiers) :

| Endpoint | Format | Usage |
|---|---|---|
| `POST /api/card/{id}/query/json` | JSON array | À utiliser dans n8n HTTP Request node avec **Response Format = File** (binaire) |
| `POST /api/card/{id}/query/csv` | CSV | Alternative si n8n préfère le CSV |
| `POST /api/card/{id}/query` | JSON Metabase brut | Inclut les métadonnées Metabase (verbeux, déconseillé) |

L'auth se fait via :
- Cookie de session Metabase (si même navigateur connecté)
- OU header `X-Metabase-Session: <session-token>` (à générer via `POST /api/session` avec login/password)
- OU header `X-API-Key: <api-key>` (à générer dans Metabase Admin → API keys)

### Exemple n8n HTTP Request node

```
Method:           POST
URL:              https://metabase.btp-force.cloud/api/card/138/query/json
Authentication:   Header → X-API-Key: <ta-clé>
Response Format:  File  ← CRUCIAL pour éviter l'OOM
Body:             {} (ou laisser vide)
```

Ensuite, le binary peut être uploadé tel quel sur Supabase Storage.

---

*Dernière mise à jour : 22 mai 2026*
