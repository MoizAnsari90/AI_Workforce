CREATE TABLE "billing_accounts" (
  "tenant_id" TEXT PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id" TEXT NOT NULL UNIQUE,
  "subscription_id" TEXT UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'inactive',
  "plan_id" TEXT,
  "period_end" TIMESTAMP(3),
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "last_invoice_id" TEXT,
  "checkout_id" TEXT,
  "checkout_url" TEXT,
  "checkout_expires_at" TIMESTAMP(3),
  "livemode" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "billing_events" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "billing_events_tenant_id_processed_at_idx" ON "billing_events"("tenant_id", "processed_at");

-- Serialize per-workspace agent creation so concurrent requests cannot exceed a plan.
CREATE FUNCTION enforce_billing_agent_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE maximum INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('agent-quota:' || NEW.tenant_id));
  SELECT s.max_agents INTO maximum FROM tenants t
    JOIN subscription_tiers s ON s.id = t.subscription_tier_id
    JOIN billing_accounts b ON b.tenant_id = t.id
    WHERE t.id = NEW.tenant_id AND b.plan_id IS NOT NULL;
  IF maximum IS NOT NULL AND (SELECT count(*) FROM agents WHERE tenant_id = NEW.tenant_id AND id <> NEW.id) >= maximum THEN
    RAISE EXCEPTION 'Workspace agent plan limit reached' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_agent_limit BEFORE INSERT OR UPDATE OF tenant_id ON agents
FOR EACH ROW EXECUTE FUNCTION enforce_billing_agent_limit();
