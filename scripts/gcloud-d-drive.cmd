@echo off
setlocal
for %%I in ("%~dp0..") do set "PROJECT_STORAGE_ROOT=%%~fI"
set "PROJECT_GCLOUD=%PROJECT_STORAGE_ROOT%\.local\gcloud-cli\google-cloud-sdk\bin\gcloud.cmd"
if not exist "%PROJECT_GCLOUD%" (
  echo Google Cloud CLI is not installed at the project-local location.
  exit /b 1
)
set "CLOUDSDK_CONFIG=%PROJECT_STORAGE_ROOT%\.local\gcloud-config"
set "CLOUDSDK_PYTHON=%PROJECT_STORAGE_ROOT%\.local\gcloud-cli\google-cloud-sdk\platform\bundledpython\python.exe"
set "CLOUDSDK_CORE_PROJECT=gen-lang-client-0445651739"
set "CLOUDSDK_CORE_DISABLE_USAGE_REPORTING=true"
set "CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK=true"
set "TEMP=%PROJECT_STORAGE_ROOT%\.local\temp"
set "TMP=%TEMP%"
if not exist "%CLOUDSDK_CONFIG%" mkdir "%CLOUDSDK_CONFIG%"
if not exist "%TEMP%" mkdir "%TEMP%"
call "%PROJECT_GCLOUD%" %*
exit /b %errorlevel%
