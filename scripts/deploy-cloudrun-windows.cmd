@echo off
setlocal
for %%I in ("%~dp0..") do set "PROJECT_STORAGE_ROOT=%%~fI"
set "PROJECT_SDK=%PROJECT_STORAGE_ROOT%\.local\gcloud-cli\google-cloud-sdk"
set "PROJECT_BASH=C:\Program Files\Git\bin\bash.exe"
if not exist "%PROJECT_SDK%\bin\gcloud.cmd" (
  echo Project-local Google Cloud CLI is not installed.
  exit /b 1
)
if not exist "%PROJECT_BASH%" (
  echo Git for Windows Bash is required at C:\Program Files\Git\bin\bash.exe.
  exit /b 1
)
set "CLOUDSDK_CONFIG=%PROJECT_STORAGE_ROOT%\.local\gcloud-config"
set "CLOUDSDK_CORE_PROJECT=gen-lang-client-0445651739"
set "CLOUDSDK_CORE_DISABLE_USAGE_REPORTING=true"
set "CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK=true"
set "CLOUDSDK_PYTHON=%PROJECT_SDK%\platform\bundledpython\python.exe"
set "PYTHON_BIN=%CLOUDSDK_PYTHON:\=/%"
set "PATH=%PROJECT_SDK%\bin;%PATH%"
set "TEMP=%PROJECT_STORAGE_ROOT%\.local\temp"
set "TMP=%TEMP%"
set "TMPDIR=%TEMP:\=/%"
if not exist "%TEMP%" mkdir "%TEMP%"
if not exist "%CLOUDSDK_CONFIG%" mkdir "%CLOUDSDK_CONFIG%"
pushd "%PROJECT_STORAGE_ROOT%"
if errorlevel 1 exit /b 1
"%PROJECT_BASH%" deploy-cloudrun.sh %*
set "PROJECT_DEPLOY_EXIT=%errorlevel%"
popd
exit /b %PROJECT_DEPLOY_EXIT%
