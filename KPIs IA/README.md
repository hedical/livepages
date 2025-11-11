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
- `README.md` : Documentation du projet

## Notes

- L'application fonctionne entièrement côté client
- Les données sont récupérées depuis Supabase via l'API publique
- Aucune installation de dépendances n'est requise
- Compatible avec tous les navigateurs modernes
