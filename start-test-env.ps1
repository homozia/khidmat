# Starts the Khidmat test environment on Windows: database, API, provider and staff website.
# Run from this folder:   powershell -ExecutionPolicy Bypass -File .\start-test-env.ps1
# Safe to run again at any time: your test data is kept.
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

Write-Host "Khidmat test environment" -ForegroundColor Cyan
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "PROBLEM: Node.js is not installed." -ForegroundColor Red
  Write-Host " - Install Node.js 22 LTS from https://nodejs.org (the 'LTS' button), then close and reopen PowerShell."
  exit 1
}
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker -and $env:KHIDMAT_NO_DOCKER -ne '1') {
  Write-Host "PROBLEM: Docker Desktop is not installed." -ForegroundColor Red
  Write-Host " - Install it from https://www.docker.com/products/docker-desktop/ , restart the laptop, open Docker Desktop, then run this again."
  exit 1
}
& node scripts/test-env.mjs start
exit $LASTEXITCODE
