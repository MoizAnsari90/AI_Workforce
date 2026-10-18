@echo off
setlocal
for %%I in ("%~dp0..") do set "PROJECT_STORAGE_ROOT=%%~fI"
if /I not "%PROJECT_STORAGE_ROOT:~0,3%"=="D:\" (
  echo This helper expects the project on D:.
  exit /b 1
)
if "%~1"=="" (
  echo Usage: scripts\with-d-drive.cmd npm.cmd run build
  exit /b 1
)
set "TEMP=%PROJECT_STORAGE_ROOT%\.local\temp"
set "TMP=%TEMP%"
set "TMPDIR=%TEMP%"
set "npm_config_cache=%PROJECT_STORAGE_ROOT%\.local\npm-cache"
if not exist "%TEMP%" mkdir "%TEMP%"
if not exist "%TEMP%" exit /b 1
if not exist "%npm_config_cache%" mkdir "%npm_config_cache%"
if not exist "%npm_config_cache%" exit /b 1
pushd "%PROJECT_STORAGE_ROOT%"
if errorlevel 1 exit /b 1
call %*
set "PROJECT_COMMAND_EXIT=%errorlevel%"
popd
exit /b %PROJECT_COMMAND_EXIT%
