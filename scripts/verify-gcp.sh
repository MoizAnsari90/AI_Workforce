#!/usr/bin/env bash
set -euo pipefail
API_URL="${1:?Supply API URL}"; WEB_URL="${2:?Supply Web URL}"
API_URL="${API_URL%/}"; WEB_URL="${WEB_URL%/}"
for url in "$API_URL" "$WEB_URL"; do [[ "$url" == https://* ]] || { echo 'Public HTTPS URLs required.' >&2; exit 1; }; done
HEADERS="$(mktemp)"
trap 'rm -f -- "$HEADERS"' EXIT
curl -fsS --max-time 30 --retry 5 --retry-delay 5 "$API_URL/livez" >/dev/null
curl -fsS --max-time 30 --retry 5 --retry-delay 5 "$API_URL/health" >/dev/null
curl -fsS --max-time 30 "$WEB_URL/api/health" >/dev/null
for url in "$API_URL/api/v1/auth/me" "$WEB_URL/api/auth/me" "$WEB_URL/api/v1/auth/me"; do
  code="$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' "$url")"
  [[ "$code" == 401 ]] || { echo "Expected unauthenticated 401, got $code: $url" >&2; exit 1; }
done
code="$(curl -sS --max-time 30 -D "$HEADERS" -o /dev/null -w '%{http_code}' -X OPTIONS "$API_URL/api/v1/auth/login" -H "Origin: $WEB_URL" -H 'Access-Control-Request-Method: POST')"
[[ "$code" == 204 ]] || { echo "CORS preflight failed: $code" >&2; exit 1; }
origin="$(awk 'tolower($1)=="access-control-allow-origin:" {gsub("\r", "", $2); print $2}' "$HEADERS")"
[[ "$origin" == "$WEB_URL" ]] || { echo 'CORS allowed origin did not match frontend.' >&2; exit 1; }
code="$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' "$API_URL/api/v1/auth/me" -H 'Origin: https://untrusted.invalid')"
[[ "$code" == 403 ]] || { echo "Foreign origin was not rejected: $code" >&2; exit 1; }
echo 'PASS: API liveness, DB/Redis readiness, frontend health, runtime proxy, unauthenticated guards, and CORS.'
