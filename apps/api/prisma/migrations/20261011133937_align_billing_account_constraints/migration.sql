-- DropForeignKey
ALTER TABLE "billing_accounts" DROP CONSTRAINT "billing_accounts_tenant_id_fkey";

-- AlterTable
ALTER TABLE "billing_accounts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
