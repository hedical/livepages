@echo off
chcp 65001 > nul
title Générateur CR - Serveur local
echo.
echo  ══════════════════════════════════════════════
echo   Générateur de CR — BTP Consultants
echo   Serveur local de test
echo  ══════════════════════════════════════════════
echo.
echo  Démarrage du serveur...
echo.
echo  Ouvrez ensuite : http://localhost:8000
echo  (Ctrl+C pour arrêter)
echo.

cd /d "%~dp0"

:: Essai avec npx serve (Node.js)
where npx >nul 2>&1
if %errorlevel% == 0 (
  echo  Utilisation de Node.js...
  npx --yes serve . -p 8000 -s
  goto fin
)

:: Fallback Python 3
where python >nul 2>&1
if %errorlevel% == 0 (
  echo  Utilisation de Python...
  python -m http.server 8000
  goto fin
)

echo  ERREUR : Node.js ou Python requis pour le serveur local.
echo  Pour déployer sans installation, poussez sur GitHub Pages.
echo.
pause

:fin
