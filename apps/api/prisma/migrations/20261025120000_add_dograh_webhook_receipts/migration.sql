CREATE TABLE "dograh_webhook_receipts" (
  "tenant_id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "body_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "response" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dograh_webhook_receipts_pkey" PRIMARY KEY ("tenant_id", "event_id"),
  CONSTRAINT "dograh_webhook_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);