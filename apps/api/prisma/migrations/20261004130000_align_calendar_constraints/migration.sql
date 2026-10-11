-- Match Prisma's default ON UPDATE CASCADE and generated index name.
-- Constraint replacement is atomic and does not change application records.
BEGIN;

ALTER TABLE "business_profiles"
  DROP CONSTRAINT "business_profiles_tenant_id_fkey",
  ADD CONSTRAINT "business_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_resources"
  DROP CONSTRAINT "booking_resources_tenant_id_fkey",
  ADD CONSTRAINT "booking_resources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "clinic_services"
  DROP CONSTRAINT "clinic_services_tenant_id_fkey",
  ADD CONSTRAINT "clinic_services_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  DROP CONSTRAINT "clinic_services_tenant_id_resource_id_fkey",
  ADD CONSTRAINT "clinic_services_tenant_id_resource_id_fkey" FOREIGN KEY ("tenant_id", "resource_id") REFERENCES "booking_resources"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "property_listings"
  DROP CONSTRAINT "property_listings_tenant_id_fkey",
  ADD CONSTRAINT "property_listings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scheduled_appointments"
  DROP CONSTRAINT "scheduled_appointments_tenant_id_fkey",
  ADD CONSTRAINT "scheduled_appointments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  DROP CONSTRAINT "scheduled_appointments_tenant_id_resource_id_fkey",
  ADD CONSTRAINT "scheduled_appointments_tenant_id_resource_id_fkey" FOREIGN KEY ("tenant_id", "resource_id") REFERENCES "booking_resources"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "niche_automation"
  DROP CONSTRAINT "niche_automation_tenant_id_fkey",
  ADD CONSTRAINT "niche_automation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "niche_sessions"
  DROP CONSTRAINT "niche_sessions_tenant_id_fkey",
  ADD CONSTRAINT "niche_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "niche_dispatches"
  DROP CONSTRAINT "niche_dispatches_tenant_id_fkey",
  ADD CONSTRAINT "niche_dispatches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "google_calendar_connections"
  DROP CONSTRAINT "google_calendar_connections_tenant_id_fkey",
  ADD CONSTRAINT "google_calendar_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "calendar_oauth_states"
  DROP CONSTRAINT "calendar_oauth_states_tenant_id_fkey",
  ADD CONSTRAINT "calendar_oauth_states_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER INDEX "scheduled_appointments_tenant_id_calendar_id_status_start_time_"
  RENAME TO "scheduled_appointments_tenant_id_calendar_id_status_start_t_idx";

COMMIT;
