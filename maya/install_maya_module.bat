@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_maya_module.ps1"
if errorlevel 1 (
  echo.
  echo Maya module installation failed.
  pause
  exit /b 1
)
echo.
pause
