#!/usr/bin/env bash
# Cloud Shell entry point: Secret Manager references only, never secret payloads.
set -euo pipefail
export GCP_DEPLOY_FROM_SOURCE=true
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$ROOT/deploy-gcp.sh" "$@"
