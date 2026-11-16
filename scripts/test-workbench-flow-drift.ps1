param(
    [string]$Config = "config.json",
    [switch]$Headed,
    [switch]$NoPdf
)

$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot ".."
$flows = @(
    "flows/026-property-navigator.json",
    "flows/028-property-boundary-filters.json",
    "flows/032-orchard-search.json",
    "flows/034-orchard-link-filters.json",
    "flows/040-block-navigator.json",
    "flows/052-multi-block-actions.json",
    "flows/062-map-navigation.json",
    "flows/064-map-auto-select.json",
    "flows/084-view-property-details.json"
)

Push-Location $root
try {
    foreach ($flow in $flows) {
        Write-Host "Running $flow" -ForegroundColor Cyan

        $arguments = @(
            ".\src\cli.mjs",
            "capture",
            "--config",
            $Config,
            "--flow",
            $flow
        )

        if ($Headed) { $arguments += "--headed" }
        if ($NoPdf) { $arguments += "--no-pdf" }

        & node @arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Flow failed with exit code $LASTEXITCODE: $flow"
        }
    }
}
finally {
    Pop-Location
}
