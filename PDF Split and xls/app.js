// Configuration de PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Variables globales
let uploadedFile = null;
let csvData = [];
let parsedResults = [];
let pdfDoc = null;
let keepAliveInterval = null;

// Fonction pour empêcher la mise en veille de l'onglet
function startKeepAlive() {
    if (keepAliveInterval) return;
    
    // Créer un petit "ping" invisible qui empêche le navigateur de ralentir l'onglet
    keepAliveInterval = setInterval(() => {
        // Mise à jour invisible de l'interface pour garder l'onglet actif
        document.title = document.title;
    }, 100);
}

function stopKeepAlive() {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }
}

// Initialisation au chargement de la page
document.addEventListener('DOMContentLoaded', function() {
    loadCSVData();
    setupDragAndDrop();
    setupFileInput();
    
    // Avertir l'utilisateur si il change d'onglet pendant un traitement
    document.addEventListener('visibilitychange', function() {
        if (document.hidden && keepAliveInterval) {
            console.warn('⚠️ Onglet mis en arrière-plan pendant le traitement. Le processus continue...');
        }
    });
});

// Données CSV intégrées directement (évite les problèmes CORS)
const csvDataRaw = `Type,Code,Thème,Catégorie
vérification,SMR.8.1.1.1,Système de Management Responsable,Analyse de site
vérification,SMR.8.1.1.2,Système de Management Responsable,Diffusion de l'analyse de site
vérification,SMR.8.2.1.2,Système de Management Responsable,Définition du niveau de performance HQE
vérification,SMR.8.5.3.6,Système de Management Responsable,Chantier propre
identification,SMR.8.6.3.3,Système de Management Responsable,Responsable environnemental
vérification,SMR.8.6.3.6,Système de Management Responsable,Bilan environnemental de chantier
vérification,CHANTIER.1.1,Chantier à faibles nuisances,Programme spécifique
vérification,CHANTIER.1.2,Chantier à faibles nuisances,Travaux préalables à une démolition
vérification,CHANTIER.1.3,Chantier à faibles nuisances,Références des entreprises de démolition
vérification,CHANTIER.2.1,Chantier à faibles nuisances,Objectifs environnementaux du chantier
vérification,CHANTIER.3.1,Chantier à faibles nuisances,Communication du plan de gestion des déchets
vérification,CHANTIER.3.3,Chantier à faibles nuisances,Tri des déchets de chantier
vérification,CHANTIER.4.1,Chantier à faibles nuisances,Réduction des niveaux sonores
vérification,CHANTIER.5.1.1,Chantier à faibles nuisances,Diffusion de l'information aux riverains
vérification,CHANTIER.5.2.1,Chantier à faibles nuisances,Flux des engins
vérification,CHANTIER.5.3.1,Chantier à faibles nuisances,Exposition aux niveaux sonores
vérification,CHANTIER.5.3.2,Chantier à faibles nuisances,Organisation d'une réunion de sensibilisation
vérification,CHANTIER.5.4.1,Chantier à faibles nuisances,Limiter la gêne des riverains
vérification,CHANTIER.5.5.1,Chantier à faibles nuisances,Gestion du cantonnement
vérification,CHANTIER.5.6.1,Chantier à faibles nuisances,Maintien de la propreté du chantier
vérification,CHANTIER.5.7.1,Chantier à faibles nuisances,Fiches de Données de Sécurité (FDS)
vérification,CHANTIER.5.8.1,Chantier à faibles nuisances,Dispositif d'assainissement autonome
vérification,CHANTIER.5.9.1,Chantier à faibles nuisances,Protection de la faune et la flore
vérification,CHANTIER.5.10.1,Chantier à faibles nuisances,Sensibilisation des entreprises aux consommations d'eau et d'énergie
vérification,DG.1.1,Dispositions générales,Réglementation et Règles de l'Art
vérification,DG.2.1,Dispositions générales,Aptitude à l'emploi
vérification,DG.2.2,Dispositions générales,Revêtements de sol adaptés
vérification,DG.2.8,Dispositions générales,Durabilité du bois
vérification,DG.3.1,Dispositions générales,Missions contrôle technique
vérification,DG.5.1,Dispositions générales,Cas des extensions
vérification,DG.5.2,Dispositions générales,Extensions neuves ajoutées au bâtiment
vérification,DG.6.1,Dispositions générales,"Surélévations neuves, études préliminaires"
identification,DG.6.2,Dispositions générales,Dérogations possibles d'après l'Ordonnance Duflot
vérification,DG.6.3,Dispositions générales,Diagnostic structurel
vérification,DG.6.4,Dispositions générales,Plancher technique et passage des canalisations
vérification,DG.6.5,Dispositions générales,Surélévations neuves : local de stockage des déchets
vérification,SE.1.1.16,Sécurité et sûreté,Tous les garde-corps de l'opération conformes aux normes
vérification,SE.1.1.18,Sécurité et sûreté,Le dimensionnement des garde-corps
vérification,SE.1.2.1.1,Sécurité et sûreté,Signalétique de l'installation Photovoltaïque
vérification,SE.1.2.1.2,Sécurité et sûreté,Disjoncteur facilement accessible sur l'installation d'une revente totale
vérification,SE.1.2.1.3,Sécurité et sûreté,Disjoncteur facilement accessible sur l'installation d'une revente partielle
cohérence,SE.1.2.1.4,Sécurité et sûreté,Dispositif de sécurisation
vérification,SE.1.2.2.1,Sécurité et sûreté,Avis des services départementaux sur les bornes IRVE
vérification,SE.1.3.5,Sécurité et sûreté,Normes pour les modules photovoltaïques
vérification,SE.1.3.7,Sécurité et sûreté,Installation des bornes pour véhicule électrique
identification,SE.2.1.3,Sécurité et sûreté,Réduction des champs électromagnétiques
vérification,SE.2.2.5,Sécurité et sûreté,Détection de la toxicité
vérification,SE.3.2,Sécurité et sûreté,L'outil Sûreté
vérification,SE.3.20,Sécurité et sûreté,Sécurisation du parc de stationnement intérieur
vérification,QAI.1.1.4,Qualité de l'air intérieur,Pollution des sols
vérification,QAI.1.1.5,Qualité de l'air intérieur,Radon
vérification,QAI.1.1.9,Qualité de l'air intérieur,Hotte de cuisine
vérification,QAI.1.1.10,Qualité de l'air intérieur,Surventilation des logements
vérification,QAI.1.2.2,Qualité de l'air intérieur,Etiquetage sanitaire
vérification,QAI.1.2.5,Qualité de l'air intérieur,Label EMICODE
identification,QAI.1.2.6,Qualité de l'air intérieur,Label Ecolabel européen
vérification,QAI.1.2.9,Qualité de l'air intérieur,Labels CTB-B+/P+
vérification,QAI.1.2.19,Qualité de l'air intérieur,Emissions COV et formaldéhyde
vérification,QAI.1.2.20,Qualité de l'air intérieur,Appendice C Taxinomie
vérification,QAI.2.1.2,Qualité de l'air intérieur,Détalonnage des portes
vérification,QAI.2.1.7,Qualité de l'air intérieur,Exigences de ventilation de la rubrique PERF
vérification,QAI.2.4.11,Qualité de l'air intérieur,Calcul de dimensionnement par l'entreprise
identification,QAI.2.4.50,Qualité de l'air intérieur,Calcul de dimensionnement par un BET en collectif
vérification,QAI.2.4.23,Qualité de l'air intérieur,Création de conduits de ventilation
vérification,QAI.2.4.25,Qualité de l'air intérieur,Entretien et maintenance VMC
vérification,QAI.2.4.41,Qualité de l'air intérieur,Occultations extérieures des fenêtres
vérification,QAI.2.4.42,Qualité de l'air intérieur,Positionnement des entrées d'air
vérification,QAI.2.4.44,Qualité de l'air intérieur,Accessoires à joint
vérification,QAI.2.4.63,Qualité de l'air intérieur,Mesures de débit ou de pression / RE2020
vérification,QAI.2.4.45,Qualité de l'air intérieur,Mesure de perméabilité des réseaux
identification,QAI.2.4.46,Qualité de l'air intérieur,Filtres à air
vérification,QAI.2.4.48,Qualité de l'air intérieur,Isolation et efficacité
vérification,QAI.2.4.49,Qualité de l'air intérieur,Changement des filtres en fin de chantier
identification,QAI.2.6.2,Qualité de l'air intérieur,Fenêtre en salle d'eau
vérification,QAI.3.1.1,Qualité de l'air intérieur,Mesures de la qualité de l'air intérieur
vérification,QE.1.1.3,Qualité de l'eau,Clapet anti-retour en construction
cohérence,QE.1.2.1,Qualité de l'eau,Traitement physico-chimique
vérification,QE.1.3.1,Qualité de l'eau,Eau dure
vérification,QE.2.2,Qualité de l'eau,Maintien en température ECS
vérification,QE.3.1,Qualité de l'eau,Récupération et réutilisation des eaux pluviales
vérification,QE.4.1.1,Qualité de l'eau,Rinçage
vérification,QE.4.2.1,Qualité de l'eau,Analyse d'eau
vérification,QE.4.2.3,Qualité de l'eau,Complément analyse d'eau
vérification,QE.4.4.1,Qualité de l'eau,Légionelles
vérification,RES.1.1,Résilience vis-à-vis des risques,Information aux habitants et gestionnaires
vérification,RES.1.2,Résilience vis-à-vis des risques,Prise en charge des effets des aléas climatiques
vérification,RES.1.7,Résilience vis-à-vis des risques,Indicateurs de suivi
vérification,FL.1.1.1.1,Fonctionnalités des lieux,Vanne d'arrêt logement
vérification,FL.1.1.1.2,Fonctionnalités des lieux,Alimentation et évacuation pour machine à laver
vérification,FL.1.1.1.3,Fonctionnalités des lieux,Vanne d'arrêt pièces humides
vérification,FL.1.1.1.15,Fonctionnalités des lieux,Type de robinet
vérification,FL.1.1.2.1,Fonctionnalités des lieux,Occultations motorisées
vérification,FL.1.1.2.5,Fonctionnalités des lieux,Occultations automatisées
vérification,FL.1.3.2.1,Fonctionnalités des lieux,Interrupteur va et vient
vérification,FL.1.1.3.3,Fonctionnalités des lieux,Interrupteurs de type va-et-vient
vérification,FL.1.1.7.1,Fonctionnalités des lieux,Adaptabilité
vérification,FL.1.3.1.1,Fonctionnalités des lieux,Linéaire de mur libre
vérification,FL.1.3.1.2,Fonctionnalités des lieux,Surface chambre
vérification,FL.1.4.1.1,Fonctionnalités des lieux,Plan d'aménagement cuisine
vérification,FL.1.4.1.2,Fonctionnalités des lieux,Plan d'aménagement
vérification,FL.1.4.2.1,Fonctionnalités des lieux,Crédence au pourtour de l'évier
vérification,FL.1.4.2.2,Fonctionnalités des lieux,Crédence cuisine
identification,FL.1.4.4.1,Fonctionnalités des lieux,Surface tri des déchets
vérification,FL.1.4.4.4,Fonctionnalités des lieux,Equipements tri des déchets
vérification,FL.1.5.1.1,Fonctionnalités des lieux,WC et salle d'eau en T5
vérification,FL.3.6.1,Fonctionnalités des lieux,Barres d'appui
vérification,FL.1.5.1.2,Fonctionnalités des lieux,Equipements sanitaires supplémentaires
vérification,FL.1.5.1.10,Fonctionnalités des lieux,WC en T4
vérification,FL.1.5.1.18,Fonctionnalités des lieux,Lave-main
vérification,FL.1.5.2.1,Fonctionnalités des lieux,Portes salles d'eau et WC
vérification,FL.1.5.3.1,Fonctionnalités des lieux,Revêtement mural salle d'eau
vérification,FL.1.6.1.1,Fonctionnalités des lieux,Rangements
vérification,FL.6.1.1,Fonctionnalités des lieux,Chambre
vérification,FL.1.6.1.2,Fonctionnalités des lieux,Rangements supplémentaires
vérification,FL.1.6.3.1,Fonctionnalités des lieux,Espaces privatifs extérieurs
vérification,FL.2.2.1.5,Fonctionnalités des lieux,Sensibilisation santé bien être
vérification,FL.2.2.2.6,Fonctionnalités des lieux,Ascenseur
vérification,FL.2.2.2.7,Fonctionnalités des lieux,Position ascenseur
vérification,FL.2.2.2.11,Fonctionnalités des lieux,Incitation à emprunter les escaliers
vérification,FL.2.3.1,Fonctionnalités des lieux,Positionnement des trappes passe-paquet
vérification,FL.2.3.2,Fonctionnalités des lieux,Local stockage déchet
vérification,FL.2.3.4,Fonctionnalités des lieux,Local stockage déchet en sous-sol
vérification,FL.2.3.5,Fonctionnalités des lieux,Local stockage des déchets en extérieur
vérification,FL.2.3.6,Fonctionnalités des lieux,Abri-bacs
vérification,FL.2.3.7,Fonctionnalités des lieux,Local déchet mutualisé intérieur
vérification,FL.2.3.8,Fonctionnalités des lieux,Apport volontaire
identification,FL.2.3.10,Fonctionnalités des lieux,Eloignement des stockages de déchets extérieurs
vérification,FL.2.3.11,Fonctionnalités des lieux,Nombre de porte à franchir
vérification,FL.2.3.12,Fonctionnalités des lieux,Surdimensionnement
vérification,FL.2.3.13,Fonctionnalités des lieux,Compostage
vérification,FL.2.3.14,Fonctionnalités des lieux,Pénibilité des bacs
vérification,FL.2.3.16,Fonctionnalités des lieux,Abandon de la collecte par conteneurs
vérification,FL.2.3.18,Fonctionnalités des lieux,Local encombrants
vérification,FL.2.3.27,Fonctionnalités des lieux,Revêtements de sols et de murs
vérification,FL.2.3.30,Fonctionnalités des lieux,Dimensionnement du local de stockage des déchets
vérification,FL.2.3.34,Fonctionnalités des lieux,Planning de ramassage
vérification,FL.2.3.48,Fonctionnalités des lieux,Verouillage local Trappe passe-paquet
vérification,FL.2.3.51,Fonctionnalités des lieux,Collecte pneumatique des déchets
identification,FL.2.4.1,Fonctionnalités des lieux,Accessibilité PMR
vérification,FL.2.4.4,Fonctionnalités des lieux,Signalétique
cohérence,CH.1.18,Confort hygrothermique,Facteur solaire (RE2020)
vérification,CH.2.1,Confort hygrothermique,Degrés-heures (RE2020)
vérification,CH.2.2,Confort hygrothermique,Occultations extérieures
vérification,CH.2.1.1,Confort hygrothermique,Surventilation nocturne
vérification,CH.2.1.5,Confort hygrothermique,Puit provençal
vérification,CH.2.1.23,Confort hygrothermique,Brasseur d'air
vérification,CH.2.2.1,Confort hygrothermique,Espace ombragé
vérification,CH.2.4.12,Confort hygrothermique,Hauteur sous plafond des pièces principales
vérification,CH.3.4.17,Confort hygrothermique,Etude aéraulique
identification,CH.3.4.18,Confort hygrothermique,Logements traversants ou bi-orientés
vérification,CH.3.5.1,Confort hygrothermique,Espace de rafraichissement
vérification,CH.3.1,Confort hygrothermique,Feuillure de baie
identification,CH.4.1,Confort hygrothermique,Nombre moyen d'heures d'inconfort
vérification,CH.5.1,Confort hygrothermique,Plancher chauffant
vérification,CH.6.1.1,Confort hygrothermique,Végétalisation des linéaires de façades
identification,CH.6.2.1,Confort hygrothermique,Végétalisation façade
identification,CH.6.2.3,Confort hygrothermique,Végétalisation toiture
vérification,QA.1.2,Qualité Acoustique,Bruit aérien extérieur
vérification,QA.2.10,Qualité Acoustique,Bruit aérien entre logements en transmission verticale
vérification,QA.2.11,Qualité Acoustique,Bruit aérien entre logements en transmission horizontale
vérification,QA.2.12,Qualité Acoustique,Bruit aérien entre logements et circulations communes / 1 porte
vérification,QA.2.13,Qualité Acoustique,Bruit aérien entre logements et circulations communes / 2 portes
vérification,QA.2.14,Qualité Acoustique,Bruit aérien entre logements et circulations communes / 3 portes ou plus
vérification,QA.2.15,Qualité Acoustique,Bruit aérien entre garages et logements en transmission verticale
vérification,QA.2.16,Qualité Acoustique,Bruit aérien entre garages et logements en transmission horizontale
vérification,QA.2.17,Qualité Acoustique,Bruit aérien entre locaux d'activités et logements en transmission verticale
vérification,QA.2.18,Qualité Acoustique,Bruit aérien entre locaux d'activités et logements en transmission horizontale
vérification,QA.3.4,Qualité Acoustique,Escaliers bois
vérification,QA.3.12,Qualité Acoustique,Chape acoustique
vérification,QA.3.13,Qualité Acoustique,Bruit de choc des locaux intérieurs en transmission verticale
vérification,QA.3.14,Qualité Acoustique,Bruit de choc des locaux intérieurs en transmission horizontale
vérification,QA.3.15,Qualité Acoustique,Bruit de choc des terrasses en transmission verticale
vérification,QA.3.16,Qualité Acoustique,Bruit de choc des coursives en transmission horizontale
vérification,QA.3.17,Qualité Acoustique,Bruit de choc des dépendances et garages en transmission verticale
vérification,QA.3.18,Qualité Acoustique,Bruit de choc des dépendances et garages en transmission horizontale
vérification,QA.4.9,Qualité Acoustique,Bruit des chaudières individuelles
vérification,QA.4.10,Qualité Acoustique,Bruit des autres appareils individuels de chauffage et de climatisation
vérification,QA.4.11,Qualité Acoustique,Bruit des chaufferies collectives
vérification,QA.4.12,Qualité Acoustique,Bruit des ascenseurs
vérification,QA.4.13,Qualité Acoustique,Bruit des chutes d'eau
cohérence,QA.4.14,Qualité Acoustique,Bruit de la VMC simple flux
vérification,QA.4.15,Qualité Acoustique,Bruit de la VMC double flux
vérification,QA.4.16,Qualité Acoustique,Bruit des chauffe-eaux thermodynamiques
vérification,QA.4.17,Qualité Acoustique,Bruit des autres équipements individuels
vérification,QA.4.18,Qualité Acoustique,Bruit des autres équipements collectifs
vérification,QA.4.19,Qualité Acoustique,Bruits provenant de l'accès au garage
vérification,QA.4.20,Qualité Acoustique,Bruits du système de collecte pneumatique des déchets
vérification,QA.4.21,Qualité Acoustique,Bruits des modules extérieurs de pompes à chaleur
vérification,QA.5.10,Qualité Acoustique,Réverbération dans les circulations communes
vérification,QA.5.11,Qualité Acoustique,Réverbération des halls
cohérence,QA.5.12,Qualité Acoustique,Réverbération des escaliers encloisonnés
vérification,QA.5.13,Qualité Acoustique,Réverbération dans les garages collectifs ouverts
vérification,QA.6.1,Qualité Acoustique,Cloisons intérieures
vérification,QA.6.2,Qualité Acoustique,Détalonnage des portes intérieures
vérification,QA.6.3,Qualité Acoustique,Sonorité à la marche
vérification,QA.6.4,Qualité Acoustique,Aire absorption équivalente intérieure
vérification,QA.6.5,Qualité Acoustique,"Chapes, plafonds, doublages non filants"
vérification,QA.6.8,Qualité Acoustique,Deux portes entre séjour et chambres
vérification,QA.6.9,Qualité Acoustique,Deux portes entre séjour et WC
vérification,QA.6.12,Qualité Acoustique,Logement en coliving
calcul,QA.7.1,Qualité Acoustique,QAB
vérification,QA.7.4,Qualité Acoustique,QES
vérification,QA.9.1,Qualité Acoustique,Prise en compte des règles spécifiques à la certification
vérification,QA.9.2,Qualité Acoustique,Attestations acoustiques à fournir
vérification,QA.9.3,Qualité Acoustique,Attestations acoustiques complémentaires
vérification,QA.9.4,Qualité Acoustique,Règle à appliquer pour les mesures acoustiques
vérification,QA.9.5,Qualité Acoustique,Traitement des non-conformités
vérification,QA.9.6,Qualité Acoustique,Mesures en fin de chantier
vérification,CV.1.1.1.1,Confort visuel,Indice d'ouverture en collectif
vérification,CV.1.1.1.2,Confort visuel,Facteur de lumière de jour
vérification,CV.1.1.1.3,Confort visuel,Surface totale des baies
vérification,CV.1.1.1.4,Confort visuel,Eclairage naturel en salle d'eau
vérification,CV.1.1.1.6,Confort visuel,Eclairage naturel pièces annexes
vérification,CV.1.1.2.1,Confort visuel,Risque d'éblouissement
vérification,CV.1.2.1.1,Confort visuel,Eclairage naturel circulations communes
vérification,CV.1.2.1.8,Confort visuel,Zone avec boîtes aux lettres
vérification,CV.1.2.1.9,Confort visuel,Attractivité des circulations communes
vérification,CV.2.1.2,Confort visuel,Point d'éclairage
vérification,CV.2.2.1,Confort visuel,Indice de rendu de couleurs
vérification,CV.2.2.2,Confort visuel,Facteur de réflexion
identification,ST.1.1,Services et Transports,Etat des lieux des services
vérification,ST.1.2,Services et Transports,Proximité des services à l'opération
vérification,ST.1.4,Services et Transports,Information collecte déchets
vérification,ST.2.1,Services et Transports,Proximité des transports à l'opération
vérification,ST.2.2,Services et Transports,Etat des lieux des stations de transports
vérification,ST.3.3,Services et Transports,Bornes véhicules électriques
vérification,ST.4.1.2,Services et Transports,Emplacement local vélos/poussettes
vérification,ST.4.1.3,Services et Transports,Dimensionnement local vélos/poussettes
vérification,ST.4.1.4,Services et Transports,Local vélos et local poussettes
vérification,ST.4.1.6,Services et Transports,Système de contrôle d'accès
vérification,ST.4.1.7,Services et Transports,Portes local vélos/poussettes
vérification,ST.4.1.9,Services et Transports,Local vélos/poussettes au RDC
vérification,ST.4.1.14,Services et Transports,Bancs et casiers
identification,ST.4.6.1,Services et Transports,Espace collectif
vérification,ST.4.6.6,Services et Transports,Espaces d'activités physiques
vérification,BC.2.1.1.1,Bâtiment connecté,Raccordement à la fibre optique
vérification,BC.2.1.2.1,Bâtiment connecté,Raccordement du logement au réseau de communication
vérification,BC.2.1.2.2,Bâtiment connecté,Le brassage dans le logement
vérification,BC.2.1.3.1,Bâtiment connecté,Autocontrôles des entreprises de la fibre optique
vérification,BC.2.1.3.3,Bâtiment connecté,Autocontrôles des entreprises
vérification,BC.2.2.1.1,Bâtiment connecté,Mise en place d'un réseau IP dédié au parties communes
vérification,BC.2.3.1.1,Bâtiment connecté,Equipements connectés au réseau IP
vérification,BC.2.3.1.2,Bâtiment connecté,API ouvertes des équipements connectés
identification,BC.2.4.1.1,Bâtiment connecté,Usages en parties communes
identification,BC.2.4.2.1,Bâtiment connecté,Usages dans les logements
vérification,BC.2.5.1.1,Bâtiment connecté,Confidentialité et protection des données personnelles
vérification,BC.2.5.2.1,Bâtiment connecté,Système de protection et d'accès contre le piratage
vérification,BC.2.5.2.2,Bâtiment connecté,Mise en place d'un SMSI
vérification,BC.2.5.3.1,Bâtiment connecté,Fonctionnement des équipements sans connexion
vérification,BC.2.6.1.1,Bâtiment connecté,Attestations de formation type objectif fibre
vérification,BC.2.6.1.3,Bâtiment connecté,Management AMO smart
vérification,PE.1.1.66,Performance énergétique,Respect des indicateurs énergie réglementaire
vérification,PE.1.1.68,Performance énergétique,Renforcement du Bbio
vérification,PE.1.1.69,Performance énergétique,Production d'électricité
vérification,PE.1.1.5.1,Performance énergétique,Intégrité thermique
identification,PE.1.1.27,Performance énergétique,Niveaux de performance énergétique en rénovation lourde
vérification,PE.1.4.4,Performance énergétique,"Indicateur ""Energie Primaire non renouvelable"""
vérification,PE.2.1.1,Performance énergétique,Calcul de déperditions pièce par pièce
vérification,PE.2.1.4,Performance énergétique,Emetteur de chaleur par pièce
vérification,PE.2.2.1.1,Performance énergétique,"Performance des convecteurs, panneaux rayonnants, radiateurs électriques"
vérification,PE.2.2.1.2,Performance énergétique,Prescriptions Techniques Plancher Rayonnant Electrique
vérification,PE.2.2.1.3,Performance énergétique,Prescriptions Techniques Plafond Rayonnant Electrique
vérification,PE.2.2.1.4,Performance énergétique,Prescriptions Techniques Plafond Rayonnant Plâtre
vérification,PE.2.2.1.5,Performance énergétique,Performance des sèche-serviettes
vérification,PE.2.2.2.1,Performance énergétique,Appareils certifiés NF
vérification,PE.2.2.2.2,Performance énergétique,Appareils certifiés Eurovent Certified Performance
vérification,PE.2.3.2.1,Performance énergétique,Performance chaudière individuelle biomasse
vérification,PE.2.3.3.1,Performance énergétique,Performance chaudière collective biomasse à chargement automatique
vérification,PE.2.3.4.1,Performance énergétique,Performance chaudière individuelle à combustion liquide ou gazeux
vérification,PE.2.3.5.1,Performance énergétique,Performance chaudière collective à combustible liquide ou gazeux
vérification,PE.2.3.6.1,Performance énergétique,Performance chaudière micro-cogénération
vérification,PE.2.3.7.1,Performance énergétique,Calorifugeage des composants de la sous-station
vérification,PE.2.3.8.1,Performance énergétique,Performance générateurs hybrides individuels / PAC et Chaudière gaz
vérification,PE.2.3.9.1,Performance énergétique,Performance Chauffage PAC individuelle à compression électrique
vérification,PE.2.3.9.3,Performance énergétique,Performance refroidissement PAC individuelle à compression électrique
vérification,PE.2.3.10.1,Performance énergétique,Performance PAC collective à compression électrique
vérification,PE.2.3.12.1,Performance énergétique,Performance PAC collective à absorption au gaz
vérification,PE.2.4.1.2,Performance énergétique,Dispositif de programmation
vérification,PE.2.4.1.3,Performance énergétique,Thermostats
vérification,PE.2.4.1.4,Performance énergétique,Régulation pour plafonds rayonnants électriques (modules chauffants)
vérification,PE.2.4.1.5,Performance énergétique,Régulation pour plafonds rayonnants plâtre (PRP)
vérification,PE.2.4.2.3,Performance énergétique,Régulation chauffage individuel par pompe à chaleur
vérification,PE.2.4.2.4,Performance énergétique,Régulation par robinet à tête thermostatique
vérification,PE.2.4.2.5,Performance énergétique,Régulation chauffage individuel par chaudière et radiateur eau chaude
vérification,PE.2.4.2.6,Performance énergétique,Régulation chauffage individuel par chaudière et émission plancher chauffant
vérification,PE.2.4.2.7,Performance énergétique,Régulation chauffage individuel par PAC et émission plancher chauffant
vérification,PE.2.4.2.8,Performance énergétique,Programmation chauffage individuel à eau chaude
vérification,PE.2.4.3.4,Performance énergétique,Régulation en fonction de la température extérieure
vérification,PE.2.4.3.7,Performance énergétique,Régulation par robinet à tête thermostatique par pièce
vérification,PE.2.4.3.8,Performance énergétique,Programmation des changements de régime
vérification,PE.2.4.3.11,Performance énergétique,Régulation optimisée par façades
vérification,PE.2.4.5.3,Performance énergétique,Régulation en fonction de la température intérieur sur débit d'air
vérification,PE.2.4.6.2,Performance énergétique,Programmation chauffage individuel à air
vérification,PE.2.4.7.1,Performance énergétique,Commutation entre les systèmes
vérification,PE.3.1.1.1,Performance énergétique,Performance ECS chaudière individuelle à combustible gazeux
vérification,PE.3.1.2.1,Performance énergétique,Performance ECS chaudière individuelle à combustible liquide
vérification,PE.3.1.4.1,Performance énergétique,Performance des chauffe-eaux électriques à accumulation
vérification,PE.3.1.5.1,Performance énergétique,Performance des chauffe-eaux thermodynamiques individuels
vérification,PE.3.1.6.1,Performance énergétique,Performance ECS Générateurs hybrides individuels PAC et chaudière Gaz
vérification,PE.3.1.7.1,Performance énergétique,Dimensionnement PAC individuelle à compression électrique double service
vérification,PE.3.1.8.1,Performance énergétique,Dimensionnement installation de production d'eau chaude sanitaire collective
vérification,PE.3.1.9.1,Performance énergétique,Dimensionnement production d'ECS individualisé (CIC avec MTA)
vérification,PE.3.1.10.1,Performance énergétique,Conformité aux règles d'installation du CNPG
vérification,PE.3.1.11.1,Performance énergétique,Dimensionnement de l'installation et marquage
vérification,PE.3.1.12.1,Performance énergétique,Avis technique et certification des capteurs solaires vitrées
vérification,PE.3.1.13.1,Performance énergétique,Avis technique et certification des capteurs solaires non vitrées
vérification,PE.3.1.14.1,Performance énergétique,Certification Chauffe-eau solaire
vérification,PE.3.1.15.1,Performance énergétique,Dimensionnement pour le système solaire combiné
identification,PE.3.1.16.1,Performance énergétique,Dimensionnement pour le chauffe-eau solaire collectif
vérification,PE.3.1.17.1,Performance énergétique,Dimensionnement pour le chauffe-eau solaire collectif individualisé
vérification,PE.3.1.19.1,Performance énergétique,Installation de récupération de chaleur sur eaux usées et eaux grises
vérification,PE.4.1.3,Performance énergétique,"Titre V ""Cas particuliers"""
identification,PE.4.2.3,Performance énergétique,Système innovant
identification,PE.6.1.1,Performance énergétique,Efficacité lumineuse luminaire et lampe des parties communes
vérification,PE.6.1.2,Performance énergétique,Détection de présence en parties communes
vérification,PE.6.1.4,Performance énergétique,Ballasts électroniques pour lampe fluocompacte
vérification,PE.6.1.5,Performance énergétique,Indépendance des circuits des locaux communs
vérification,PE.6.1.6,Performance énergétique,Temporisation de l'éclairage des parties communes
vérification,PE.6.1.7,Performance énergétique,Efficacité lumineuse lampe des parties communes
vérification,PE.6.2.1,Performance énergétique,Dispositif d'éclairage du hall d'entrée
vérification,PE.6.2.3,Performance énergétique,Indépendance d'éclairage du hall d'entrée
vérification,PE.6.3.1,Performance énergétique,Zones maximales d'éclairage des circulations horizontales
vérification,PE.6.4.1,Performance énergétique,Dispositif d'éclairage des escaliers
vérification,PE.6.5.1,Performance énergétique,Surface d'éclairage des coursives
vérification,PE.6.6.1,Performance énergétique,Surface d'éclairage des parkings
vérification,PE.6.7.1,Performance énergétique,Programmation de l'éclairage de nuit
vérification,PE.6.7.2,Performance énergétique,Eclairage photovoltaïque en extérieur
vérification,PE.6.8.1,Performance énergétique,Interrupteur intérieur pour les balcons et terrasses
vérification,PE.6.8.2,Performance énergétique,Extinction équipement multimédia par interrupteur
vérification,PE.6.9.1,Performance énergétique,Type d'ascenseur
vérification,PE.6.9.2,Performance énergétique,Eclairage des ascenseurs
vérification,PE.6.9.3,Performance énergétique,Récupération d'énergie pour les ascenseurs
vérification,PE.6.10.1,Performance énergétique,BAEH à LED
vérification,PE.7.1.7,Performance énergétique,Autocontrôle de l'installation de chauffage et/ou refroidissement
vérification,PE.7.1.8,Performance énergétique,Autocontrôle de l'installation de production d'eau chaude solaire collective
identification,PE.7.2.12,Performance énergétique,Garantie de Performance Energétique Intrinsèque (GPEI)
vérification,PE.7.2.13,Performance énergétique,Procédures de commissionnement
vérification,PE.7.2.14,Performance énergétique,Chauffe-eau solaire collectif individualisé
vérification,PE.8.1.6,Performance énergétique,Etude thermique
vérification,PE.8.1.7,Performance énergétique,Conception de l'installation solaire thermique
cohérence,PE.8.1.8,Performance énergétique,Conception de l'installation de production utilisant la biomasse en combustion
vérification,PE.8.1.9,Performance énergétique,Conception de l'installation de production utilisant l'énergie géothermique
vérification,PE.8.2.12,Performance énergétique,Conception du système solaire thermique
vérification,PE.8.2.13,Performance énergétique,Installation solaire photovoltaïque
vérification,PE.8.2.14,Performance énergétique,Installation des PAC géothermiques/aérothermiques
vérification,PE.8.2.15,Performance énergétique,Installation des chauffe-eaux thermodynamiques
vérification,PE.8.2.16,Performance énergétique,Installation thermique au bois
vérification,RCE.1.1,Réduction des Consommations d'Eau,Détection des fuites
vérification,RCE.2.1.1,Réduction des Consommations d'Eau,Eaux pluviales
vérification,RCE.2.1.3,Réduction des Consommations d'Eau,Eaux grises
vérification,RCE.2.2.1,Réduction des Consommations d'Eau,WC certifié
vérification,RCE.2.2.2,Réduction des Consommations d'Eau,Chasse d'eau
vérification,RCE.2.2.4,Réduction des Consommations d'Eau,Chasse d'eau double commande 3/6L
identification,RCE.2.3.1,Réduction des Consommations d'Eau,Arrosage collectif
vérification,RCE.2.3.2,Réduction des Consommations d'Eau,Arrosage avec compteur
vérification,RCE.2.4.1,Réduction des Consommations d'Eau,Distribution collective
vérification,RCE.2.4.4,Réduction des Consommations d'Eau,Compteur d'eau en cas de distribution collective
vérification,RCE.2.5.1,Réduction des Consommations d'Eau,Manchette
vérification,RCE.2.5.4,Réduction des Consommations d'Eau,Compteur sur eau froide
vérification,RCE.3.1.1,Réduction des Consommations d'Eau,Robinetterie certifiée
vérification,RCE.3.2.2,Réduction des Consommations d'Eau,Classement ECAU (ou équivalent)
vérification,RCE.3.2.3,Réduction des Consommations d'Eau,Classe de débit
vérification,RCE.3.2.4,Réduction des Consommations d'Eau,Classe de confort
vérification,RCE.3.2.9,Réduction des Consommations d'Eau,Mitigeur thermostatique
vérification,RCE.3.2.17,Réduction des Consommations d'Eau,Débit Taxonomie
identification,RCE.4.1,Réduction des Consommations d'Eau,Indicateur consommation d'eau
identification,SOL.1.2,Utilisation des sols,Calcul du coefficient d'imperméabilisation de la parcelle
vérification,SOL.2.1,Utilisation des sols,Extension verticale
vérification,SOL.3.1,Utilisation des sols,Système de rétention écologique des EP
vérification,REM.1.2.2,Ressources matières,Forêt écocertifiée
identification,REM.2.2.3,Ressources matières,Recours aux produits recyclés
vérification,REM.2.4.1,Ressources matières,"Indicateur ""Epuisement des ressources"""
identification,REM.2.4.3,Ressources matières,Réemploi ou réutilisation des produits de construction
vérification,DEC.1,Déchets,Indicateurs déchets par ACV bâtiment
identification,DEC.2,Déchets,Valorisation des déchets de chantier
vérification,DEC.5,Déchets,Labellisation Quali recycle BTP
vérification,DEC.6,Déchets,Déchets générés par les travaux
vérification,DEC.7,Déchets,Elimination des déchets
vérification,DEC.3.1,Déchets,Potentiel d'évolution du bâtiment
vérification,DEC.4.1,Déchets,Potentiel de démontabilité du bâtiment
vérification,CC.2,Changement Climatique,Potentiel d'écomobilité du bâtiment
vérification,CC.10,Changement Climatique,ICconstruction et ICénergie
vérification,CC.11,Changement Climatique,ICénergie
vérification,CC.12,Changement Climatique,ICconstruction
vérification,CC.13,Changement Climatique,Qualif 13-33
vérification,BDV.3.1,Biodiversité,Enjeux écologiques
vérification,BDV.3.2,Biodiversité,Diagnostic écologique
vérification,BDV.3.5,Biodiversité,IVE/ITCE
vérification,BDV.4.1,Biodiversité,Minimum de végétalisation
vérification,BDV.4.3,Biodiversité,Palette végétale
vérification,BDV.4.5,Biodiversité,Programme d'entretien et de maintenance des aménagements paysagers
identification,BDV.5.1,Biodiversité,IVS
vérification,BDV.5.2,Biodiversité,Neutralisation des risques et pollution lumineuse
identification,CDE.1.1,Coût d'entretien et durabilité de l'enveloppe,Calcul de la durabilité de l'enveloppe
vérification,CDE.1.4,Coût d'entretien et durabilité de l'enveloppe,Systèmes de finition
vérification,MCC.1,Maîtrise des Consommations et des Charges,Estimation des charges d'exploitation
vérification,CG.1,Coût Global,Etudes d'approvisionnement en énergie
cohérence,CG.2,Coût Global,Etudes en coût global
vérification,CG.5,Coût Global,Réemploi
vérification,DCN.1,Déconstruction,Diagnostic déchets
vérification,DCN.2,Déconstruction,Dépose sélective et diagnostic déchets
vérification,DCN.3,Déconstruction,"Dépose sélective, recyclage et valorisation matière"
identification,DCN.5,Déconstruction,Valorisation des déchets de chantier
vérification,VRL.1,Valorisation des ressources locales,Synergie
vérification,VRL.2,Valorisation des ressources locales,Filière locale
vérification,QSI.1.1.1,Qualité de services et d'information,Support d'information
vérification,QSI.1.1.2,Qualité de services et d'information,Information au prospect
vérification,QSI.1.2.1,Qualité de services et d'information,Contrat de réservation
vérification,QSI.1.2.2,Qualité de services et d'information,Garantie spécifique à la VEFA
vérification,QSI.1.2.3,Qualité de services et d'information,Délais contractuels de livraison
vérification,QSI.1.2.4,Qualité de services et d'information,Obtention de la certification
vérification,QSI.1.3.1,Qualité de services et d'information,Planning d'information
vérification,QSI.1.3.2,Qualité de services et d'information,Communication des retards
vérification,QSI.1.3.3,Qualité de services et d'information,Visite du logement
vérification,QSI.1.3.4,Qualité de services et d'information,TMA et Travaux réservés
vérification,QSI.1.4.1,Qualité de services et d'information,Documents lors de la remise des clés
vérification,QSI.1.4.3,Qualité de services et d'information,Année de parfait achèvement
vérification,QSI.1.4.4,Qualité de services et d'information,Etudes de satisfaction Clients
vérification,QSI.2.1.1,Qualité de services et d'information,Support d'information
vérification,QSI.2.1.2,Qualité de services et d'information,Information au prospect
vérification,QSI.2.1.3,Qualité de services et d'information,Promesse de vente
vérification,QSI.2.1.4,Qualité de services et d'information,Attestation de conformité
vérification,QSI.2.2.1,Qualité de services et d'information,Année de parfait achèvement
vérification,QSI.2.2.2,Qualité de services et d'information,Etudes de satisfaction Clients
vérification,QSI.3.1.1,Qualité de services et d'information,Document d'information
vérification,QSI.3.2.1,Qualité de services et d'information,Communication sur la marque NF Habitat`;

// Chargement du fichier CSV
function loadCSVData() {
    try {
        Papa.parse(csvDataRaw, {
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                csvData = results.data;
                console.log(`✅ ${csvData.length} exigences NF Habitat chargées`);
            },
            error: function(error) {
                console.error('Erreur lors du parsing du CSV:', error);
                showError('Impossible de charger la base de données des exigences NF Habitat');
            }
        });
    } catch (error) {
        console.error('Erreur:', error);
        showError('Erreur de chargement de la base de données');
    }
}

// Configuration du drag and drop
function setupDragAndDrop() {
    const uploadBox = document.getElementById('uploadBox');
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadBox.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    ['dragenter', 'dragover'].forEach(eventName => {
        uploadBox.addEventListener(eventName, () => {
            uploadBox.classList.add('drag-over');
        });
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        uploadBox.addEventListener(eventName, () => {
            uploadBox.classList.remove('drag-over');
        });
    });
    
    uploadBox.addEventListener('drop', handleDrop);
}

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    
    if (files.length > 0) {
        handleFile(files[0]);
    }
}

// Configuration de l'input file
function setupFileInput() {
    const fileInput = document.getElementById('fileInput');
    fileInput.addEventListener('change', function(e) {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });
}

// Gestion du fichier uploadé
function handleFile(file) {
    if (file.type !== 'application/pdf') {
        showError('Le fichier doit être au format PDF');
        return;
    }
    
    // Vérifier que le nom du projet est renseigné
    const projectName = document.getElementById('projectName').value.trim();
    if (!projectName) {
        showError('Veuillez renseigner le nom du projet avant de charger le PDF');
        document.getElementById('projectName').focus();
        return;
    }
    
    uploadedFile = file;
    displayFileInfo(file);
    processFile(file);
}

// Affichage des informations du fichier
function displayFileInfo(file) {
    document.getElementById('uploadBox').style.display = 'none';
    const fileInfo = document.getElementById('fileInfo');
    fileInfo.style.display = 'block';
    
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileSize').textContent = formatFileSize(file.size);
    
    // Replier automatiquement la section description
    collapseDescription();
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Suppression du fichier
function removeFile() {
    uploadedFile = null;
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('uploadBox').style.display = 'block';
    document.getElementById('fileInput').value = '';
}

// Traitement du fichier PDF
async function processFile(file) {
    showProgress();
    startKeepAlive(); // Empêcher la mise en veille de l'onglet
    
    try {
        updateProgress(10, 'Chargement du PDF...');
        
        // Lecture du fichier PDF
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        pdfDoc = await loadingTask.promise;
        
        updateProgress(30, `Extraction du texte (${pdfDoc.numPages} pages)...`);
        
        // Extraction du texte page par page avec identification des codes
        const pageTexts = [];
        const codesPerPage = [];
        
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            pageTexts.push(pageText);
            
            // Identifier les codes présents sur cette page
            const codesOnThisPage = findCodesOnPage(pageText, i);
            codesPerPage.push(codesOnThisPage);
            
            updateProgress(30 + (i / pdfDoc.numPages) * 40, `Extraction page ${i}/${pdfDoc.numPages}...`);
        }
        
        updateProgress(70, 'Identification des codes d\'exigences...');
        
        // Recherche des codes d'exigences dans le texte complet
        const fullText = pageTexts.join('\n');
        const detectedCodes = findRequirementCodes(fullText, codesPerPage);
        
        updateProgress(85, 'Organisation par codes...');
        
        // Organisation des résultats par code individuel
        parsedResults = organizeByCode(detectedCodes);
        
        updateProgress(95, 'Préparation des PDFs par code...');
        
        // Préparation des informations pour chaque PDF
        await prepareCodePDFs(file, detectedCodes);
        
        updateProgress(100, 'Traitement terminé !');
        
        // Affichage des résultats immédiatement
        displayResults();
        
    } catch (error) {
        console.error('Erreur lors du traitement:', error);
        showError('Erreur lors du traitement du PDF: ' + error.message);
    } finally {
        stopKeepAlive(); // Arrêter le keep alive
    }
}

// Recherche des codes sur une page spécifique
function findCodesOnPage(pageText, pageNumber) {
    const codesFound = [];
    
    csvData.forEach(requirement => {
        const code = requirement.Code;
        if (!code || !code.trim()) return;
        
        // Échapper les caractères spéciaux
        const escapedCode = code.replace(/\./g, '\\.');
        
        // Créer plusieurs patterns de recherche
        const patterns = [
            new RegExp('\\b' + escapedCode + '\\b', 'gi'),
            new RegExp(escapedCode.replace(/\\\./g, '\\s*\\.\\s*'), 'gi'),
            new RegExp('^' + escapedCode + '\\b', 'gim'),
            new RegExp('\\n\\s*' + escapedCode + '\\s*\\n', 'gi')
        ];
        
        // Tester si le code apparaît sur cette page
        for (const regex of patterns) {
            regex.lastIndex = 0;
            if (regex.test(pageText)) {
                codesFound.push({
                    code: code,
                    theme: requirement['Thème'] || 'Non classé',
                    category: requirement['Catégorie'] || '',
                    type: requirement['Type'] || '',
                    page: pageNumber
                });
                break; // Un seul match par code suffit
            }
        }
    });
    
    return codesFound;
}

// Recherche des codes d'exigences dans le texte
function findRequirementCodes(text, codesPerPage) {
    const detectedCodes = [];
    const codePositions = new Map();
    
    // Normalisation du texte
    const normalizedText = text.replace(/\s+/g, ' ');
    
    // Pour chaque code dans le CSV, vérifier s'il est présent dans le texte
    csvData.forEach(requirement => {
        const code = requirement.Code;
        if (!code || !code.trim()) return;
        
        // Échapper les caractères spéciaux
        const escapedCode = code.replace(/\./g, '\\.');
        
        // Créer plusieurs patterns de recherche
        const patterns = [
            new RegExp('\\b' + escapedCode + '\\b', 'gi'),
            new RegExp(escapedCode.replace(/\\\./g, '\\s*\\.\\s*'), 'gi'),
            new RegExp('^' + escapedCode + '\\b', 'gim'),
            new RegExp('\\n\\s*' + escapedCode + '\\s*\\n', 'gi')
        ];
        
        // Tester chaque pattern
        for (const regex of patterns) {
            let match;
            regex.lastIndex = 0;
            
            while ((match = regex.exec(normalizedText)) !== null) {
                const position = match.index;
                const key = `${code}-${Math.floor(position / 100)}`;
                
                if (!codePositions.has(key)) {
                    // Trouver la première page où ce code apparaît
                    let firstPage = null;
                    codesPerPage.forEach((codesOnPage, pageIndex) => {
                        if (codesOnPage.some(c => c.code === code)) {
                            if (firstPage === null) {
                                firstPage = pageIndex + 1;
                            }
                        }
                    });
                    
                    codePositions.set(key, {
                        code: code,
                        theme: requirement['Thème'] || 'Non classé',
                        category: requirement['Catégorie'] || '',
                        type: requirement['Type'] || '',
                        position: position,
                        firstPage: firstPage || 1
                    });
                }
            }
        }
    });
    
    // Convertir en tableau et trier par position
    const positions = Array.from(codePositions.values());
    positions.sort((a, b) => a.position - b.position);
    
    // Suppression des doublons strictement consécutifs
    const uniqueCodes = [];
    let lastCode = null;
    
    positions.forEach(item => {
        if (item.code !== lastCode) {
            uniqueCodes.push(item);
            lastCode = item.code;
        }
    });
    
    // Calculer les plages de pages pour chaque code
    // Chaque code s'étend de sa première page jusqu'à la page avant le code suivant
    for (let i = 0; i < uniqueCodes.length; i++) {
        const currentCode = uniqueCodes[i];
        const nextCode = uniqueCodes[i + 1];
        
        const startPage = currentCode.firstPage;
        let endPage;
        
        if (nextCode) {
            // Si le prochain code est sur la même page, on ne prend que cette page
            if (nextCode.firstPage === startPage) {
                endPage = startPage;
            } else {
                // Sinon, on prend toutes les pages jusqu'à la page avant le prochain code
                endPage = nextCode.firstPage - 1;
            }
        } else {
            // Dernier code : jusqu'à la fin du document
            endPage = pdfDoc.numPages;
        }
        
        // Générer la liste de toutes les pages pour ce code
        currentCode.pages = [];
        for (let page = startPage; page <= endPage; page++) {
            currentCode.pages.push(page);
        }
    }
    
    console.log(`✅ ${uniqueCodes.length} codes d'exigences détectés`);
    console.log('Premiers codes avec pages:', uniqueCodes.slice(0, 10).map(c => ({ code: c.code, pages: c.pages })));
    
    return uniqueCodes;
}

// Organisation des codes individuellement
function organizeByCode(detectedCodes) {
    // Retourner simplement chaque code comme un élément indépendant
    return detectedCodes.map(item => ({
        code: item.code,
        theme: item.theme || 'Non classé',
        category: item.category || '',
        type: item.type || '',
        pages: item.pages || [],
        pageCount: item.pages ? item.pages.length : 0
    }));
}

// Fonction pour rendre une page en canvas (haute qualité)
async function renderPageToCanvas(page, scale = 2) {
    const viewport = page.getViewport({ scale: scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({
        canvasContext: context,
        viewport: viewport
    }).promise;

    return canvas;
}

// Préparation des PDFs par code (100% client-side)
async function prepareCodePDFs(file, detectedCodes) {
    try {
        const projectName = document.getElementById('projectName').value.trim();
        
        // Pour chaque code, préparer les informations
        for (const codeItem of parsedResults) {
            console.log(`Code "${codeItem.code}": ${codeItem.pages.length} pages`, codeItem.pages);
            
            // Stocker les informations pour ce code
            codeItem.pdfFilename = sanitizeFilename(`${projectName}_${codeItem.code}`) + '.pdf';
            
            // Pas de génération immédiate - sera fait à la demande
            codeItem.pdfBlob = null;
        }
        
        console.log(`✅ ${parsedResults.length} codes préparés`);
        
    } catch (error) {
        console.error('Erreur lors de la préparation des PDFs:', error);
        throw error;
    }
}

// Nettoyage du nom de fichier
function sanitizeFilename(filename) {
    return filename
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, '_')
        .substring(0, 200);
}

// Affichage des résultats
function displayResults() {
    document.getElementById('progressSection').style.display = 'none';
    const resultsSection = document.getElementById('resultsSection');
    resultsSection.style.display = 'block';
    resultsSection.classList.add('fade-in');
    
    // Afficher le bouton d'envoi à l'API en haut
    document.getElementById('sendToApiSection').style.display = 'block';
    
    // Compter les thèmes uniques
    const uniqueThemes = new Set(parsedResults.map(item => item.theme)).size;
    
    // Mise à jour des statistiques
    document.getElementById('totalCodes').textContent = parsedResults.length;
    document.getElementById('totalThemes').textContent = uniqueThemes;
    document.getElementById('totalPages').textContent = pdfDoc ? pdfDoc.numPages : '?';
    
    // Affichage des codes
    const themesContainer = document.getElementById('themesContainer');
    themesContainer.innerHTML = '';
    
    parsedResults.forEach((codeItem, index) => {
        const codeCard = createCodeCard(codeItem, index);
        themesContainer.appendChild(codeCard);
    });
}

// Création d'une carte de code
function createCodeCard(codeItem, index) {
    const card = document.createElement('div');
    card.className = 'theme-card fade-in';
    card.style.animationDelay = `${index * 0.05}s`;
    
    const pageCount = codeItem.pageCount || 0;
    
    card.innerHTML = `
        <div class="theme-header">
            <div class="theme-title">
                <h3>${codeItem.code}</h3>
                <div class="theme-meta">
                    <span>${codeItem.theme}</span>
                    ${codeItem.category ? `<span>•</span><span>${codeItem.category}</span>` : ''}
                    <span>•</span>
                    <span>${pageCount} page${pageCount > 1 ? 's' : ''}</span>
                </div>
            </div>
            <span class="theme-badge">${codeItem.type || 'vérification'}</span>
        </div>
        
        <div class="codes-list">
            <h4>Pages incluses:</h4>
            <div class="code-tags">
                ${codeItem.pages.map(page => 
                    `<span class="code-tag">Page ${page}</span>`
                ).join('')}
            </div>
        </div>
        
        <button class="btn-download-theme" onclick="downloadCodePDF(${index})">
            📥 Télécharger (${pageCount} page${pageCount > 1 ? 's' : ''})
        </button>
    `;
    
    return card;
}

// Téléchargement d'un PDF de code (100% client-side)
async function downloadCodePDF(index) {
    const codeItem = parsedResults[index];
    
    if (!codeItem.pages || codeItem.pages.length === 0) {
        showError('Aucune page disponible pour ce code');
        return;
    }
    
    if (!pdfDoc) {
        showError('Document PDF non disponible');
        return;
    }
    
    try {
        // Afficher un indicateur de chargement
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = '⏳ Génération...';
        btn.disabled = true;
        
        // Créer un nouveau PDF avec jsPDF
        const { jsPDF } = window.jspdf;
        
        // Rendre la première page pour obtenir les dimensions
        const firstPage = await pdfDoc.getPage(codeItem.pages[0]);
        const viewport = firstPage.getViewport({ scale: 1 });
        const pdfWidth = viewport.width * 0.264583; // Convertir pixels en mm (72 DPI)
        const pdfHeight = viewport.height * 0.264583;
        
        // Créer le PDF avec les bonnes dimensions (A4 par défaut)
        const pdf = new jsPDF({
            orientation: pdfWidth > pdfHeight ? 'landscape' : 'portrait',
            unit: 'mm',
            format: 'a4'
        });
        
        // Générer chaque page
        let isFirstPage = true;
        for (const pageNum of codeItem.pages) {
            const page = await pdfDoc.getPage(pageNum);
            const canvas = await renderPageToCanvas(page, 2);
            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            
            if (!isFirstPage) {
                pdf.addPage();
            }
            
            // Calculer les dimensions pour s'adapter à la page
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            
            pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight);
            isFirstPage = false;
            
            // Mettre à jour le bouton avec la progression
            btn.textContent = `⏳ ${codeItem.pages.indexOf(pageNum) + 1}/${codeItem.pages.length}...`;
        }
        
        // Télécharger le PDF
        pdf.save(codeItem.pdfFilename);
        
        // Restaurer le bouton
        btn.textContent = originalText;
        btn.disabled = false;
        
    } catch (error) {
        console.error('Erreur lors de la génération:', error);
        showError('Erreur lors de la génération du PDF: ' + error.message);
        
        // Restaurer le bouton
        if (event && event.target) {
            event.target.disabled = false;
            event.target.textContent = `📥 Télécharger (${codeItem.pageCount} page${codeItem.pageCount > 1 ? 's' : ''})`;
        }
    }
}

// Téléchargement de tous les PDFs (100% client-side)
async function downloadAllPDFs() {
    if (!pdfDoc) {
        showError('Document PDF non disponible');
        return;
    }
    
    startKeepAlive(); // Empêcher la mise en veille de l'onglet
    
    try {
        // Afficher la progression
        showProgress();
        updateProgress(10, 'Préparation des PDFs...');
        
        const projectName = document.getElementById('projectName').value.trim();
        const zip = new JSZip();
        const { jsPDF } = window.jspdf;
        
        let completed = 0;
        const total = parsedResults.filter(c => c.pages && c.pages.length > 0).length;
        
        // Générer chaque PDF
        for (const codeItem of parsedResults) {
            if (!codeItem.pages || codeItem.pages.length === 0) {
                continue;
            }
            
            updateProgress(10 + (completed / total) * 80, `Génération de ${codeItem.code}...`);
            
            try {
                // Créer un PDF pour ce code
                const firstPage = await pdfDoc.getPage(codeItem.pages[0]);
                const viewport = firstPage.getViewport({ scale: 1 });
                const pdfWidth = viewport.width * 0.264583;
                const pdfHeight = viewport.height * 0.264583;
                
                const pdf = new jsPDF({
                    orientation: pdfWidth > pdfHeight ? 'landscape' : 'portrait',
                    unit: 'mm',
                    format: 'a4'
                });
                
                let isFirstPage = true;
                for (const pageNum of codeItem.pages) {
                    const page = await pdfDoc.getPage(pageNum);
                    const canvas = await renderPageToCanvas(page, 2);
                    const imgData = canvas.toDataURL('image/jpeg', 0.95);
                    
                    if (!isFirstPage) {
                        pdf.addPage();
                    }
                    
                    const pageWidth = pdf.internal.pageSize.getWidth();
                    const pageHeight = pdf.internal.pageSize.getHeight();
                    
                    pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight);
                    isFirstPage = false;
                }
                
                // Ajouter au ZIP
                const pdfBlob = pdf.output('blob');
                zip.file(codeItem.pdfFilename, pdfBlob);
                
            } catch (err) {
                console.warn(`Erreur pour ${codeItem.code}:`, err);
            }
            
            completed++;
        }
        
        // Génération du ZIP
        updateProgress(90, 'Création de l\'archive ZIP...');
        const zipBlob = await zip.generateAsync({ 
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });
        
        updateProgress(95, 'Téléchargement...');
        
        // Téléchargement
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sanitizeFilename(projectName)}_NF_Habitat_PDFs.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        updateProgress(100, 'Terminé !');
        
        // Masquer la progression après 1 seconde
        setTimeout(() => {
            document.getElementById('progressSection').style.display = 'none';
        }, 1000);
        
    } catch (error) {
        console.error('Erreur lors de la création du ZIP:', error);
        showError('Erreur lors de la génération des PDFs: ' + error.message);
    } finally {
        stopKeepAlive(); // Arrêter le keep alive
    }
}

// Affichage de la progression
function showProgress() {
    document.getElementById('progressSection').style.display = 'block';
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('errorSection').style.display = 'none';
}

function updateProgress(percent, text) {
    document.getElementById('progressBar').style.width = percent + '%';
    document.getElementById('progressText').textContent = text;
    
    // Mettre à jour le titre de la page pour montrer la progression même dans les onglets inactifs
    if (percent < 100) {
        document.title = `[${Math.round(percent)}%] NF Habitat - Traitement...`;
    } else {
        document.title = '✅ NF Habitat - Terminé !';
        // Restaurer le titre après 3 secondes
        setTimeout(() => {
            document.title = 'NF Habitat - Séparateur de PDF';
        }, 3000);
    }
}

// Affichage des erreurs
function showError(message) {
    document.getElementById('progressSection').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'none';
    const errorSection = document.getElementById('errorSection');
    errorSection.style.display = 'block';
    document.getElementById('errorMessage').textContent = message;
}

// Envoi de tous les PDFs vers le webhook (un par un)
async function sendAllToWebhook() {
    if (!pdfDoc) {
        showError('Document PDF non disponible');
        return;
    }
    
    // Afficher le bouton "Voir les résultats"
    document.getElementById('viewResultsBtn').style.display = 'inline-block';
    
    // Désactiver le bouton
    const btn = document.getElementById('sendToWebhookBtn');
    btn.disabled = true;
    const originalText = btn.textContent;
    
    startKeepAlive(); // Empêcher la mise en veille de l'onglet pendant l'envoi
    
    try {
        // Afficher la progression
        showProgress();
        updateProgress(5, 'Préparation de l\'envoi...');
        
        const projectName = document.getElementById('projectName').value.trim();
        const webhookUrl = 'https://databuildr.app.n8n.cloud/webhook/evaltojson';
        const { jsPDF } = window.jspdf;
        
        let completed = 0;
        let succeeded = 0;
        let failed = 0;
        const total = parsedResults.filter(c => c.pages && c.pages.length > 0).length;
        
        // Envoyer chaque PDF un par un
        for (const codeItem of parsedResults) {
            if (!codeItem.pages || codeItem.pages.length === 0) {
                continue;
            }
            
            updateProgress(5 + (completed / total) * 90, `Envoi ${completed + 1}/${total}: ${codeItem.code}...`);
            console.log(`🚀 Envoi ${completed + 1}/${total}: ${codeItem.code}...`);
            
            try {
                // Créer un PDF pour ce code
                const firstPage = await pdfDoc.getPage(codeItem.pages[0]);
                const viewport = firstPage.getViewport({ scale: 1 });
                const pdfWidth = viewport.width * 0.264583;
                const pdfHeight = viewport.height * 0.264583;
                
                const pdf = new jsPDF({
                    orientation: pdfWidth > pdfHeight ? 'landscape' : 'portrait',
                    unit: 'mm',
                    format: 'a4'
                });
                
                let isFirstPage = true;
                for (const pageNum of codeItem.pages) {
                    const page = await pdfDoc.getPage(pageNum);
                    const canvas = await renderPageToCanvas(page, 2);
                    const imgData = canvas.toDataURL('image/jpeg', 0.95);
                    
                    if (!isFirstPage) {
                        pdf.addPage();
                    }
                    
                    const pageWidth = pdf.internal.pageSize.getWidth();
                    const pageHeight = pdf.internal.pageSize.getHeight();
                    
                    pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight);
                    isFirstPage = false;
                }
                
                // Convertir le PDF en Blob
                const pdfBlob = pdf.output('blob');
                
                // Préparer le FormData
                const formData = new FormData();
                formData.append('data', pdfBlob, `${codeItem.code}.pdf`);
                formData.append('nomProjet', projectName);
                formData.append('codeExigence', codeItem.code);
                formData.append('theme', codeItem.theme);
                formData.append('sousTheme', codeItem.category || '');
                formData.append('numeroPage', codeItem.pages.join(', '));
                
                // Envoyer au webhook et ATTENDRE la réponse
                console.log(`📤 Envoi du PDF vers le webhook...`);
                const response = await fetch(webhookUrl, {
                    method: 'POST',
                    body: formData
                });
                console.log(`📥 Réponse reçue (status: ${response.status})`);
                
                if (!response.ok) {
                    console.warn(`⚠️ Erreur lors de l'envoi de ${codeItem.code}: ${response.status}`);
                    failed++;
                    throw new Error(`HTTP ${response.status}`);
                }
                
                // ATTENDRE et lire la réponse complète avant de continuer
                const responseText = await response.text();
                try {
                    const responseData = JSON.parse(responseText);
                    console.log(`✅ ${codeItem.code} envoyé avec succès. Réponse reçue:`, responseData);
                } catch (parseError) {
                    console.log(`✅ ${codeItem.code} envoyé avec succès. Réponse reçue:`, responseText);
                }
                succeeded++;
                
            } catch (err) {
                console.error(`❌ Erreur pour ${codeItem.code}:`, err);
                failed++;
            }
            
            completed++;
            console.log(`📊 Progression: ${completed}/${total} (${succeeded} réussis, ${failed} échoués)`);
        }
        
        updateProgress(100, `Terminé ! ${succeeded} réussis, ${failed} échoués`);
        
        // Réactiver le bouton
        btn.disabled = false;
        btn.textContent = originalText;
        
        // Masquer la progression après 3 secondes
        setTimeout(() => {
            document.getElementById('progressSection').style.display = 'none';
        }, 3000);
        
    } catch (error) {
        console.error('Erreur lors de l\'envoi vers le webhook:', error);
        showError('Erreur lors de l\'envoi vers l\'API: ' + error.message);
        
        // Réactiver le bouton
        btn.disabled = false;
        btn.textContent = originalText;
    } finally {
        stopKeepAlive(); // Arrêter le keep alive
    }
}

// Toggle de la section description
function toggleDescription() {
    const content = document.getElementById('descriptionContent');
    const icon = document.getElementById('collapseIcon');
    
    content.classList.toggle('collapsed');
    icon.classList.toggle('collapsed');
}

// Replier automatiquement la description
function collapseDescription() {
    const content = document.getElementById('descriptionContent');
    const icon = document.getElementById('collapseIcon');
    
    content.classList.add('collapsed');
    icon.classList.add('collapsed');
}

// Ouvrir les résultats dans Google Sheets
function openResults() {
    window.open('https://docs.google.com/spreadsheets/d/1qIRzsYVhGxfhkaTIS-VY9QTW2ZI7Hi_J5rPsyZMEHiQ/edit?gid=0#gid=0', '_blank');
}

// Réinitialisation de l'application
function resetApp() {
    uploadedFile = null;
    parsedResults = [];
    pdfDoc = null;
    
    document.getElementById('projectName').value = '';
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('uploadBox').style.display = 'block';
    document.getElementById('progressSection').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('errorSection').style.display = 'none';
    document.getElementById('sendToApiSection').style.display = 'none';
    document.getElementById('viewResultsBtn').style.display = 'none';
    document.getElementById('fileInput').value = '';
    
    // Réafficher la section description
    const content = document.getElementById('descriptionContent');
    const icon = document.getElementById('collapseIcon');
    content.classList.remove('collapsed');
    icon.classList.remove('collapsed');
}
