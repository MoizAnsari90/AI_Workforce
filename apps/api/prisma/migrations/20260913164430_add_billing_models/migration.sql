-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "subscription_tier_id" TEXT;

-- CreateTable
CREATE TABLE "subscription_tiers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "max_agents" INTEGER NOT NULL,
    "max_tool_calls_per_month" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_credits" (
    "tenant_id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "available_credits" INTEGER NOT NULL DEFAULT 0,
    "last_refill_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_credits_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "credit_consumption_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_consumption_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_tiers_name_key" ON "subscription_tiers"("name");

-- CreateIndex
CREATE INDEX "credit_consumption_logs_tenant_id_idx" ON "credit_consumption_logs"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_credits" ADD CONSTRAINT "tenant_credits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_credits" ADD CONSTRAINT "tenant_credits_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "subscription_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_consumption_logs" ADD CONSTRAINT "credit_consumption_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_subscription_tier_id_fkey" FOREIGN KEY ("subscription_tier_id") REFERENCES "subscription_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
