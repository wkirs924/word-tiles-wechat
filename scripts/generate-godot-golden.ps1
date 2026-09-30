$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$reference = Join-Path $root 'reference\godot'
$isolated = Join-Path $root '.tmp\godot-m1-golden'
$fixture = Join-Path $root 'tests\fixtures\godot-m1-golden.json'
New-Item -ItemType Directory -Force -Path $isolated | Out-Null
foreach ($part in @('core','application','projection')) {
    Copy-Item -LiteralPath (Join-Path $reference $part) -Destination $isolated -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $reference 'project.godot') -Destination $isolated -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'godot_m1_golden.gd') -Destination (Join-Path $isolated 'golden.gd') -Force
$oldPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $output = & 'C:\Users\cyr\bin\godot_console.exe' --headless --path $isolated --log-file (Join-Path $isolated 'godot.log') --script res://golden.gd 2>&1
} finally { $ErrorActionPreference = $oldPreference }
if ($LASTEXITCODE -ne 0) { throw ($output -join "`n") }
$line = $output | Where-Object { $_ -like 'GOLDEN_JSON:*' } | Select-Object -Last 1
if (-not $line) { throw ($output -join "`n") }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $fixture) | Out-Null
[System.IO.File]::WriteAllText($fixture, $line.Substring('GOLDEN_JSON:'.Length), [System.Text.UTF8Encoding]::new($false))
Write-Output "Godot golden fixture written: $fixture"
