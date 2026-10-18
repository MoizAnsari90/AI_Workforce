@echo off
setlocal
for %%I in ("%~dp0..") do set "PROJECT_STORAGE_ROOT=%%~fI"
set "PROJECT_VERCEL=%PROJECT_STORAGE_ROOT%\.local\vercel-tools\vercel.cmd"
if not exist "%PROJECT_VERCEL%" (
  echo Install Vercel CLI on D: using the deployment guide first.
  exit /b 1
)
set "TEMP=%PROJECT_STORAGE_ROOT%\.local\temp"
set "TMP=%TEMP%"
set "VERCEL_TELEMETRY_DISABLED=1"
set "NO_UPDATE_NOTIFIER=1"
if not exist "%TEMP%" mkdir "%TEMP%"
pushd "%PROJECT_STORAGE_ROOT%"
if errorlevel 1 exit /b 1
call "%PROJECT_VERCEL%" --global-config "%PROJECT_STORAGE_ROOT%\.local\vercel-config" %*
set "PROJECT_COMMAND_EXIT=%errorlevel%"
popd
exit /b %PROJECT_COMMAND_EXIT%
