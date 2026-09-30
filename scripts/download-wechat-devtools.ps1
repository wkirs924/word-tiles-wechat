$ErrorActionPreference = 'Stop'
$uri = 'https://dldir1v6.qq.com/WechatWebDev/release/be1ec64cf6184b0fa64091919793f068/wechat_devtools_2.02.2608070_win32_x64.exe'
$expectedHash = 'A502DEAD2E4FB6DCB0B5E157E1F2B9AC00C10A20F1940917112A1F8481ED5ED9'
$length = 190932384
$parts = 8
$dir = Join-Path (Split-Path -Parent $PSScriptRoot) '.tmp\devtools-parts'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$jobs = @()
for ($i = 0; $i -lt $parts; $i++) {
    $start = [int64][math]::Floor($length * $i / $parts)
    $end = [int64][math]::Floor($length * ($i + 1) / $parts) - 1
    $target = Join-Path $dir ("part-{0:D2}.bin" -f $i)
    $expected = $end - $start + 1
    if ((Test-Path -LiteralPath $target) -and (Get-Item -LiteralPath $target).Length -eq $expected) {
        Write-Output "Part $i already present"
        continue
    }
    $jobs += Start-Job -ArgumentList @($uri,$start,$end,$target,$expected,$i) -ScriptBlock {
        param($requestUri,$first,$last,$partPath,$wanted,$partNumber)
        & curl.exe --fail --location --retry 3 --connect-timeout 30 --max-time 1200 --range "$first-$last" --output $partPath $requestUri
        if ($LASTEXITCODE -ne 0) { throw "Part $partNumber curl exit code $LASTEXITCODE" }
        $actual = (Get-Item -LiteralPath $partPath).Length
        if ($actual -ne $wanted) { throw "Part $partNumber has $actual bytes, expected $wanted" }
        "Part $partNumber complete: $actual bytes"
    }
}
if ($jobs.Count) {
    $jobs | Wait-Job | Out-Null
    $messages = $jobs | Receive-Job
    $messages | ForEach-Object { Write-Output $_ }
    if (@($jobs | Where-Object State -ne 'Completed').Count) { throw 'One or more ranges failed; rerun to continue' }
}
$out = Join-Path (Split-Path -Parent $PSScriptRoot) '.tmp\wechat_devtools_2.02.2608070_verified.exe'
$stream = [IO.File]::Create($out)
try {
    for ($i = 0; $i -lt $parts; $i++) {
        $part = Join-Path $dir ("part-{0:D2}.bin" -f $i)
        $source = [IO.File]::OpenRead($part)
        try { $source.CopyTo($stream) } finally { $source.Dispose() }
    }
} finally { $stream.Dispose() }
$actualHash = (Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) { throw "SHA-256 mismatch: $actualHash" }
Write-Output "Verified: $out ($length bytes, SHA-256 $actualHash)"
