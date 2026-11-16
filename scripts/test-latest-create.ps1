[CmdletBinding()]
param(
    [string]$Config = '.\config.json',
    [switch]$Headed,
    [switch]$NoPdf,
    [switch]$KeepOpen,
    [switch]$SkipStaticChecks
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Config)) {
    throw "Configuration file not found: $Config"
}

if (-not $SkipStaticChecks) {
    node .\src\cli.mjs validate `
        --flows .\flows\latest-create `
        --collections .\collections\latest-create

    if ($LASTEXITCODE -ne 0) {
        throw 'Latest-create flow validation failed.'
    }

    npm test
    if ($LASTEXITCODE -ne 0) {
        throw 'Guide-builder unit tests failed.'
    }

    npm run check
    if ($LASTEXITCODE -ne 0) {
        throw 'Guide-builder syntax checks failed.'
    }
}

$nodeArgs = @(
    '.\scripts\test-latest-create.mjs',
    '--config',
    $Config
)

if ($Headed) {
    $nodeArgs += '--headed'
}

if ($NoPdf) {
    $nodeArgs += '--no-pdf'
}

if ($KeepOpen) {
    $nodeArgs += '--keep-open'
}

node @nodeArgs
if ($LASTEXITCODE -ne 0) {
    throw 'Latest create regression run failed.'
}

Write-Host ''
Write-Host 'Latest create regression output:'
Write-Host '  .\output\latest-create-regression\index.html'
Write-Host '  .\output\latest-create-regression\combined\latest-create-regression\guide.html'
