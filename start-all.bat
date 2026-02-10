@echo off
REM start-all.bat - opens two cmd windows and starts server and client dev servers
REM Usage: double-click or run from command prompt in repo root: start-all.bat

SET ROOT=%~dp0


START "Client" cmd /k "cd /d "%ROOT%client" && npm run dev"nSTART "Server" cmd /k "cd /d "%ROOT%server" && npm run dev"