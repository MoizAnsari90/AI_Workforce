-- CreateTable
CREATE TABLE "appointment_slots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doctor_name" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "patient_id" TEXT,
    "patient_name" TEXT,
    "idempotency_key" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_intake_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "email" TEXT,
    "reason_for_visit" TEXT NOT NULL,
    "encrypted_medical_history" TEXT,
    "encryption_metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_intake_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "target_resource" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider_ref" TEXT,
    "response_snapshot" JSONB,
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "idempotency_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointment_slots_idempotency_key_key" ON "appointment_slots"("idempotency_key");

-- CreateIndex
CREATE INDEX "appointment_slots_tenant_id_idx" ON "appointment_slots"("tenant_id");

-- CreateIndex
CREATE INDEX "appointment_slots_tenant_id_status_start_time_idx" ON "appointment_slots"("tenant_id", "status", "start_time");

-- CreateIndex
CREATE INDEX "patient_intake_records_tenant_id_idx" ON "patient_intake_records"("tenant_id");

-- CreateIndex
CREATE INDEX "idempotency_logs_tenant_id_idx" ON "idempotency_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "idempotency_logs_status_idx" ON "idempotency_logs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_logs_tenant_id_idempotency_key_key" ON "idempotency_logs"("tenant_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "appointment_slots" ADD CONSTRAINT "appointment_slots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_intake_records" ADD CONSTRAINT "patient_intake_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_logs" ADD CONSTRAINT "idempotency_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
