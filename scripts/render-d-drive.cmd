@echo off
setlocal
for %%I in ("%~dp0..") do set "PROJECT_STORAGE_ROOT=%%~fI"
set "PROJECT_RENDER=%PROJECT_STORAGE_ROOT%\.local\render-cli\render.exe"
if not exist "%PROJECT_RENDER%" (
  echo Render CLI is not installed at the project-local location.
  exit /b 1
)
set "RENDER_CLI_CONFIG_DIR=%PROJECT_STORAGE_ROOT%\.local\render-config"
set "TEMP=%PROJECT_STORAGE_ROOT%\.local\temp"
set "TMP=%TEMP%"
if not exist "%TEMP%" mkdir "%TEMP%"
pushd "%PROJECT_STORAGE_ROOT%"
if errorlevel 1 exit /b 1
"%PROJECT_RENDER%" %*
set "PROJECT_COMMAND_EXIT=%errorlevel%"
popd
exit /b %PROJECT_COMMAND_EXIT%
