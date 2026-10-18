# Copy to config.local.sh. Identifiers only; keep secret VALUES out of this file.
GCP_PROJECT_ID=gen-lang-client-0445651739
GCP_REGION=us-central1
ARTIFACT_REPOSITORY=ai-workforce
API_SERVICE=ai-workforce-api
WEB_SERVICE=ai-workforce-web
MIGRATION_JOB=ai-workforce-migrate
SECRET_BINDINGS_FILE=deploy/gcp/api-secrets.example
API_ENV_FILE=deploy/gcp/api-env.example.json
# Choose a model your Gemini API key can access; validate inference before submission.
GEMINI_MODEL=gemini-flash-latest
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
# For private Redis/PostgreSQL: set BOTH Direct VPC network and subnet, or a connector.
VPC_NETWORK=
VPC_SUBNET=
VPC_CONNECTOR=
CLOUD_SQL_INSTANCE=
# Optional custom CA for rediss:// (e.g. a private Redis certificate authority).
# The value is a Secret Manager name:version reference, never certificate contents.
REDIS_TLS_CA_SECRET=
# Optional HTTPS browser origins in addition to the discovered frontend URL.
EXTRA_CORS_ORIGINS=
