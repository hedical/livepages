document.addEventListener('DOMContentLoaded', function() {
  
  // 1. Récupérer les éléments HTML
  const wrongPageDiv = document.getElementById('wrong-page-message');
  const correctPageDiv = document.getElementById('correct-page-content');
  const jobStatusDiv = document.getElementById('job-status-container');
  const jobCompletedDiv = document.getElementById('job-completed-container');
  const fileUpload = document.getElementById('file-upload');
  const uploadButton = document.getElementById('upload-button');
  const fileLoadedSection = document.getElementById('file-loaded-section');
  const startJobButton = document.getElementById('start-job-button');
  const fileInfoText = document.getElementById('file-info-text');
  const stopJobButton = document.getElementById('stop-job-button');
  const currentCodeSpan = document.getElementById('current-code');
  const restartButton = document.getElementById('restart-button');
  
  // Variable pour stocker les données chargées
  let loadedData = null;

  // 2. Définir les parties de l'URL
  const urlPart1 = "outil-eval.cerqual-pro.net/detail/";
  const urlPart2 = "/rapport/rubriques/";

  // 3. Écouter les changements de statut en temps réel
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      console.log("Storage changed:", changes);
      updateJobStatus();
    }
  });

  // 4. Fonction pour mettre à jour l'affichage du statut
  function updateJobStatus() {
    chrome.storage.local.get(['jobStatus', 'currentIndex', 'totalLines', 'jobData', 'currentCode', 'needsManualScroll', 'jobResults', 'pageHidden'], (result) => {
      const { jobStatus, currentIndex, totalLines, jobData, currentCode, needsManualScroll, jobResults, pageHidden } = result;

      console.log("Update status:", { jobStatus, currentIndex, totalLines, hasJobData: !!jobData, currentCode, needsManualScroll });

      if (jobData && (jobStatus === 'running' || jobStatus === 'starting')) {
        // Afficher le statut en cours
        wrongPageDiv.style.display = 'none';
        correctPageDiv.style.display = 'none';
        jobCompletedDiv.style.display = 'none';
        jobStatusDiv.style.display = 'block';
        
        const currentIdx = currentIndex !== undefined ? currentIndex : 0;
        const total = totalLines || jobData.length;
        
        document.getElementById('status-progress').textContent = 
          `Ligne ${currentIdx + 1} / ${total}`;
        
        // Afficher le code en cours avec gestion du cas vide
        if (currentCode && currentCode.trim() !== '') {
          currentCodeSpan.textContent = currentCode;
          currentCodeSpan.parentElement.style.display = 'block';
        } else {
          // Si pas de code encore, essayer de le récupérer depuis jobData
          if (jobData[currentIdx] && jobData[currentIdx][0]) { // MODIFIÉ: index 0 = colonne A
            currentCodeSpan.textContent = jobData[currentIdx][0];
            currentCodeSpan.parentElement.style.display = 'block';
          } else {
            // Cacher la ligne du code si vraiment rien
            currentCodeSpan.parentElement.style.display = 'none';
          }
        }
        
        // Afficher l'alerte de scroll manuel si nécessaire
        const manualScrollAlert = document.getElementById('manual-scroll-alert');
        if (needsManualScroll) {
          manualScrollAlert.style.display = 'block';
        } else {
          manualScrollAlert.style.display = 'none';
        }

        // Afficher l'alerte si l'onglet CERQUAL est en arrière-plan
        document.getElementById('hidden-tab-alert').style.display = pageHidden ? 'block' : 'none';
      } else if (jobStatus === 'completed' || jobStatus === 'stopped') {
        // Afficher le message de fin avec synthèse
        wrongPageDiv.style.display = 'none';
        correctPageDiv.style.display = 'none';
        jobStatusDiv.style.display = 'none';
        jobCompletedDiv.style.display = 'block';
        
        // Adapter le titre selon le statut
        const completionTitle = document.getElementById('completion-title');
        if (jobStatus === 'stopped') {
          completionTitle.textContent = '⏸️ Traitement arrêté';
        } else {
          completionTitle.textContent = '✅ Traitement terminé !';
        }
        
        console.log("📊 JobResults récupérés:", jobResults);
        
        // Afficher la synthèse
        if (jobResults && jobResults.length > 0) {
          displayResultsSummary(jobResults);
        } else {
          // Si pas de résultats, afficher un message par défaut
          document.getElementById('results-summary').innerHTML = 
            '<p class="info-text">Aucun résultat enregistré</p>';
        }
      } else {
        // Pas de job en cours, afficher l'interface normale
        checkPageAndShowUpload();
      }
    });
  }
  
  // Fonction pour afficher la synthèse des résultats
  function displayResultsSummary(results) {
    const summaryDiv = document.getElementById('results-summary');
    
    console.log("📊 Affichage de la synthèse:", results);
    
    if (!results || results.length === 0) {
      summaryDiv.innerHTML = '<p class="info-text">Aucun résultat enregistré</p>';
      return;
    }
    
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const modifiedButtonCount = results.filter(r => r.buttonModified === true).length;
    
    let html = `
      <div class="summary-stats">
        <div class="stat-item success">
          <span class="stat-icon">✅</span>
          <span class="stat-number">${successCount}</span>
          <span class="stat-label">Réussis</span>
        </div>
        <div class="stat-item error">
          <span class="stat-icon">❌</span>
          <span class="stat-number">${errorCount}</span>
          <span class="stat-label">Échecs</span>
        </div>
        ${modifiedButtonCount > 0 ? `
        <div class="stat-item warning">
          <span class="stat-icon">⚠️</span>
          <span class="stat-number">${modifiedButtonCount}</span>
          <span class="stat-label">Boutons modifiés</span>
        </div>
        ` : ''}
      </div>
    `;
    
    // Liste détaillée des résultats
    html += '<div class="results-detail">';
    
    // Boutons modifiés (si présents)
    const modifiedResults = results.filter(r => r.buttonModified === true);
    if (modifiedResults.length > 0) {
      html += '<details class="results-section warning-section" open>';
      html += `<summary class="results-section-title">⚠️ Boutons modifiés (${modifiedResults.length})</summary>`;
      html += '<ul class="results-list">';
      modifiedResults.forEach(r => {
        html += `<li class="result-item warning">
          <strong>${r.code}</strong> - ${r.buttonRequested} → ${r.buttonClicked}
        </li>`;
      });
      html += '</ul></details>';
    }
    
    // Succès
    if (successCount > 0) {
      html += '<details class="results-section success-section">';
      html += `<summary class="results-section-title">✅ Codes réussis (${successCount})</summary>`;
      html += '<ul class="results-list">';
      results.filter(r => r.status === 'success').forEach(r => {
        html += `<li class="result-item success"><strong>${r.code}</strong> - ${r.message}</li>`;
      });
      html += '</ul></details>';
    }
    
    // Erreurs
    if (errorCount > 0) {
      html += '<details class="results-section error-section" open>';
      html += `<summary class="results-section-title">❌ Codes échoués (${errorCount})</summary>`;
      html += '<ul class="results-list">';
      results.filter(r => r.status === 'error').forEach(r => {
        html += `<li class="result-item error"><strong>${r.code}</strong> - ${r.message}</li>`;
      });
      html += '</ul></details>';
    }
    
    html += '</div>';
    
    // Bouton pour télécharger le rapport
    html += '<button id="download-report-button" class="download-button">📥 Télécharger le rapport détaillé</button>';
    
    summaryDiv.innerHTML = html;
    
    // Attacher l'événement au bouton
    setTimeout(() => {
      const downloadBtn = document.getElementById('download-report-button');
      if (downloadBtn) {
        downloadBtn.addEventListener('click', () => downloadReport(results));
      }
    }, 100);
  }
  
  // Fonction pour télécharger le rapport en CSV
  function downloadReport(results) {
    let csv = 'Code,Statut,Message,Bouton demandé,Bouton cliqué,Modifié,Horodatage\n';
    results.forEach(r => {
      const status = r.status === 'success' ? 'Réussi' : 'Échec';
      const message = (r.message || '').replace(/"/g, '""'); // Échapper les guillemets
      const buttonRequested = r.buttonRequested || '-';
      const buttonClicked = r.buttonClicked || '-';
      const modified = r.buttonModified ? 'Oui' : 'Non';
      const timestamp = new Date(r.timestamp).toLocaleString('fr-FR');
      csv += `"${r.code}","${status}","${message}","${buttonRequested}","${buttonClicked}","${modified}","${timestamp}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rapport_autocerqual_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // 5. Fonction pour vérifier la page et afficher l'upload
  function checkPageAndShowUpload() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      const currentTab = tabs[0];
      
      if (currentTab && currentTab.url) {
        const currentUrl = currentTab.url;

        if (currentUrl.includes(urlPart1) && currentUrl.includes(urlPart2)) {
          // C'est la bonne page !
          wrongPageDiv.style.display = 'none';
          correctPageDiv.style.display = 'block';
          jobStatusDiv.style.display = 'none';
          jobCompletedDiv.style.display = 'none';
        } else {
          // Ce n'est pas la bonne page
          wrongPageDiv.style.display = 'block';
          correctPageDiv.style.display = 'none';
          jobStatusDiv.style.display = 'none';
          jobCompletedDiv.style.display = 'none';
        }
      } else {
        wrongPageDiv.style.display = 'block';
        correctPageDiv.style.display = 'none';
        jobStatusDiv.style.display = 'none';
        jobCompletedDiv.style.display = 'none';
      }
    });
  }

  // 6. Vérifier le statut au chargement
  updateJobStatus();

  // Charge la librairie Excel à la demande (1,3 Mo : la charger à chaque ouverture ralentissait la popup)
  function loadXlsxLibrary() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'xlsx.full.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error("Impossible de charger la librairie Excel"));
      document.head.appendChild(script);
    });
  }

  // 7. Gestion de l'upload
  fileUpload.addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    const xlsxReady = loadXlsxLibrary();

    reader.onload = async function(e) {
      const data = e.target.result;

      try {
        await xlsxReady;
      } catch (error) {
        console.error(error);
        alert(error.message);
        return;
      }

      console.log("Fichier lu, parsing Excel...");
      
      // 1. Lire le fichier Excel
      const workbook = XLSX.read(data, { type: 'array' });
      
      // 2. Viser la première feuille
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // 3. Convertir la feuille en tableau de tableaux
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      console.log(`Excel parsé: ${rows.length} lignes`);
      
      if (!rows || rows.length < 2) {
          console.error("Erreur de lecture Excel ou fichier vide.");
          alert("Fichier vide ou invalide !");
          return;
      }

      // 4. On enlève la ligne d'en-tête
      const dataRows = rows.slice(1);
      
      // NOUVEAU: Filtrer les lignes qui n'ont pas de code en colonne A
      const validRows = dataRows.filter(row => row && row[0] && row[0].toString().trim() !== '');
      
      console.log(`${dataRows.length} lignes totales, ${validRows.length} lignes valides avec un code en colonne A`);
      
      if (validRows.length === 0) {
          alert("Aucune ligne valide trouvée ! Vérifiez que la colonne A contient des codes.");
          return;
      }
      
      // Codes en texte (une cellule numérique faisait planter code.split), puis regroupement par
      // catégorie dans l'ordre de première apparition : chaque page de catégorie n'est chargée qu'une fois.
      // L'ordre à l'intérieur d'une catégorie est ensuite aligné sur la page par le content script.
      const categoryOrder = [];
      validRows.forEach(row => {
        row[0] = String(row[0]).trim();
        const category = row[0].split('.')[0];
        if (!categoryOrder.includes(category)) categoryOrder.push(category);
      });
      const groupedRows = categoryOrder.flatMap(category =>
        validRows.filter(row => row[0].split('.')[0] === category)
      );

      // Stocker les données en mémoire (pas encore dans le storage)
      loadedData = groupedRows;
      
      // Afficher les infos et le bouton de lancement
      fileInfoText.textContent = `✔ Fichier chargé : ${validRows.length} lignes à traiter`;
      uploadButton.style.display = 'none';
      fileLoadedSection.style.display = 'block';
      
      console.log("Fichier prêt. En attente du clic sur 'Lancer'.");
      console.log("Aperçu des 3 premières lignes:");
      validRows.slice(0, 3).forEach((row, idx) => {
        console.log(`  Ligne ${idx + 1}: Code="${row[0]}", Bouton="${row[9]}", Commentaire="${row[8] ? row[8].substring(0, 30) + '...' : 'vide'}"`);
      });
    };
    
    // LIRE LE FICHIER COMME UN "ArrayBuffer"
    reader.readAsArrayBuffer(file);
  });
  
  // 8. Gestion du clic sur "Lancer le remplissage"
  startJobButton.addEventListener('click', function() {
    if (!loadedData) {
      console.error("Aucune donnée chargée !");
      return;
    }
    
    console.log("🚀 Lancement du job avec", loadedData.length, "lignes");
    
    // Maintenant on sauvegarde dans le storage pour déclencher le job
    // ET on initialise jobResults
    chrome.storage.local.set({ 
      jobData: loadedData, 
      jobIndex: 0,
      jobStatus: 'starting',
      currentIndex: 0,
      totalLines: loadedData.length,
      currentCode: '',
      jobResults: [] // Initialiser le tableau de résultats
    }, function() {
      console.log("✓ Job démarré !");
      // La popup va se mettre à jour automatiquement via le listener
      updateJobStatus();
    });
  });
  
  // 9. Gestion du bouton "Arrêter"
  stopJobButton.addEventListener('click', function() {
    console.log("🛑 Arrêt du job demandé");
    
    chrome.storage.local.set({ 
      jobStatus: 'stopped'
    }, function() {
      console.log("✓ Job arrêté");
      // Ne pas nettoyer jobResults, juste les données temporaires
      setTimeout(() => {
        chrome.storage.local.remove(['jobData', 'jobIndex', 'currentIndex', 'totalLines', 'currentCode', 'needsManualScroll', 'awaitingNavigation', 'pageHidden']);
        updateJobStatus();
      }, 1000);
    });
  });
  
  // 10. Gestion du bouton "Recommencer"
  restartButton.addEventListener('click', function() {
    console.log("🔄 Recommencer demandé");
    
    // Réinitialiser complètement l'extension
    chrome.storage.local.clear(function() {
      console.log("✓ Extension réinitialisée");
      
      // Réinitialiser l'interface
      loadedData = null;
      fileUpload.value = '';
      uploadButton.style.display = 'inline-block';
      fileLoadedSection.style.display = 'none';
      fileInfoText.textContent = '';
      
      // Mettre à jour l'affichage
      updateJobStatus();
    });
  });

});