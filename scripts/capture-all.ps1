param(
    [string]$Flows = "flows",
    [string]$Config = "config.json",
    [switch]$Headed,
    [switch]$NoPdf
)

$ErrorActionPreference = "Stop"
Push-Location (Join-Path $PSScriptRoot "..")
try {
    $arguments = @(".\src\cli.mjs", "capture-all", "--config", $Config, "--flows", $Flows)
    if ($Headed) { $arguments += "--headed" }
    if ($NoPdf) { $arguments += "--no-pdf" }
    & node @arguments
}
finally {
    Pop-Location
}
