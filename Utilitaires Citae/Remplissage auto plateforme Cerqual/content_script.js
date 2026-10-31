// État du script pour la page actuelle (remis à zéro à chaque chargement de page)
let isProcessing = false; // Évite les exécutions multiples
let stopRequested = false; // Mis à jour par le listener storage, évite de relire le storage à chaque attente
let pageCodes = null; // Codes présents sur la page, dans l'ordre d'affichage (rempli par scanPage)

// Réglages du scan de la liste virtualisée (React Virtualized).
// Audit du 31/10/2026 : la liste n'affiche que 3 à 6 sections à la fois, met à jour le DOM 17 à 99 ms
// après un scroll, et OUBLIE les hauteurs mesurées quand on remonte. On ne fait donc jamais de saut
// direct vers une position : on descend pas à pas en attendant le rendu réel.
const SCROLL_RATIO = 0.9; // Pas de scroll = 90% de la hauteur visible de la liste
const RENDER_TIMEOUT_MS = 1500; // Délai max d'attente du rendu après un scroll
const RENDER_SETTLE_MS = 150; // Marge après le rendu, le temps que les hauteurs soient mesurées
const MAX_SCAN_STEPS = 300;

console.log("Content Script chargé.");

/**
 * Écoute les changements dans le storage.
 * C'est ce qui démarre le job lorsque le popup sauvegarde les données.
 */
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local') return;

  // Si le job est arrêté, on lève le drapeau : les boucles d'attente s'interrompent d'elles-mêmes
  if (changes.jobStatus && changes.jobStatus.newValue === 'stopped') {
    console.log("🛑 Job arrêté, abandon du traitement");
    stopRequested = true;
    return;
  }

  // Nouveau job lancé depuis la popup (jobData et jobStatus 'starting' écrits ensemble).
  // Les réécritures de jobData pendant le job (tri par ordre de la page) ne relancent rien.
  if (changes.jobStatus && changes.jobStatus.newValue === 'starting' && changes.jobData && changes.jobData.newValue) {
    console.log("🚀 Nouveau job détecté ! Démarrage...");
    stopRequested = false;
    runJob();
  }
});

// Signale à la popup quand l'onglet passe en arrière-plan : Chrome y ralentit les timers
// et la liste virtualisée n'est plus rendue, le traitement se bloque.
document.addEventListener('visibilitychange', () => {
  if (isProcessing) {
    chrome.storage.local.set({ pageHidden: document.hidden });
  }
});

/**
 * Boucle principale : traite les lignes une à une tant qu'on reste sur la même page.
 * Quand une ligne demande une autre catégorie, on navigue et la boucle reprend au chargement suivant.
 */
async function runJob() {
  console.log("runJob appelé, isProcessing:", isProcessing);
  if (isProcessing) {
    console.log("Traitement déjà en cours, skip.");
    return;
  }
  isProcessing = true;
  await chrome.storage.local.set({ pageHidden: document.hidden });

  try {
    while (!stopRequested) {
      const { jobData, jobIndex, jobStatus } = await chrome.storage.local.get(['jobData', 'jobIndex', 'jobStatus']);
      console.log("Storage state:", { hasJobData: !!jobData, jobIndex, jobLength: jobData?.length, jobStatus });

      if (jobStatus === 'stopped') {
        console.log("Job arrêté, ne rien faire.");
        break;
      }
      if (!jobData) {
        console.log("Aucun job en cours.");
        break;
      }
      if (jobIndex >= jobData.length) {
        console.log("Travail terminé !");
        await chrome.storage.local.set({ jobStatus: 'completed', pageHidden: false });
        setTimeout(() => {
          chrome.storage.local.remove(["jobData", "jobIndex", "awaitingNavigation"]);
        }, 10000);
        break;
      }

      const leavingPage = await processJobLine(jobData, jobIndex);
      if (leavingPage) return; // La page va se recharger, le script reprendra au chargement
    }
  } catch (error) {
    console.error("❌ Erreur inattendue dans la boucle du job:", error);
  }
  isProcessing = false;
}

/**
 * Traite la ligne jobIndex. Renvoie true si on quitte la page (navigation vers une autre catégorie).
 */
async function processJobLine(jobData, jobIndex) {
  const currentRow = jobData[jobIndex];
  const code = String(currentRow[0] ?? '').trim(); // Colonne A (index 0)

  await chrome.storage.local.set({
    jobStatus: 'running',
    currentIndex: jobIndex,
    totalLines: jobData.length,
    currentCode: code
  });

  if (!code) {
    console.error("Ligne ignorée, pas de code", currentRow);
    await addResult(`Ligne ${jobIndex + 1}`, 'error', 'Code manquant en colonne A', null);
    await chrome.storage.local.set({ jobIndex: jobIndex + 1 });
    return false;
  }

  // URL attendue : /detail/<projectId>/rapport/rubriques/<catégorie>
  // Comparaison exacte de la catégorie (startsWith confondait par exemple QA et QAI)
  const category = code.split('.')[0];
  const currentPathParts = window.location.pathname.split('/');
  const projectId = currentPathParts[2];
  const currentCategory = decodeURIComponent(currentPathParts[5] || '');

  // Étape 1: Navigation
  if (currentCategory !== category) {
    console.log(`Navigation vers la catégorie ${category}...`);
    window.location.href = `https://outil-eval.cerqual-pro.net/detail/${projectId}/rapport/rubriques/${category}`;
    return true;
  }

  // Étape 2: Premier passage sur cette page → attendre le chargement, inventorier les codes,
  // puis trier les lignes de la catégorie dans l'ordre de la page (on ne fera plus que descendre)
  if (!pageCodes) {
    console.log("%c⏳ Attente du chargement de la page...", 'color: blue; font-weight: bold;');
    await waitForPageLoad();
    pageCodes = await scanPage();
    console.log(`%c✅ ${pageCodes.length} codes présents sur la page`, 'color: green; font-weight: bold;');
    await sortCategoryRowsByPageOrder(jobData, jobIndex, category);
    return false; // La boucle relit jobData, désormais trié
  }

  // Étape 3: Traitement de la ligne
  try {
    console.log(`Page correcte. Traitement du code ${code}...`);
    const result = await processRowOnPage(currentRow, code);
    console.log(`✅ Ligne ${code} traitée avec succès.`);
    await addResult(code, 'success', 'Traitement effectué avec succès', result.buttonInfo);
  } catch (error) {
    console.error(`❌ Erreur lors du traitement de la ligne ${code}:`, error);
    await addResult(code, 'error', error.message || 'Erreur inconnue', null);
  }
  await chrome.storage.local.set({ jobIndex: jobIndex + 1 });
  return false;
}

/**
 * Trie les lignes restantes de la catégorie courante (bloc contigu à partir de jobIndex,
 * la popup regroupe les lignes par catégorie) selon l'ordre d'affichage de la page.
 * Les codes absents de la page sont placés en fin de bloc, dans leur ordre d'origine.
 */
async function sortCategoryRowsByPageOrder(jobData, jobIndex, category) {
  const codeOf = row => String(row[0] ?? '').trim();
  let end = jobIndex;
  while (end < jobData.length && codeOf(jobData[end]).split('.')[0] === category) end++;

  const rank = row => {
    const index = pageCodes.indexOf(codeOf(row));
    return index === -1 ? Infinity : index;
  };
  const block = jobData.slice(jobIndex, end).map((row, i) => ({ row, i, rank: rank(row) }));
  block.sort((a, b) => (a.rank - b.rank) || (a.i - b.i));

  const sortedData = jobData.slice(0, jobIndex).concat(block.map(b => b.row), jobData.slice(end));
  await chrome.storage.local.set({ jobData: sortedData });
  console.log(`Lignes ${jobIndex + 1} à ${end} triées dans l'ordre de la page.`);
}

/**
 * Fait le travail "Selenium" sur la page.
 * Utilise colonne A pour le code, colonne J pour le bouton et colonne I pour le commentaire
 */
async function processRowOnPage(row, codeToFind) {
    const colJ = String(row[9] ?? '').trim(); // Bouton à cliquer (NF, NC, SO, etc.)
    const colI = row[8] != null ? String(row[8]) : ''; // Commentaire à insérer
    let buttonInfo = null; // Pour stocker les infos de modification du bouton

    console.log(`====================================================`);
    console.log(`%cTraitement pour: ${codeToFind}`, 'color: #00A8F3; font-size: 14px;');
    console.log(`Bouton cible: ${colJ}`);
    console.log(`Commentaire: ${colI.substring(0, 50)}...`);
    console.log(`====================================================`);

    // Code absent de l'inventaire de la page : inutile de scanner
    if (pageCodes.length > 0 && !pageCodes.includes(codeToFind)) {
      throw new Error(`Code ${codeToFind} introuvable sur cette page (n'existe pas dans la catégorie)`);
    }

    let codeDiv = await locateCodeElement(codeToFind);
    console.log(`%c✓ TROUVÉ ! (${codeToFind})`, 'color: green; font-weight: bold;');

    // Centrage instantané puis attente du rendu (l'élément peut être recréé par React)
    console.log("Centrage sur l'élément trouvé et début du remplissage...");
    const list = getList();
    const scrollBefore = list ? list.scrollTop : 0;
    const rendered = list ? waitForListUpdate(list) : null;
    codeDiv.scrollIntoView({ block: 'center' });
    if (list && list.scrollTop !== scrollBefore) {
      await rendered;
      await wait(RENDER_SETTLE_MS);
    }
    codeDiv = findCodeElement(codeToFind) || codeDiv;

    const parentContainer = codeDiv.closest('.exigence-description');
    if (!parentContainer) throw new Error(`Conteneur parent ".exigence-description" introuvable`);

    // --- Cliquer sur le bouton de résultat selon colonne J avec logique dégressive ---
    if (colJ !== '') {
      console.log(`🔘 Recherche du bouton "${colJ}" à cliquer...`);
      buttonInfo = await clickResultButton(parentContainer, colJ);
    } else {
      console.log("⚠️ Colonne J vide, pas de clic sur bouton de résultat");
    }

    // --- Remplissage du commentaire avec colonne I uniquement ---
    if (colI.trim() !== '') {
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

// --- Parcours de la liste virtualisée ---

function getList() {
  return document.querySelector('.ReactVirtualized__List');
}

/**
 * Codes actuellement rendus dans le DOM, dans l'ordre d'affichage.
 */
function getRenderedCodes() {
  return Array.from(document.querySelectorAll('.exigenceItem[class*="datacy_exigence_"]'))
    .map(item => Array.from(item.classList).find(c => c.startsWith('datacy_exigence_')))
    .filter(Boolean)
    .map(c => c.replace('datacy_exigence_', ''))
    .filter(Boolean); // Certaines sections portent une classe datacy_exigence_ sans code
}

/**
 * Résout dès que la liste modifie son DOM (rendu après scroll), ou après le délai max.
 */
function waitForListUpdate(list, timeout = RENDER_TIMEOUT_MS) {
  return new Promise(resolve => {
    const observer = new MutationObserver(() => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(true);
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeout);
    observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  });
}

/**
 * Scrolle la liste à la position demandée et attend le rendu.
 * Ne fait rien (et n'attend pas) si la position ne change pas.
 */
async function scrollListTo(list, top) {
  const before = list.scrollTop;
  const rendered = waitForListUpdate(list);
  list.scrollTop = top;
  if (list.scrollTop === before) return;
  await rendered;
  await wait(RENDER_SETTLE_MS);
}

/**
 * Descend d'un pas. Renvoie false si la fin de la liste est atteinte.
 */
async function scrollListDown(list) {
  const before = list.scrollTop;
  await scrollListTo(list, before + list.clientHeight * SCROLL_RATIO);
  if (list.scrollTop > before) return true;

  // Bloqué : fin de liste, ou hauteurs pas encore mesurées → on laisse un peu de temps et on réessaie
  await wait(300);
  await scrollListTo(list, before + list.clientHeight * SCROLL_RATIO);
  return list.scrollTop > before;
}

/**
 * Parcourt toute la page une fois pour inventorier les codes présents, dans l'ordre.
 * Laisse la liste en haut.
 */
async function scanPage() {
  const list = getList();
  if (!list) {
    console.warn("⚠️ Conteneur '.ReactVirtualized__List' introuvable, inventaire impossible");
    return [];
  }

  await scrollListTo(list, 0);
  const codes = [];
  for (let step = 0; step < MAX_SCAN_STEPS && !stopRequested; step++) {
    for (const code of getRenderedCodes()) {
      if (!codes.includes(code)) codes.push(code);
    }
    if (!(await scrollListDown(list))) break;
  }
  await scrollListTo(list, 0);
  console.log(`%c📋 Inventaire de la page (${codes.length} codes):`, 'color: yellow;', codes);
  return codes;
}

/**
 * Descend depuis la position courante jusqu'à trouver le code. Renvoie null en bas de liste.
 */
async function scanDownFor(code, list) {
  for (let step = 0; step < MAX_SCAN_STEPS; step++) {
    throwIfStopped();
    const element = findCodeElement(code);
    if (element) return element;
    if (!(await scrollListDown(list))) return null;
  }
  return null;
}

/**
 * Trouve l'élément du code. Les lignes étant triées dans l'ordre de la page, on continue
 * de descendre depuis la position courante. On ne repart du haut que si le code est au-dessus
 * des sections affichées, ou en dernier recours après un passage infructueux.
 */
async function locateCodeElement(code) {
  let element = findCodeElement(code);
  if (element) return element;

  const list = getList();
  if (!list) {
    throw new Error("Scan impossible: conteneur '.ReactVirtualized__List' introuvable.");
  }

  const targetRank = pageCodes.indexOf(code);
  const renderedRanks = getRenderedCodes().map(c => pageCodes.indexOf(c)).filter(i => i >= 0);
  if (targetRank !== -1 && renderedRanks.length > 0 && targetRank < Math.min(...renderedRanks)) {
    console.log(`Code ${code} au-dessus de la position actuelle → retour en haut`);
    await scrollListTo(list, 0);
  }

  element = await scanDownFor(code, list);
  if (element) return element;

  console.log(`%c⚠️ ${code} non trouvé en descendant, nouveau passage depuis le haut`, 'color: orange;');
  await scrollListTo(list, 0);
  element = await scanDownFor(code, list);
  if (element) return element;

  throw new Error(`Code ${code} introuvable sur cette page après un parcours complet`);
}

// --- Fonctions Utilitaires ---

function findCodeElement(code) {
  // ~= : correspondance exacte de la classe (class*= confondait QA.1.2 et QA.1.20)
  return document.querySelector(`.exigenceItem[class~="datacy_exigence_${code}"]`);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function throwIfStopped() {
  if (stopRequested) {
    throw new Error('Job arrêté par l\'utilisateur');
  }
}

async function waitForElement(selector, isXPath = false, timeout = 10000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    throwIfStopped();

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
    throwIfStopped();

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

/**
 * Attend que la liste des exigences soit affichée et stable.
 * Remplace l'ancienne attente fixe (1 s + 1,2 s + 2 s) : le scan qui suit attend lui-même chaque rendu.
 */
async function waitForPageLoad(timeout = 15000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      throwIfStopped();
      if (getList() && document.querySelector('.exigenceItem')) break;
      await wait(100);
    }
    if (!getList()) {
      console.warn("⚠️ Timeout sur la détection de la liste des exigences");
      return;
    }

    // Stabilité : même nombre de sections sur deux contrôles consécutifs (max ~2 s)
    let previousCount = -1;
    for (let i = 0; i < 10; i++) {
      const currentCount = document.querySelectorAll('.exigence-description').length;
      if (currentCount > 0 && currentCount === previousCount) break;
      previousCount = currentCount;
      await wait(200);
    }
    console.log("✅ Liste des exigences chargée");
}

// --- Point d'entrée au chargement de la page ---

chrome.storage.local.get(['jobData', 'jobStatus'], (result) => {
  console.log("🔍 Vérification initiale au chargement de la page:", {
    url: window.location.href,
    hasJobData: !!result.jobData,
    jobStatus: result.jobStatus
  });

  if (result.jobData && result.jobStatus !== 'stopped' && result.jobStatus !== 'completed') {
    console.log("✅ Un job est actif, reprise...");
    runJob();
  } else {
    console.log("ℹ️ Aucun job actif, en attente...");
  }
});
