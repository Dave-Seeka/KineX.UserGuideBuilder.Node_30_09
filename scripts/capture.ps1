param(
    [Parameter(Mandatory)]
    [string]$Flow,
    [string]$Config = "config.json",
    [switch]$Headed,
    [switch]$NoPdf
)

$ErrorActionPreference = "Stop"
Push-Location (Join-Path $PSScriptRoot "..")
try {
    $arguments = @(".\src\cli.mjs", "capture", "--config", $Config, "--flow", $Flow)
    if ($Headed) { $arguments += "--headed" }
    if ($NoPdf) { $arguments += "--no-pdf" }
    & node @arguments
}
finally {
    Pop-Location
}
