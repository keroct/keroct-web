@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Manage.ps1" -Action Install %*
if errorlevel 1 echo Installation failed. Read the error above; see rollback / recovery details above.
pause
