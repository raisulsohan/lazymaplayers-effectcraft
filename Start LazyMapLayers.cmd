@echo off
rem LazyMapLayers for EffectCraft: starts EffectCraft (with its control channel) when it is not
rem running yet, and opens the LazyMapLayers panel in its own window. Close the panel window to stop.
setlocal
cd /d "%~dp0"
title LazyMapLayers for EffectCraft

where node >nul 2>nul
if errorlevel 1 (
  echo LazyMapLayers for EffectCraft needs Node.js 22 or newer: https://nodejs.org
  pause
  exit /b 1
)

if not exist "dist\host\lazymaplayers-effectcraft.jsx" (
  echo Building LazyMapLayers for EffectCraft...
  node tools\build.mjs
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

node app\server.mjs %*
if errorlevel 1 pause
