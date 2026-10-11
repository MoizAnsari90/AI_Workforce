CREATE TABLE "booking_resources" (
 "id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('healthcare', 'real_estate')), "name" TEXT NOT NULL, "specialty" TEXT,
 "calendar_id" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("tenant_id", "id")
);
CREATE INDEX "booking_resources_tenant_id_kind_idx" ON "booking_resources"("tenant_id", "kind");
CREATE TABLE "clinic_services" (
 "id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
 "resource_id" TEXT NOT NULL, "name" TEXT NOT NULL, "duration_minutes" INTEGER NOT NULL CHECK ("duration_minutes" BETWEEN 10 AND 180),
 "active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("tenant_id", "resource_id") REFERENCES "booking_resources"("tenant_id", "id") ON DELETE CASCADE
);
CREATE INDEX "clinic_services_tenant_id_idx" ON "clinic_services"("tenant_id");
CREATE TABLE "property_listings" (
 "id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
 "reference" TEXT NOT NULL, "title" TEXT NOT NULL, "city" TEXT NOT NULL, "area" TEXT NOT NULL,
 "property_type" TEXT NOT NULL, "purpose" TEXT NOT NULL, "price" DECIMAL(15,2) NOT NULL CHECK ("price" >= 0),
 "currency" TEXT NOT NULL, "country" TEXT NOT NULL, "bedrooms" INTEGER,
 "active" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("tenant_id", "reference")
);
CREATE INDEX "property_listings_tenant_id_active_idx" ON "property_listings"("tenant_id", "active");
CREATE TABLE "scheduled_appointments" (
 "id" TEXT PRIMARY KEY, "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
 "resource_id" TEXT NOT NULL, "kind" TEXT NOT NULL, "service_id" TEXT, "property_id" TEXT, "lead_id" TEXT,
 "start_time" TIMESTAMP(3) NOT NULL, "end_time" TIMESTAMP(3) NOT NULL,
 "buffer_minutes" INTEGER NOT NULL CHECK ("buffer_minutes" BETWEEN 0 AND 60), "timezone" TEXT NOT NULL,
 "encrypted_contact" TEXT NOT NULL, "calendar_id" TEXT NOT NULL, "connection_id" TEXT NOT NULL,
 "event_id" TEXT NOT NULL UNIQUE, "status" TEXT NOT NULL DEFAULT 'sync_pending' CHECK ("status" IN ('sync_pending', 'confirmed', 'cancel_pending', 'cancelled', 'review_required')),
 "idempotency_key" TEXT NOT NULL, "request_hash" TEXT NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CHECK ("end_time" > "start_time"),
 FOREIGN KEY ("tenant_id", "resource_id") REFERENCES "booking_resources"("tenant_id", "id") ON DELETE CASCADE,
 UNIQUE ("tenant_id", "idempotency_key")
);
CREATE INDEX "scheduled_appointments_tenant_id_calendar_id_status_start_time_idx" ON "scheduled_appointments"("tenant_id", "calendar_id", "status", "start_time");
