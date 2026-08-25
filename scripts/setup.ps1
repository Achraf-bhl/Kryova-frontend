#Requires -Version 5.1
<#
.SYNOPSIS
Kryova setup for Windows.
#>
$ErrorActionPreference = "Stop"

Write-Host "╔══════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   Kryova — Setup (Windows)       ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js is not installed." -ForegroundColor Red
    Write-Host ""
    Write-Host "Install it with:" -ForegroundColor Yellow
    Write-Host "  winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
    Write-Host "  Or download from https://nodejs.org/en/download/" -ForegroundColor Yellow
    exit 1
}

# Check npm
try {
    $npmVersion = npm --version
    Write-Host "✅ npm $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ npm not found." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Installing frontend dependencies…"
npm install
if ($LASTEXITCODE -ne 0) { exit 1 }

if (-not (Test-Path ".env.local")) {
    Write-Host ""
    $apiUrl = Read-Host "Enter the backend API URL [http://localhost:8000/api/v1]"
    if (-not $apiUrl) { $apiUrl = "http://localhost:8000/api/v1" }
    "NEXT_PUBLIC_API_URL=$apiUrl" | Out-File -FilePath ".env.local" -Encoding utf8NoBOM
    Write-Host "✅ Created .env.local" -ForegroundColor Green
}

Write-Host ""
Write-Host "Building the frontend…"
npm run build
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "╔═══════════════════════════════════╗" -ForegroundColor Green
Write-Host "║          Setup complete!           ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "To start the app:"
Write-Host "  npm run dev        (development)"
Write-Host "  npm start          (production, after build)"
Write-Host ""
Write-Host "Open http://localhost:3000 in your browser."
