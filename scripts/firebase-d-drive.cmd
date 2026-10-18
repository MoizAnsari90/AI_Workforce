@echo off
setlocal
for %%I in ("%~dp0..") do set "PROJECT_STORAGE_ROOT=%%~fI"
set "PROJECT_FIREBASE=%PROJECT_STORAGE_ROOT%\.local\firebase-tools\firebase.cmd"
if not exist "%PROJECT_FIREBASE%" (
  echo Install Firebase CLI using the deployment guide first.
  exit /b 1
)
set "XDG_CONFIG_HOME=%PROJECT_STORAGE_ROOT%\.local\firebase-config"
set "TEMP=%PROJECT_STORAGE_ROOT%\.local\temp"
set "TMP=%TEMP%"
set "NO_UPDATE_NOTIFIER=1"
if not exist "%XDG_CONFIG_HOME%" mkdir "%XDG_CONFIG_HOME%"
if not exist "%TEMP%" mkdir "%TEMP%"
pushd "%PROJECT_STORAGE_ROOT%"
if errorlevel 1 exit /b 1
call "%PROJECT_FIREBASE%" %*
set "PROJECT_COMMAND_EXIT=%errorlevel%"
popd
exit /b %PROJECT_COMMAND_EXIT%
