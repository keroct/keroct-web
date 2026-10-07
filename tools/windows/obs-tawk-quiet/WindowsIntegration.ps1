param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'test-output\windows'))
$ErrorActionPreference = 'Stop'
# Explicit test entry point. Creates only silent fixture sessions / owned test processes.
if (Get-Process obs64 -ErrorAction SilentlyContinue) { throw 'Close OBS before isolated integration tests.' }
$OutputDirectory = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) ([guid]::NewGuid().ToString('N'))
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& (Join-Path $PSScriptRoot 'Build.ps1') -OutputDirectory $OutputDirectory
& $compiler /nologo /warnaserror /target:winexe "/out:$OutputDirectory\tawk.to.exe" (Join-Path $PSScriptRoot 'tests\AudioFixture.cs')
if ($LASTEXITCODE -ne 0) { throw 'Fixture build failed.' }
Copy-Item -LiteralPath "$OutputDirectory\tawk.to.exe" -Destination "$OutputDirectory\obs64.exe"
Copy-Item -LiteralPath "$OutputDirectory\tawk.to.exe" -Destination "$OutputDirectory\other-app.exe"
$sources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src') -Filter '*.cs' | ForEach-Object FullName)
& $compiler /nologo /warnaserror /target:exe /main:WindowsTests /reference:System.Web.Extensions.dll "/out:$OutputDirectory\WindowsTests.exe" `
    @sources (Join-Path $PSScriptRoot 'tests\WindowsTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Integration test build failed.' }
& "$OutputDirectory\WindowsTests.exe" $OutputDirectory
if ($LASTEXITCODE -ne 0) { throw 'Native Windows integration tests failed.' }
# Exercise the production installer / scheduler / diagnostic / uninstaller with the silent target.
$installRoot = Join-Path $OutputDirectory 'owned-installation'
$manifest = $null
try {
    & (Join-Path $PSScriptRoot 'Manage.ps1') -Action Install -TawkExecutablePath "$OutputDirectory\tawk.to.exe" -InstallRoot $installRoot
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $installRoot 'install.json') | ConvertFrom-Json
    $status = & (Join-Path $PSScriptRoot 'Manage.ps1') -Action Status -InstallRoot $installRoot | ConvertFrom-Json
    if (-not $status.ScheduledTaskRegistered -or $status.MonitorProcesses.Count -ne 1) { throw 'Scheduled startup failed.' }
    Write-Output 'PASS: actual Scheduled Task startup / read-only status'
    $configContent = [IO.File]::ReadAllText((Join-Path $installRoot 'config.json'))
    $null = & (Join-Path $PSScriptRoot 'Manage.ps1') -Action Status -InstallRoot $installRoot
    if ($configContent -ne [IO.File]::ReadAllText((Join-Path $installRoot 'config.json'))) { throw 'Status modified configuration.' }
    Write-Output 'PASS: status preserves configuration'
    [xml]$ownedTaskXml = Export-ScheduledTask -TaskName $manifest.TaskName
    $ownedTaskXml.Task.RegistrationInfo.Description = 'Foreign task marker for ownership refusal test'
    $null = Register-ScheduledTask -TaskName $manifest.TaskName -Xml $ownedTaskXml.OuterXml -Force
    $refused = $false
    try {
        try { & (Join-Path $PSScriptRoot 'Manage.ps1') -Action Uninstall -InstallRoot $installRoot }
        catch { if ($_.Exception.Message -like 'Scheduled Task ownership mismatch*') { $refused = $true } else { throw } }
    } finally {
        $ownedTaskXml.Task.RegistrationInfo.Description = "KEROCT ObsTawkQuiet owned installation $($manifest.InstallId)"
        $null = Register-ScheduledTask -TaskName $manifest.TaskName -Xml $ownedTaskXml.OuterXml -Force
    }
    if (-not $refused -or -not (Get-ScheduledTask -TaskName $manifest.TaskName)) { throw 'Foreign task was modified.' }
    Write-Output 'PASS: foreign task identity refused before uninstall mutations'
    $unknownFile = Join-Path $installRoot 'user-note.txt'
    'Preserve this user file.' | Set-Content -LiteralPath $unknownFile
    & (Join-Path $PSScriptRoot 'Manage.ps1') -Action Uninstall -InstallRoot $installRoot
    if (-not (Test-Path -LiteralPath $unknownFile)) { throw 'Unrecognized file was deleted.' }
    if (@(Get-ChildItem -Force -LiteralPath $installRoot).Count -ne 1) { throw 'Owned file residue.' }
    Remove-Item -LiteralPath $unknownFile
    Remove-Item -LiteralPath $installRoot
    Write-Output 'PASS: unknown files preserved'
    if ((Test-Path -LiteralPath $installRoot) -or (Get-ScheduledTask -TaskName $manifest.TaskName -ErrorAction SilentlyContinue)) { throw 'Installation residue.' }
    Write-Output 'PASS: actual uninstall removes owned task / process / files'
} finally {
    if (Test-Path -LiteralPath (Join-Path $installRoot 'install.json')) {
        & (Join-Path $PSScriptRoot 'Manage.ps1') -Action Uninstall -InstallRoot $installRoot
    }
}
