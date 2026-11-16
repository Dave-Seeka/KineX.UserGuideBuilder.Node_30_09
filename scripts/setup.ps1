$ErrorActionPreference = "Stop"
Push-Location (Join-Path $PSScriptRoot "..")
try {
    if (-not (Test-Path "config.json")) {
        Copy-Item "config.example.json" "config.json"
        Write-Host "Created config.json. Update baseUrl before capturing." -ForegroundColor Yellow
    }

    npm install
    npx playwright install chromium
    npm run validate
}
finally {
    Pop-Location
}
