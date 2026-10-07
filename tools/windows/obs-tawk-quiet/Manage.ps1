param(
    [ValidateSet('Install','Status','Uninstall')][string]$Action = 'Status',
    [string]$TawkExecutablePath,
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'KEROCT\ObsTawkQuiet')
)
$ErrorActionPreference = 'Stop'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if ($InstallRoot -eq [IO.Path]::GetPathRoot($InstallRoot).TrimEnd('\')) { throw 'An installation directory is required.' }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$manifestPath = Join-Path $InstallRoot 'install.json'
function Assert-RegularDirectory {
    $item = Get-Item -LiteralPath $InstallRoot
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Installation directory must be a regular directory.' }
    $parent = $item.Parent
    while ($parent) {
        if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Installation parents must not be reparse points.' }
        $parent = $parent.Parent
    }
}
function Read-Manifest {
    Assert-RegularDirectory
    $m = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    $id = [guid]::Empty
    if (-not [guid]::TryParse($m.InstallId, [ref]$id) -or $m.OwnerSid -ne $sid -or $m.InstallRoot -ne $InstallRoot -or
        $m.TaskName -ne "KEROCT-ObsTawkQuiet-$($m.InstallId)" -or $m.Schema -ne 1) { throw 'Installation ownership mismatch; nothing changed.' }
    return $m
}
function Find-OwnedTask($manifest) {
    $task = Get-ScheduledTask -TaskName $manifest.TaskName -TaskPath '\' -ErrorAction SilentlyContinue
    if ($task) {
        # The CIM view can normalize SID to account name / escape backslashes; compare authoritative XML.
        [xml]$xml = Export-ScheduledTask -TaskName $manifest.TaskName -TaskPath '\'
        $actions = @($xml.Task.Actions.Exec)
        if ($actions.Count -ne 1 -or $xml.Task.Actions.ChildNodes.Count -ne 1 -or $actions[0].Command -ne (Join-Path $InstallRoot 'Keroct.Quiet.exe') -or
            $actions[0].Arguments -ne ('--monitor "' + (Join-Path $InstallRoot 'config.json') + '"') -or
            $xml.Task.RegistrationInfo.Description -ne "KEROCT ObsTawkQuiet owned installation $($manifest.InstallId)" -or
            $xml.Task.Principals.Principal.UserId -ne $sid) { throw 'Scheduled Task ownership mismatch; nothing changed.' }
    }
    return $task
}
function Invoke-Cli($command) {
    & (Join-Path $InstallRoot 'Keroct.Quiet.Cli.exe') $command (Join-Path $InstallRoot 'config.json')
    if ($LASTEXITCODE -ne 0) { throw "Utility command failed ($LASTEXITCODE); installation retained." }
}
function Stop-OwnedInstallation($manifest, $task) {
    # Disable only our positively identified task before stopping, avoiding an automatic restart race.
    if ($task) { $null = Disable-ScheduledTask -TaskName $manifest.TaskName -TaskPath '\' }
    Invoke-Cli '--stop'
    $journal = Join-Path $InstallRoot 'journal.json'
    if ((Test-Path -LiteralPath $journal) -and @(Get-Content -Raw -LiteralPath $journal | ConvertFrom-Json).Count -gt 0) {
        throw 'Unresolved session ownership remains; files retained for diagnosis. Task is disabled. No forced unmute was performed.'
    }
    for ($i=0; $i -lt 40; $i++) {
        $remaining = @(Get-Process -Name 'Keroct.Quiet' -ErrorAction SilentlyContinue | Where-Object {
            try { $_.Path -eq (Join-Path $InstallRoot 'Keroct.Quiet.exe') } catch { $false }
        })
        if ($remaining.Count -eq 0) { break }; Start-Sleep -Milliseconds 100
    }
    if ($remaining.Count -gt 0) { throw 'Owned monitor still running; files retained. No other process was terminated.' }
    if ($task) { Unregister-ScheduledTask -TaskName $manifest.TaskName -TaskPath '\' -Confirm:$false }
}
function Remove-OwnedFiles($ownedNames) {
    Assert-RegularDirectory
    foreach ($name in $ownedNames) {
        $path = Join-Path $InstallRoot $name
        if (Test-Path -LiteralPath $path) {
            $item = Get-Item -LiteralPath $path
            if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Unexpected file type preserved: $path" }
        }
    }
    foreach ($name in $ownedNames) {
        $path = Join-Path $InstallRoot $name; if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
    }
    if (@(Get-ChildItem -Force -LiteralPath $InstallRoot).Count -eq 0) { Remove-Item -LiteralPath $InstallRoot }
    else { Write-Output 'Unrecognized files preserved in the installation directory.' }
}
if ($Action -eq 'Install') {
    if (Test-Path -LiteralPath $InstallRoot) { throw "Installation directory already exists: $InstallRoot. Use Status or Uninstall first; existing files were preserved." }
    if (-not $TawkExecutablePath) {
        $candidates = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^tawk(\.to)?( desktop)?$' } |
            ForEach-Object { try { $_.Path } catch {} } | Where-Object { $_ } | Sort-Object -Unique)
        if ($candidates.Count -eq 1) { $TawkExecutablePath = $candidates[0] }
        else {
            Add-Type -AssemblyName System.Windows.Forms
            $picker = New-Object Windows.Forms.OpenFileDialog
            $picker.Title = 'Select the tawk.to Desktop executable (tawk.to.exe)'
            $picker.Filter = 'Executable (*.exe)|*.exe'
            try { if ($picker.ShowDialog() -ne 'OK') { throw 'Installation cancelled.' }; $TawkExecutablePath = $picker.FileName }
            finally { $picker.Dispose() }
        }
    }
    $exe = Get-Item -LiteralPath $TawkExecutablePath
    if ($exe.PSIsContainer -or $exe.Name -notmatch '^tawk(\.to)?( desktop)?\.exe$' -or ($exe.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Select the actual tawk.to Desktop executable; other applications cannot be targets.'
    }
    $targetPath = $exe.FullName
    $id = [guid]::NewGuid().ToString('D')
    $manifest = [ordered]@{Schema=1;InstallId=$id;OwnerSid=$sid;InstallRoot=$InstallRoot;TaskName="KEROCT-ObsTawkQuiet-$id"}
    # Build in a disposable staging directory before creating an installation or task.
    $stage = Join-Path ([IO.Path]::GetTempPath()) "keroct-quiet-build-$id"
    $rootCreated = $false
    $registrationAttempted = $false
    $startAttempted = $false
    $createdNames = New-Object 'Collections.Generic.List[string]'
    try {
        & (Join-Path $PSScriptRoot 'Build.ps1') -OutputDirectory $stage
        $null = New-Item -ItemType Directory -Path $InstallRoot
        $rootCreated = $true
        Assert-RegularDirectory
        $createdNames.Add('install.json')
        $manifest | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $manifestPath
        foreach ($name in @('Keroct.Quiet.exe','Keroct.Quiet.Cli.exe')) { $createdNames.Add($name); Copy-Item -LiteralPath (Join-Path $stage $name) -Destination (Join-Path $InstallRoot $name) }
        $createdNames.Add('config.json')
        [ordered]@{InstallId=$id;OwnerSid=$sid;TawkPaths=@($targetPath);PollMilliseconds=1000} | ConvertTo-Json |
            Set-Content -Encoding UTF8 -LiteralPath (Join-Path $InstallRoot 'config.json')
        foreach ($name in @('Manage.ps1','Status.cmd','Uninstall.cmd')) { $createdNames.Add($name); Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $InstallRoot $name) }
        $actionDef = New-ScheduledTaskAction -Execute (Join-Path $InstallRoot 'Keroct.Quiet.exe') -Argument ('--monitor "' + (Join-Path $InstallRoot 'config.json') + '"') -WorkingDirectory $InstallRoot
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $sid
        $principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
            -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
        if (Get-ScheduledTask -TaskName $manifest.TaskName -TaskPath '\' -ErrorAction SilentlyContinue) { throw 'Task name already exists; existing task preserved.' }
        $registrationAttempted = $true
        $null = Register-ScheduledTask -TaskName $manifest.TaskName -TaskPath '\' -Action $actionDef -Trigger $trigger -Principal $principal -Settings $settings `
            -Description "KEROCT ObsTawkQuiet owned installation $id"
        $startAttempted = $true
        Start-ScheduledTask -TaskName $manifest.TaskName -TaskPath '\'
        # Wait for a heartbeat, so successful registration alone is not reported as successful startup.
        $heartbeat = Join-Path $InstallRoot 'status.json'
        $started = $false
        for ($i=0; $i -lt 40; $i++) {
            if (Test-Path -LiteralPath $heartbeat) {
                $state = Get-Content -Raw -LiteralPath $heartbeat | ConvertFrom-Json
                if ($state.Running) { $started = $true; break }
            }
            Start-Sleep -Milliseconds 250
        }
        if (-not $started) { throw "Task registered but monitor heartbeat was not confirmed within 10 seconds." }
        Write-Output "Installed and started: $InstallRoot"
    } catch {
        $installationFailure = $_
        try {
            if ($rootCreated) {
                Assert-RegularDirectory
                $task = $null
                if ($registrationAttempted) { $task = Find-OwnedTask $manifest }
                if ($startAttempted) {
                    Stop-OwnedInstallation $manifest $task
                    foreach ($name in @('journal.json','journal.json.tmp','status.json','status.json.tmp','error.json','error.json.tmp')) { $createdNames.Add($name) }
                } elseif ($task) {
                    Unregister-ScheduledTask -TaskName $manifest.TaskName -TaskPath '\' -Confirm:$false
                }
                Remove-OwnedFiles $createdNames
            }
        } catch {
            throw "Installation failed: $($installationFailure.Exception.Message) Rollback incomplete; owned recovery files retained: $($_.Exception.Message)"
        }
        throw "Installation failed: $($installationFailure.Exception.Message) Newly created installation resources rolled back; retry after correcting the cause. Any unrecognized files were preserved."
    } finally {
        # Stage was generated here; remove only known build outputs and the now-empty stage directory.
        foreach ($name in @('Keroct.Quiet.exe','Keroct.Quiet.Cli.exe')) {
            $path = Join-Path $stage $name; if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
        }
        if ((Test-Path -LiteralPath $stage) -and @(Get-ChildItem -Force -LiteralPath $stage).Count -eq 0) { Remove-Item -LiteralPath $stage }
    }
} elseif ($Action -eq 'Status') {
    if (-not (Test-Path -LiteralPath $manifestPath)) { Write-Output 'Not installed.'; return }
    $manifest = Read-Manifest; $task = Find-OwnedTask $manifest
    $diagnostic = Invoke-Cli '--diagnose' | ConvertFrom-Json
    $processes = @(Get-Process -Name 'Keroct.Quiet' -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -eq (Join-Path $InstallRoot 'Keroct.Quiet.exe') } catch { $false }
    } | Select-Object Id,StartTime,Path)
    [ordered]@{ScheduledTaskRegistered=[bool]$task;TaskState=if($task){[string]$task.State}else{$null};
        MonitorProcesses=$processes;Live=$diagnostic;LastStartupError=if(Test-Path -LiteralPath (Join-Path $InstallRoot 'error.json')){
            Get-Content -Raw -LiteralPath (Join-Path $InstallRoot 'error.json') | ConvertFrom-Json}else{$null}} | ConvertTo-Json -Depth 12
} else {
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'No owned installation found; nothing deleted.' }
    $manifest = Read-Manifest; $task = Find-OwnedTask $manifest
    Stop-OwnedInstallation $manifest $task
    Remove-OwnedFiles @('Keroct.Quiet.exe','Keroct.Quiet.Cli.exe','config.json','install.json','Manage.ps1','Status.cmd','Uninstall.cmd',
        'journal.json','journal.json.tmp','status.json','status.json.tmp','error.json','error.json.tmp')
    Write-Output 'Uninstalled. Only the owned task, monitor and known installation files were removed.'
}
