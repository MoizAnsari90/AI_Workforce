# Project storage on D:

The workspace is already `D:\Agent`. Host inspection found C: had zero available bytes and D: had approximately 395 GiB free.

The project `.npmrc` now uses `.local/npm-cache`, which resolves under D:\Agent when running npm from the repository root.

Use the command wrapper to put child-process temporary files and npm cache on D: without changing Windows policy, global environment settings, or other projects:

```powershell
.\scripts\with-d-drive.cmd npm.cmd run build
.\scripts\with-d-drive.cmd node scripts/run-api-tests.mjs
```

This wrapper creates only `D:\Agent\.local\temp` and `D:\Agent\.local\npm-cache`. Both are ignored by Git. Its environment settings last for the wrapped command and its children only. It does not relocate Docker's disk, Windows storage, editor logs or the coding tool's logs. C: still needs working free space for those programs.

Docker Desktop is installed per-user under `C:\Users\NCS\AppData\Local\Programs\DockerDesktop`; WSL reports a running `docker-desktop` distribution. The exact virtual-disk path was not obtained. No Docker storage setting, running container, volume, or database was changed. Moving Docker storage remains pending: inspect the disk location using Docker Desktop's supported settings interface before applying any relocation. Do not manually move its files or unregister its WSL distribution.

## Deployment resumed after freeing C:

On 2026-10-17, free space on C: was rechecked at 2.27 GiB. Tests and the production build succeeded with project temporary files on D:. This amount does not guarantee sufficient space for local Docker image builds.

Google Cloud CLI 589.0.0 was installed under `.local/gcloud-cli/google-cloud-sdk` on D:, using Google's official Windows archive verified against SHA256 `b9c2f4f296154f55e8a31a6979106573bc1ad8691041d4a32ea90c1834fdf995`. The archive source and checksum are published in [Google's installation documentation](https://docs.cloud.google.com/sdk/docs/downloads-versioned-archives).

These wrappers keep CLI configuration and its authentication files under the ignored `.local/gcloud-config` directory, and temporary files under `.local/temp`:

```powershell
.\scripts\gcloud-d-drive.cmd --version
.\scripts\gcloud-d-drive.cmd auth login --brief
.\scripts\deploy-cloudrun-windows.cmd --dry-run
.\scripts\deploy-cloudrun-windows.cmd
```

The final command performs a real cloud deployment and requires completed login, billing, permissions, cloud-accessible database/Redis and the Secret Manager references described in [the secure deployment guide](CLOUD_SHELL_SECURE_DEPLOYMENT.md). The deployment wrapper uses Git for Windows Bash and builds through Google Cloud; it does not require local Docker image builds. Do not commit or share `.local/gcloud-config`.
