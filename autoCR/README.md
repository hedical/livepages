# Générateur de CR BTP Consultants — GitHub Pages

Application web statique qui génère tous les CR mensuels directement dans le navigateur (aucun serveur nécessaire).

---

## Déploiement sur GitHub Pages

### 1. Créer le dépôt GitHub

1. Aller sur [github.com](https://github.com) → **New repository**
2. Nom : `generateur-cr-btp` (ou ce que vous voulez)
3. Visibilité : **Private** (recommandé — données confidentielles)
4. Cliquer **Create repository**

### 2. Pousser les fichiers

Depuis le dossier `web/` de ce projet, ouvrir un terminal et exécuter :

```bash
cd "chemin\vers\Auto CR - Florian\web"
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/VOTRE_PSEUDO/generateur-cr-btp.git
git push -u origin main
```

### 3. Activer GitHub Pages

1. Dans le dépôt GitHub → onglet **Settings**
2. Menu gauche : **Pages**
3. Source : **Deploy from a branch**
4. Branch : `main` / `/ (root)`
5. Cliquer **Save**

Après 1-2 minutes, l'URL sera disponible :
`https://VOTRE_PSEUDO.github.io/generateur-cr-btp/`

---

## Utilisation mensuelle

1. Ouvrir l'URL GitHub Pages dans un navigateur
2. **Glisser-déposer** le fichier `.xlsx` de suivi
3. *(Optionnel)* Ajouter le logo `logo_btp_dark.png`
4. Sélectionner le **mois**
5. *(Optionnel)* Filtrer sur une DR
6. Cliquer **Générer les CR**
7. Attendre la fin (quelques secondes à ~1 min selon le nombre de CR)
8. Cliquer **Télécharger le ZIP**

---

## Structure des fichiers

```
web/
├── index.html          ← Page principale (UI + logique)
├── README.md           ← Ce fichier
└── js/
    ├── helpers.js          ← Fonctions de formatage
    ├── extract_data.js     ← Lecture du fichier Excel
    ├── build_prev_nplus1.js← Prévisionnels N+1
    ├── generate_cr.js      ← Génération des .docx Word
    └── generate_all.js     ← Orchestration + ZIP
```

---

## Notes techniques

- **Aucun serveur** : tout tourne dans le navigateur (JavaScript pur)
- **Librairies CDN** : xlsx, docx, jszip, file-saver (chargées automatiquement)
- **Confidentialité** : le fichier Excel ne quitte jamais votre machine
- **Compatibilité** : Chrome, Edge, Firefox (versions récentes)

---

## Mise à jour des fichiers

Pour mettre à jour le code après une modification :

```bash
git add .
git commit -m "Mise à jour"
git push
```

GitHub Pages se met à jour automatiquement en 1-2 minutes.
