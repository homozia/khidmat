# Stops the Khidmat test environment. Your test data is kept.
# Run from this folder:   powershell -ExecutionPolicy Bypass -File .\stop-test-env.ps1
Set-Location -Path $PSScriptRoot
& node scripts/test-env.mjs stop
exit $LASTEXITCODE
