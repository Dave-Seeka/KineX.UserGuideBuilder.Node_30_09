param(
    [string]$Config = "config.json",
    [string]$Path,
    [switch]$Fresh
)

$ErrorActionPreference = "Stop"
Push-Location (Join-Path $PSScriptRoot "..")
try {
    $arguments = @(
        ".\src\cli.mjs",
        "auth",
        "--config",
        $Config
    )

    if (-not [string]::IsNullOrWhiteSpace($Path)) {
        $arguments += @("--path", $Path)
    }

    if ($Fresh) {
        $arguments += "--fresh"
    }

    node @arguments
}
finally {
    Pop-Location
}
