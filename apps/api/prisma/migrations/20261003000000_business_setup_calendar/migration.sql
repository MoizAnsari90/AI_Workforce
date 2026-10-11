CREATE TABLE "business_profiles" (
  "tenant_id" TEXT NOT NULL PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "profile" JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "google_calendar_connections" (
  "tenant_id" TEXT NOT NULL PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "connection_id" TEXT NOT NULL,
  "encrypted_tokens" TEXT NOT NULL,
  "calendar_id" TEXT,
  "calendar_name" TEXT,
  "calendar_timezone" TEXT,
  "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "calendar_oauth_states" (
  "state_hash" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL,
  "code_verifier" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "calendar_oauth_states_expires_at_idx" ON "calendar_oauth_states"("expires_at");
