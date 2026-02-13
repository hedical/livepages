// Variable globale pour savoir si on a déjà scrollé sur la page actuelle
// NOTE: Cette variable n'est plus utilisée avec le scroll virtuel, mais on la garde au cas où.
let hasScrolledThisPage = false; 
let isProcessing = false; // Évite les exécutions multiples
let codePositionCache = {}; // VOTRE IDÉE: La carte des positions
let lastKnownScrollTop = 0; // Pour savoir où on s'est arrêté (position 'top')
console.log("Content Script chargé.");

/**
 * Écoute les changements dans le storage.
 * C'est ce qui démarre le job lorsque le popup sauvegarde les données.
 */
chrome.storage.onChanged.addListener((changes, namespace) => {
  console.log("📢 Storage changed detected:", changes);
  
  // Si le job est arrêté, ne rien faire
  if (changes.jobStatus && changes.jobStatus.newValue === 'stopped') {
    console.log("🛑 Job arrêté, abandon du traitement");
    isProcessing = false;
    return;
  }
  
  // Si jobData est créé ou modifié
  if (changes.jobData && namespace === 'local') {
    console.log("📊 JobData changed:", changes.jobData);
    
    // Si c'est un nouveau job (pas d'ancienne valeur ou nouvelle valeur différente)
    if (changes.jobData.newValue) {
      console.log("🚀 Nouveau job détecté ! Démarrage...");
      hasScrolledThisPage = false;
      isProcessing = false;
      checkJobOnLoad();
    }
  }
  
  // Si jobIndex change et qu'il y a un job en cours, continuer
  if (changes.jobIndex && namespace === 'local' && changes.jobIndex.newValue !== undefined) {
    console.log("🔢 JobIndex changed:", changes.jobIndex.newValue);
    chrome.storage.local.get(['jobData', 'jobStatus'], (result) => {
      if (result.jobData && result.jobStatus !== 'stopped') {
        console.log("✅ Job actif, continuation...");
        setTimeout(() => {
          checkJobOnLoad();
        }, 500);
      }
    });
  }
});

/**
 * Fonction principale qui s'exécute à chaque chargement de page.
 * Vérifie si un travail est en cours.
 */
function checkJobOnLoad() {
  console.log("checkJobOnLoad appelé, isProcessing:", isProcessing);
  
  if (isProcessing) {
    console.log("Traitement déjà en cours, skip.");
    return;
  }

  chrome.storage.local.get(["jobData", "jobIndex", "jobStatus"], (result) => {
    const { jobData, jobIndex, jobStatus } = result;
    
    console.log("Storage state:", { hasJobData: !!jobData, jobIndex, jobLength: jobData?.length, jobStatus });

    if (jobStatus === 'stopped') {
      console.log("Job arrêté, ne rien faire.");
      return;
    }

    if (!jobData) {
      console.log("Aucun job en cours.");
      return;
    }

    if (jobIndex < jobData.length) {
      console.log(`Travail en cours, Ligne ${jobIndex + 1}/${jobData.length}`);
      runAutomation(jobData, jobIndex);
    } else if (jobIndex >= jobData.length) {
      console.log("Travail terminé !");
      chrome.storage.local.set({ jobStatus: 'completed' });
      setTimeout(() => {
        chrome.storage.local.remove(["jobData", "jobIndex", "awaitingNavigation"]);
      }, 10000);
      isProcessing = false;
    }
  });
}

async function runAutomation(jobData, jobIndex) {
    isProcessing = true;
    const currentRow = jobData[jobIndex];
    const code = currentRow[0]; // Colonne A (index 0)
    
    if (!code) {
      console.error("Ligne ignorée, pas de code", currentRow);
      await addResult(`Ligne ${jobIndex + 1}`, 'error', 'Code manquant en colonne A', null);
      chrome.storage.local.set({ jobIndex: jobIndex + 1 }, () => { isProcessing = false; });
      return;
    }
  
    console.log(`🔄 Début du traitement pour le code: ${code}`);
    const category = code.split('.')[0];
    const currentPathParts = window.location.pathname.split('/');
    const projectId = currentPathParts[2];
    const baseUrl = `https://outil-eval.cerqual-pro.net/detail/${projectId}/rapport/rubriques/`;
    const targetUrl = baseUrl + category;
  
    await new Promise(resolve => {
      chrome.storage.local.set({ 
        jobStatus: 'running',
        currentIndex: jobIndex,
        totalLines: jobData.length,
        currentCode: code
      }, resolve);
    });
  
    // Étape 1: Navigation
    if (!window.location.href.startsWith(targetUrl)) {
      console.log(`Navigation vers la catégorie ${category}...`);
      
      // ON VIDE LE CACHE AVANT DE QUITTER LA PAGE
      codePositionCache = {};
      lastKnownScrollTop = 0;
      
      chrome.storage.local.set({ awaitingNavigation: true }, () => {
        window.location.href = targetUrl;
      });
    } else {
      // Nous sommes sur la bonne page
      try {
        const awaitingNav = await getStorageValue('awaitingNavigation');
        if (awaitingNav) {
          chrome.storage.local.remove('awaitingNavigation');
          console.log("Navigation détectée, reset du cache.");
          
          // ON VIDE LE CACHE EN ARRIVANT SUR LA PAGE
          codePositionCache = {};
          lastKnownScrollTop = 0;
          
          // ⭐ NOUVEAU: Attendre que la page soit complètement chargée
          console.log("%c⏳ Attente du chargement complet de la page...", 'color: blue; font-weight: bold;');
          await waitForPageLoad();
          console.log("%c✅ Page chargée, début du traitement", 'color: green; font-weight: bold;');
        }
        
        console.log(`Page correcte. Traitement du code ${code}...`);
        const result = await processRowOnPage(currentRow);
        
        console.log(`✅ Ligne ${code} traitée avec succès.`);
        await addResult(code, 'success', 'Traitement effectué avec succès', result.buttonInfo);
        
        chrome.storage.local.set({ jobIndex: jobIndex + 1 }, () => { isProcessing = false; });
  
      } catch (error) {
        console.error(`❌ Erreur lors du traitement de la ligne ${code}:`, error);
        await addResult(code, 'error', error.message || 'Erreur inconnue', null);
        chrome.storage.local.set({ jobIndex: jobIndex + 1 }, () => { isProcessing = false; });
      }
    }
  }

/**
 * Fait le travail "Selenium" sur la page.
 * LOGIQUE v8: Abandon intelligent basé sur le cache.
 * MODIFIÉ: Utilise colonne A pour le code, colonne J pour le bouton et colonne I pour le commentaire
 */
async function processRowOnPage(row) {
    const codeToFind = row[0] || ''; // Colonne A
    const colJ = row[9] || ''; // Bouton à cliquer (NF, NC, SO, etc.)
    const colI = row[8] || ''; // Commentaire à insérer
  
    console.log(`====================================================`);
    console.log(`%cTraitement pour: ${codeToFind}`, 'color: #00A8F3; font-size: 14px;');
    console.log(`Bouton cible: ${colJ}`);
    console.log(`Commentaire: ${colI.substring(0, 50)}...`);
    console.log(`====================================================`);
    
    let codeDiv = null;
    let scrollAttempts = 0;
    const maxScrollAttempts = 80;
    let buttonInfo = null; // Pour stocker les infos de modification du bouton

    while (!codeDiv && scrollAttempts < maxScrollAttempts) {
        console.log(`--- Boucle de recherche: Tentative ${scrollAttempts + 1}/${maxScrollAttempts} ---`);
        const jobStatus = await getStorageValue('jobStatus');
        if (jobStatus === 'stopped') throw new Error('Job arrêté');

        // --- Phase 1: SCANNER et METTRE À JOUR LE CACHE ---
        let newCodesFoundInCache = 0;
        const allItems = document.querySelectorAll('.exigenceItem[class*="datacy_exigence_"]');
        
        for (const item of allItems) {
            try {
                const classWithCode = Array.from(item.classList).find(c => c.startsWith('datacy_exigence_'));
                if (!classWithCode) continue;

                const code = classWithCode.replace('datacy_exigence_', '');
                
                const parentExigence = item.closest('.exigence-description');
                const yPos = parseInt(parentExigence.style.top, 10);

                if (!codePositionCache[code] && yPos) {
                    codePositionCache[code] = yPos;
                    newCodesFoundInCache++;
                }
            } catch (e) { /* Ignorer l'erreur si un élément est bizarre */ }
        }
        if (newCodesFoundInCache > 0) {
             console.log(`%cCache mis à jour: ${newCodesFoundInCache} nouveaux codes ajoutés.`, 'color: cyan;');
        }
        
        // --- Phase 2: CHERCHER l'élément ---
        codeDiv = findCodeElement(codeToFind);
        if (codeDiv) {
            console.log(`%c✓ TROUVÉ ! (${codeToFind})`, 'color: green; font-weight: bold;');
            // On met à jour notre position "actuelle"
            const parent = codeDiv.closest('.exigence-description');
            lastKnownScrollTop = parseInt(parent.style.top, 10);
            console.log(`Position mise à jour: ${lastKnownScrollTop}px`);
            break; // On sort de la boucle 'while'
        }
        
        // --- Phase 3: VÉRIFIER LE BOUTON NEXT ET DÉCIDER ---
        const nextButton = document.querySelector('div.button.nextButton');
        const isNextButtonVisible = nextButton && isElementInViewport(nextButton);
        
        if (isNextButtonVisible) {
            console.log(`%c⚠️ BOUTON NEXT DÉTECTÉ ET VISIBLE !`, 'color: orange; font-weight: bold;');
            
            // LOGIQUE CLÉE: Vérifier si le code est dans le cache
            const isCodeInCache = codePositionCache.hasOwnProperty(codeToFind);
            
            if (isCodeInCache) {
                // Le code existe sur la page, mais on l'a dépassé
                console.log(`%c✓ Code ${codeToFind} trouvé dans le cache à la position ${codePositionCache[codeToFind]}px`, 'color: cyan; font-weight: bold;');
                console.log(`%c→ Passage en mode SCROLL UP pour revenir en arrière`, 'color: cyan;');
                lastKnownScrollTop = 999999; // On est en bas
            } else {
                // Le code n'a JAMAIS été vu dans le cache
                console.log(`%c❌ Code ${codeToFind} ABSENT du cache après avoir atteint le bas de page`, 'color: red; font-weight: bold;');
                console.log(`%c📋 Codes présents dans le cache (${Object.keys(codePositionCache).length}):`, 'color: yellow;');
                console.log(Object.keys(codePositionCache).sort());
                throw new Error(`Code ${codeToFind} introuvable sur cette page (n'existe pas dans la catégorie)`);
            }
        }
        
        // --- Phase 4: DÉCIDER DE LA DIRECTION DE SCROLL ---
        console.log(`Code ${codeToFind} non trouvé. Décision de scroll...`);
        const allExigences = document.querySelectorAll('div.exigence-description');
        if (allExigences.length === 0) {
            throw new Error("Scan impossible, sélecteur '.exigence-description' introuvable.");
        }

        const targetPos = codePositionCache[codeToFind];
        let scrollDirection = 'DOWN'; // Par défaut, on scrolle en bas

        if (targetPos) {
            // Le cache a la position !
            if (targetPos < lastKnownScrollTop) {
                scrollDirection = 'UP';
            } else {
                scrollDirection = 'DOWN';
            }
            console.log(`Cache dit: Cible (${targetPos}px) est ${scrollDirection} de notre position (${lastKnownScrollTop}px)`);
        } else {
            // Pas de cache pour ce code = on continue à descendre pour scanner
            scrollDirection = 'DOWN';
            console.log(`→ Pas de cache pour ${codeToFind}, continuation du SCROLL DOWN pour scanner`);
        }

        // --- Phase 5: EXÉCUTER le scroll ---
        if (scrollDirection === 'DOWN') {
            const lastExigence = allExigences[allExigences.length - 1];
            console.log("%cAppel 'scrollIntoView(block: end)' pour aller VERS LE BAS...", 'color: orange;');
            lastExigence.scrollIntoView({ behavior: 'auto', block: 'end' });
            
            try {
                lastKnownScrollTop = parseInt(lastExigence.style.top, 10);
            } catch(e) { console.warn("Impossible de lire 'style.top' du dernier élément"); }

        } else { // scrollDirection === 'UP'
            const firstExigence = allExigences[0];
            console.log("%cAppel 'scrollIntoView(block: start)' pour aller VERS LE HAUT...", 'color: orange;');
            firstExigence.scrollIntoView({ behavior: 'auto', block: 'start' });
            
            try {
                lastKnownScrollTop = parseInt(firstExigence.style.top, 10);
            } catch(e) { console.warn("Impossible de lire 'style.top' du premier élément"); }
        }

        scrollAttempts++;
        await wait(1200); // Attente cruciale pour la "race condition"
    } // Fin de la boucle while

    // --- Phase 6: Remplissage (on a trouvé 'codeDiv') ---
    if (!codeDiv) {
      console.error(`ÉCHEC FINAL: Impossible de trouver le code ${codeToFind} après ${scrollAttempts} tentatives.`);
      throw new Error(`Impossible de trouver le code ${codeToFind} après ${scrollAttempts} tentatives`);
    }
  
    console.log("Centrage sur l'élément trouvé et début du remplissage...");
    codeDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await wait(800);
  
    const parentContainer = codeDiv.closest('.exigence-description');
    if (!parentContainer) throw new Error(`Conteneur parent ".exigence-description" introuvable`);

    // --- NOUVEAU: Cliquer sur le bouton de résultat selon colonne J avec logique dégressive ---
    if (colJ && colJ.trim() !== '') {
      console.log(`🔘 Recherche du bouton "${colJ}" à cliquer...`);
      buttonInfo = await clickResultButton(parentContainer, colJ);
    } else {
      console.log("⚠️ Colonne J vide, pas de clic sur bouton de résultat");
    }

    // --- Remplissage du commentaire avec colonne I uniquement ---
    if (colI && colI.trim() !== '') {
      console.log("📝 Début du remplissage du commentaire...");
      const commentArea = parentContainer.querySelector('div[data-testid="comment-area"]');
      if (!commentArea) throw new Error(`"comment-area" introuvable`);
      
      commentArea.click();
      await wait(500); 
    
      const editorIframe = await waitForElement('#edition-comment-exigence_ifr');
      let iframeDocument = null;
      let retries = 0;
      while (retries < 20) {
        iframeDocument = editorIframe.contentDocument || editorIframe.contentWindow?.document;
        if (iframeDocument && iframeDocument.body) break;
        await wait(250);
        retries++;
      }
      if (!iframeDocument || !iframeDocument.body) {
          throw new Error("Impossible d'accéder au corps de l'iframe.");
      }
      
      const editorBody = iframeDocument.body;
      
      // MODIFICATION: On utilise uniquement colI
      const commentTextHtml = colI.replace(/\n/g, '<br>');
      
      editorBody.innerHTML = commentTextHtml;
      editorBody.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      console.log("Commentaire inséré (colonne I uniquement).");
    
      await wait(500); 
    
      const validButton = document.querySelector('button[data-testid="comment-valid-button"]');
      if (!validButton) throw new Error(`Bouton "Valider" introuvable`);
      validButton.click();
    
      await waitForElementToDisappear('button[data-testid="comment-valid-button"]');
      console.log("Modale fermée.");
    } else {
      console.log("⚠️ Colonne I vide, pas de commentaire à ajouter");
    }
    
    return { buttonInfo };
}

/**
 * FONCTION AMÉLIORÉE: Clique sur le bouton de résultat avec logique dégressive
 * Hiérarchie: 3pts -> 2pts -> 1pt -> NF
 * @param {Element} container - Le conteneur parent de l'exigence
 * @param {string} buttonText - Le texte du bouton à cliquer (ex: "3pts", "2pts", "1pt", "NF", "NC", "SO")
 * @returns {Object|null} Informations sur le bouton cliqué (original et final)
 */
async function clickResultButton(container, buttonText) {
  try {
    // Chercher la div.result-column dans le conteneur
    const resultColumn = container.querySelector('.result-column');
    if (!resultColumn) {
      console.warn("⚠️ Div '.result-column' introuvable, pas de clic sur bouton");
      return null;
    }

    // Chercher tous les boutons dans cette colonne
    const buttons = resultColumn.querySelectorAll('button.button-resultat');
    if (buttons.length === 0) {
      console.warn("⚠️ Aucun bouton '.button-resultat' trouvé");
      return null;
    }

    // Créer un map des boutons disponibles
    const availableButtons = {};
    for (const button of buttons) {
      const text = button.textContent.trim();
      availableButtons[text] = button;
    }

    console.log("🔍 Boutons disponibles:", Object.keys(availableButtons));

    // Définir la hiérarchie dégressive pour les boutons de points
    const fallbackHierarchy = {
      '3pts': ['3pts', '2pts', '1pt', 'NF'],
      '2pts': ['2pts', '1pt', 'NF'],
      '1pt': ['1pt', 'NF']
    };

    let targetButton = null;
    let finalButtonText = buttonText.trim();
    let wasModified = false;

    // Si le bouton demandé fait partie de la hiérarchie dégressive
    if (fallbackHierarchy[buttonText]) {
      console.log(`🔄 Recherche avec fallback pour "${buttonText}"`);
      
      for (const fallbackOption of fallbackHierarchy[buttonText]) {
        if (availableButtons[fallbackOption]) {
          targetButton = availableButtons[fallbackOption];
          finalButtonText = fallbackOption;
          
          if (fallbackOption !== buttonText) {
            wasModified = true;
            console.log(`⚠️ FALLBACK: "${buttonText}" non disponible, utilisation de "${fallbackOption}"`);
          } else {
            console.log(`✓ Bouton "${buttonText}" trouvé directement`);
          }
          break;
        }
      }
    } else {
      // Pour les autres boutons (NF, NC, SO, etc.), recherche directe
      if (availableButtons[buttonText]) {
        targetButton = availableButtons[buttonText];
        console.log(`✓ Bouton "${buttonText}" trouvé`);
      }
    }

    if (!targetButton) {
      console.warn(`⚠️ Bouton "${buttonText}" et ses alternatives non trouvés`);
      console.log("Boutons disponibles:", Object.keys(availableButtons));
      return null;
    }

    // Vérifier si le bouton n'est pas déjà pressé
    const isPressed = targetButton.getAttribute('aria-pressed') === 'true';
    if (isPressed) {
      console.log(`✓ Bouton "${finalButtonText}" déjà pressé, pas de clic nécessaire`);
      return wasModified ? {
        requested: buttonText,
        clicked: finalButtonText,
        modified: true,
        reason: 'already_pressed'
      } : null;
    }

    // Cliquer sur le bouton
    console.log(`🖱️ Clic sur le bouton "${finalButtonText}"...`);
    targetButton.click();
    await wait(300);
    console.log(`✅ Bouton "${finalButtonText}" cliqué avec succès`);

    // Retourner les informations sur la modification si elle a eu lieu
    if (wasModified) {
      return {
        requested: buttonText,
        clicked: finalButtonText,
        modified: true,
        reason: 'fallback_used'
      };
    }

    return null; // Pas de modification

  } catch (error) {
    console.error(`❌ Erreur lors du clic sur le bouton "${buttonText}":`, error);
    return null;
  }
}

// --- Fonctions Utilitaires ---

function findCodeElement(code) {
    const selector = `.exigenceItem[class*="datacy_exigence_${code}"]`;
    return document.querySelector(selector);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getStorageValue(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key]);
    });
  });
}

/**
 * Vérifie si un élément est visible dans le viewport
 */
function isElementInViewport(el) {
  const rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

async function waitForElement(selector, isXPath = false, timeout = 10000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const jobStatus = await getStorageValue('jobStatus');
    if (jobStatus === 'stopped') {
      throw new Error('Job arrêté par l\'utilisateur');
    }
    
    let element;
    if (isXPath) {
      element = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } else {
      element = document.querySelector(selector);
    }
    
    if (element) {
      return element;
    }
    await wait(250);
  }
  throw new Error(`Timeout: Impossible de trouver l'élément ${selector}`);
}

async function waitForElementToDisappear(selector, timeout = 10000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const jobStatus = await getStorageValue('jobStatus');
    if (jobStatus === 'stopped') {
      throw new Error('Job arrêté par l\'utilisateur');
    }
    
    if (!document.querySelector(selector)) {
      return true;
    }
    await wait(250);
  }
  throw new Error(`Timeout: L'élément ${selector} n'a pas disparu`);
}

/**
 * Fonction pour ajouter un résultat (succès ou erreur)
 * @param {string} code - Le code de l'exigence
 * @param {string} status - 'success' ou 'error'
 * @param {string} message - Message descriptif
 * @param {Object|null} buttonInfo - Informations sur les modifications de bouton
 */
async function addResult(code, status, message, buttonInfo) {
  console.log(`📝 Enregistrement résultat: ${code} - ${status} - ${message}`);
  
  // Construire le message enrichi si modification de bouton
  let enrichedMessage = message;
  if (buttonInfo && buttonInfo.modified) {
    enrichedMessage += ` | Bouton modifié: ${buttonInfo.requested} → ${buttonInfo.clicked}`;
  }
  
  return new Promise((resolve) => {
    chrome.storage.local.get(['jobResults'], (result) => {
      const results = result.jobResults || [];
      results.push({
        code: code,
        status: status,
        message: enrichedMessage,
        buttonModified: buttonInfo ? buttonInfo.modified : false,
        buttonRequested: buttonInfo ? buttonInfo.requested : null,
        buttonClicked: buttonInfo ? buttonInfo.clicked : null,
        timestamp: new Date().toISOString()
      });
      console.log(`💾 Total résultats enregistrés: ${results.length}`);
      chrome.storage.local.set({ jobResults: results }, resolve);
    });
  });
}

// --- Point d'entrée au chargement de la page ---

chrome.storage.local.get(['jobData', 'jobStatus'], (result) => {
  console.log("🔍 Vérification initiale au chargement de la page:", {
    url: window.location.href,
    hasJobData: !!result.jobData,
    jobStatus: result.jobStatus
  });
  
  if (result.jobData && result.jobStatus !== 'stopped') {
    console.log("✅ Un job est actif, vérification au chargement de la page...");
    setTimeout(() => {
      checkJobOnLoad();
    }, 1000);
  } else {
    console.log("ℹ️ Aucun job actif, en attente...");
  }
});

/**
 * Attend que la page soit complètement chargée et que le sélecteur principal soit présent
 * Combine plusieurs stratégies pour une détection robuste
 */
async function waitForPageLoad(timeout = 15000) {
    const startTime = Date.now();
    
    console.log("🔍 Stratégie 1: Attente du sélecteur principal...");
    
    // Stratégie 1: Attendre que le sélecteur principal des exigences existe
    let selectorFound = false;
    while (Date.now() - startTime < timeout) {
      const exigences = document.querySelectorAll('div.exigence-description');
      if (exigences.length > 0) {
        console.log(`✓ Sélecteur trouvé: ${exigences.length} exigences détectées`);
        selectorFound = true;
        break;
      }
      await wait(200);
    }
    
    if (!selectorFound) {
      console.warn("⚠️ Timeout sur la détection du sélecteur principal");
      // On continue quand même, peut-être que la page a un format différent
    }
    
    // Stratégie 2: Attendre que le DOM soit stable (pas de nouveaux éléments ajoutés)
    console.log("🔍 Stratégie 2: Vérification de la stabilité du DOM...");
    let previousCount = 0;
    let stableCount = 0;
    const stabilityChecks = 3; // Nombre de vérifications consécutives nécessaires
    
    for (let i = 0; i < 10; i++) { // Max 10 itérations (3 secondes)
      const currentCount = document.querySelectorAll('.exigenceItem').length;
      
      if (currentCount === previousCount && currentCount > 0) {
        stableCount++;
        console.log(`✓ DOM stable (${stableCount}/${stabilityChecks}): ${currentCount} éléments`);
        
        if (stableCount >= stabilityChecks) {
          console.log("✅ DOM confirmé stable");
          break;
        }
      } else {
        stableCount = 0; // Reset si le nombre change
        console.log(`↻ DOM en cours de chargement: ${currentCount} éléments`);
      }
      
      previousCount = currentCount;
      await wait(300);
    }
    
    // Stratégie 3: Attente de sécurité supplémentaire
    console.log("🔍 Stratégie 3: Délai de sécurité final...");
    await wait(2000); // 2 secondes de sécurité supplémentaires
    
    console.log("✅ Chargement de la page considéré comme terminé");
}