@echo off
title BRouter routeserver
cd /d "%~dp0"
node scripts\start-brouter.mjs
echo.
echo BRouter is gestopt. Sluit dit venster om af te sluiten.
pause >nul
