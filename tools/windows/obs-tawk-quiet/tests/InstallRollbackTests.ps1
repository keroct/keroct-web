param([Parameter(Mandatory=$true)][string]$FixturePath, [Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$manage = Join-Path $PSScriptRoot '..\Manage.ps1'
foreach ($failure in @('registration','start','heartbeat','unknown-file')) {
    & {
        param($failure)
        $installRoot = Join-Path $OutputDirectory ("rollback-" + $failure)
        $capture = @{TaskName=$null; Heartbeat=0}
        function Register-ScheduledTask {
            $capture.TaskName = $args[$args.IndexOf('-TaskName') + 1]
            if ($failure -eq 'registration') { throw 'Injected registration failure' }
            if ($failure -eq 'unknown-file') {
                'User content' | Set-Content -LiteralPath (Join-Path $installRoot 'user-note.txt')
                throw 'Injected registration failure'
            }
            ScheduledTasks\Register-ScheduledTask @args
        }
        function Start-ScheduledTask {
            if ($failure -eq 'start') { throw 'Injected start failure' }
            ScheduledTasks\Start-ScheduledTask @args
        }
        function Test-Path {
            if ($failure -eq 'heartbeat' -and $args -contains (Join-Path $installRoot 'status.json') -and $capture.Heartbeat -lt 40) { $capture.Heartbeat++; return $false }
            Microsoft.PowerShell.Management\Test-Path @args
        }
        $failed = $false
        try { & $manage -Action Install -TawkExecutablePath $FixturePath -InstallRoot $installRoot }
        catch {
            if ($_.Exception.Message -notlike 'Installation failed:*rolled back*') { throw }
            $failed = $true
        }
        if (-not $failed) { throw 'Expected installation failure.' }
        Remove-Item Function:Register-ScheduledTask,Function:Start-ScheduledTask,Function:Test-Path
        if (Get-ScheduledTask -TaskName $capture.TaskName -ErrorAction SilentlyContinue) { throw 'Rollback left task.' }
        if (@(Get-Process -Name Keroct.Quiet -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $installRoot 'Keroct.Quiet.exe') }).Count) { throw 'Rollback left monitor.' }
        if ($failure -eq 'unknown-file') {
            if (@(Get-ChildItem -Force -LiteralPath $installRoot).Count -ne 1 -or
                (Get-Content -LiteralPath (Join-Path $installRoot 'user-note.txt')) -ne 'User content') { throw 'Unknown file changed.' }
            Remove-Item -LiteralPath (Join-Path $installRoot 'user-note.txt')
            Remove-Item -LiteralPath $installRoot
        }
        if (Test-Path -LiteralPath $installRoot) { throw 'Rollback left installation directory.' }
        try {
            & $manage -Action Install -TawkExecutablePath $FixturePath -InstallRoot $installRoot
            & $manage -Action Uninstall -InstallRoot $installRoot
        } finally {
            if (Test-Path -LiteralPath (Join-Path $installRoot 'install.json')) { & $manage -Action Uninstall -InstallRoot $installRoot }
        }
        if (Test-Path -LiteralPath $installRoot) { throw 'Retry uninstall left directory.' }
        Write-Output "PASS: $failure rollback, owned task/process/files cleanup and successful reinstall"
    } $failure
}
