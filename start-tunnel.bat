@echo off
title YouTranscribe Local Server + Public Tunnel
echo ======================================================================
echo  Starting YouTranscribe Server (Localhost:3002) + Public HTTPS Tunnel
echo ======================================================================
echo.
echo Starting local node server in background...
start "YouTranscribe Server" cmd /k "node server.js"

echo Waiting for server to initialize...
timeout /t 3 /nobreak >nul

echo.
echo Starting Public Tunnel (localtunnel)...
echo Sharing your residential connection with the world.
echo ======================================================================
echo Copy the public URL below and open it on your phone or any browser:
echo (If prompted with 'friendly reminder', click 'Click to Continue')
echo ======================================================================
echo.

npx localtunnel --port 3002

pause

