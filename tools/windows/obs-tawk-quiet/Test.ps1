param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'test-output'))
$ErrorActionPreference = 'Stop'
$null = New-Item -ItemType Directory -Force -Path $OutputDirectory
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& (Join-Path $PSScriptRoot 'Build.ps1') -OutputDirectory $OutputDirectory
& $compiler /nologo /warnaserror /target:exe "/out:$(Join-Path $OutputDirectory 'PolicyTests.exe')" `
    (Join-Path $PSScriptRoot 'src\Policy.cs') (Join-Path $PSScriptRoot 'tests\PolicyTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Test compilation failed.' }
& (Join-Path $OutputDirectory 'PolicyTests.exe')
if ($LASTEXITCODE -ne 0) { throw 'Policy tests failed.' }
# Verify the actual executable has the Windows GUI subsystem: scheduled startup cannot flash a console.
$binary = [IO.File]::ReadAllBytes((Join-Path $OutputDirectory 'Keroct.Quiet.exe'))
$peOffset = [BitConverter]::ToInt32($binary,0x3c)
$subsystem = [BitConverter]::ToUInt16($binary,$peOffset + 24 + 68)
if ($subsystem -ne 2) { throw 'Monitor must be a windowless winexe (GUI subsystem).' }
Write-Output 'PASS: native/CLI build and windowless executable subsystem'
