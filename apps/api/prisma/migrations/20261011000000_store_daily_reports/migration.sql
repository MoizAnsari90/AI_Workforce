CREATE TABLE "store_report_schedules" (
  "tenant_id" TEXT PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "recipient" TEXT NOT NULL DEFAULT '',
  "delivery_time" TEXT NOT NULL DEFAULT '00:10',
  "timezone" TEXT NOT NULL,
  "template_name" TEXT NOT NULL DEFAULT '',
  "template_language" TEXT NOT NULL DEFAULT 'en_US',
  "consent_at" TIMESTAMP(3),
  "next_run_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "store_report_schedules_enabled_next_run_at_idx" ON "store_report_schedules"("enabled", "next_run_at");
CREATE TABLE "store_daily_reports" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "report_date" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "summary" JSONB,
  "error" TEXT,
  "provider_id" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lease_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "store_daily_reports_tenant_id_report_date_key" ON "store_daily_reports"("tenant_id", "report_date");
CREATE INDEX "store_daily_reports_tenant_id_created_at_idx" ON "store_daily_reports"("tenant_id", "created_at");
CREATE INDEX "store_daily_reports_tenant_id_provider_id_idx" ON "store_daily_reports"("tenant_id", "provider_id");
