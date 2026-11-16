# ERASES all test bookings, files, refunds and ledger entries and loads fresh synthetic test data.
# It asks you to type the database name first. Only works on test databases (names ending in _dev, _test or _sandbox).
# Run from this folder:   powershell -ExecutionPolicy Bypass -File .\reset-test-data.ps1
Set-Location -Path $PSScriptRoot
& node scripts/test-env.mjs reset
exit $LASTEXITCODE
