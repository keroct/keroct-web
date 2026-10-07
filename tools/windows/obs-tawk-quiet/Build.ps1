param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'build'))
$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem) { throw '64-bit Windows is required.' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.x compiler is required (included in Windows 10/11).' }
$null = New-Item -ItemType Directory -Force -Path $OutputDirectory
$sources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src') -Filter '*.cs' | ForEach-Object FullName)
foreach ($target in @(@{Name='Keroct.Quiet.exe';Kind='winexe'}, @{Name='Keroct.Quiet.Cli.exe';Kind='exe'})) {
    & $compiler /nologo /warnaserror /optimize+ /platform:x64 "/target:$($target.Kind)" "/out:$(Join-Path $OutputDirectory $target.Name)" /reference:System.Web.Extensions.dll @sources
    if ($LASTEXITCODE -ne 0) { throw "Compilation failed: $($target.Name)" }
}
