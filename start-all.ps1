# start-all.ps1 - Open two PowerShell windows and start server and client dev servers
# Usage: Right-click and "Run with PowerShell" or run `./start-all.ps1` from PowerShell

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Starting server in new PowerShell window..."
Start-Process -FilePath "powershell" -ArgumentList (
    "-NoExit",
    "-Command",
    "Set-Location -LiteralPath '$root\\server'; npm run dev"
) -WorkingDirectory "$root\server"

Start-Sleep -Milliseconds 500

Write-Host "Starting client in new PowerShell window..."
Start-Process -FilePath "powershell" -ArgumentList (
    "-NoExit",
    "-Command",
    "Set-Location -LiteralPath '$root\\client'; npm run dev"
) -WorkingDirectory "$root\client"

Write-Host "Started both processes. Check the new windows for logs."