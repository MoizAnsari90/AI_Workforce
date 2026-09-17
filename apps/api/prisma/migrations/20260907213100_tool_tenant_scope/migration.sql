-- DropIndex
DROP INDEX "tools_name_key";

-- AlterTable
ALTER TABLE "tools" ADD COLUMN     "tenant_id" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "tools_tenant_id_idx" ON "tools"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tools_tenant_id_name_key" ON "tools"("tenant_id", "name");

-- AddForeignKey
ALTER TABLE "tools" ADD CONSTRAINT "tools_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
