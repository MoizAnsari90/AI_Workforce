ALTER TABLE "external_integration_credentials"
ADD COLUMN "external_account_id" TEXT;

CREATE UNIQUE INDEX "external_integration_credentials_provider_external_account_id_key"
ON "external_integration_credentials"("provider", "external_account_id");
