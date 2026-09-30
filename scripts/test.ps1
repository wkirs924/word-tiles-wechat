$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodeExecutable = $env:WORD_TILES_NODE
if (-not $nodeExecutable) {
    if (Test-Path -LiteralPath $bundledNode) { $nodeExecutable = $bundledNode }
    else { $nodeExecutable = (Get-Command node -ErrorAction Stop).Source }
}
Push-Location -LiteralPath $projectRoot
try {
    & $nodeExecutable scripts/run-tests.mjs
    $testExit = $LASTEXITCODE
} finally { Pop-Location }
exit $testExit
