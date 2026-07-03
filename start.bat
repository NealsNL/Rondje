@echo off
title Routeplanner
cd /d "%~dp0"

echo Routeplanner starten...
echo.

REM 1) Start the BRouter routing server in its own window.
start "BRouter routeserver" cmd /k node scripts\start-brouter.mjs

REM 2) Start the web app in its own window.
start "Routeplanner app" cmd /k npm run dev

REM 3) Give both a moment to boot, then open the browser.
timeout /t 10 >nul
start "" http://localhost:3000

echo.
echo Twee vensters zijn geopend (routeserver + app). De browser opent zo.
echo Sluit die vensters om de Routeplanner te stoppen.
