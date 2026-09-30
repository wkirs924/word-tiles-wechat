$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$node=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if(-not(Test-Path -LiteralPath $node)){$node=(Get-Command node -ErrorAction Stop).Source}
$env:LOCAL_MODE='1'
Push-Location -LiteralPath $root
try{& $node apps/server/src/main.ts;$code=$LASTEXITCODE}finally{Pop-Location}
exit $code
