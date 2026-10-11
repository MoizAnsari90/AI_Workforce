ALTER TABLE "scheduled_appointments" ADD COLUMN "reminder_consent" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "niche_automation" (
 "tenant_id" TEXT PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
 "config" JSONB NOT NULL, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "niche_sessions" (
 "id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
 "channel" TEXT NOT NULL, "customer_hash" TEXT NOT NULL, "encrypted_state" TEXT NOT NULL,
 "paused" BOOLEAN NOT NULL DEFAULT false, "opted_out" BOOLEAN NOT NULL DEFAULT false,
 "handoff_reason" TEXT, "updated_at" TIMESTAMP(3) NOT NULL,
 UNIQUE ("tenant_id", "channel", "customer_hash")
);
CREATE INDEX "niche_sessions_tenant_id_paused_idx" ON "niche_sessions"("tenant_id", "paused");
CREATE TABLE "niche_dispatches" (
 "id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
 "key" TEXT NOT NULL, "type" TEXT NOT NULL, "scope" TEXT NOT NULL DEFAULT '', "encrypted_payload" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending', "due_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "provider_id" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 UNIQUE ("tenant_id", "key")
);
CREATE INDEX "niche_dispatches_status_due_at_idx" ON "niche_dispatches"("status", "due_at");
CREATE INDEX "niche_dispatches_tenant_id_provider_id_idx" ON "niche_dispatches"("tenant_id", "provider_id");
