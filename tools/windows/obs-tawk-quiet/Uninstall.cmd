@echo off
if exist "%~dp0install.json" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Manage.ps1" -Action Uninstall -InstallRoot "%~dp0" %*
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Manage.ps1" -Action Uninstall %*
)
pause
