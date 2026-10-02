# Phase 05 — Operations & Inventory AI Employee

## Goal
Create an Operations Employee for orders, inventory, suppliers and routine operational workflows.

## Depends On
Phase 04.

## Scope
- Products
- SKUs
- Inventory
- Warehouses/locations
- Orders
- Suppliers
- Purchase/reorder recommendations
- Stock alerts
- Operational tasks
- Basic demand signals
- Approval workflow
- E-commerce Operations Bundle: Shopify stock level syncing and direct Supplier Purchase Order (PO) creation via external API integrations
- Strict HITL Gate: Any Purchase Order (PO) creation > $1000 or bulk stock alteration requires explicit admin approval before API execution
- Strict idempotency checks for every external API call, including every ShopifyTool action; each call receives a tenant-scoped idempotency key, atomically claims the operation before any provider call.
- Durable `IdempotencyLog` with a unique `(tenantId, idempotencyKey)` constraint, request hash, status, provider reference, response snapshot, attempt count, and timestamps.
- Replay semantics: the same key returns the original result; retries never create a second refund, cancellation, stock adjustment, or PO.
- Provider timeouts and ambiguous outcomes are reconciled before any retry; unresolved outcomes route to HITL rather than being guessed.

## Operations Loop
Observe
→ Detect issue
→ Analyze
→ Recommend action
→ Verify policy, authorization, and idempotency claim
→ Human approval if required
→ Execute approved action through `ShopifyTool` or the relevant integration adapter
→ Verify provider confirmation and persisted state
→ Record result and audit evidence

## Guardrails
The agent must not:
- silently change stock records without audit
- place high-value purchase orders without approval
- delete order history
- invent supplier/product data
- call an external API without an idempotency key
- retry an ambiguous external call in a way that could duplicate a transaction

## Acceptance Criteria
- Inventory can be tracked per tenant.
- Low-stock alerts work.
- Agent can generate reorder recommendations.
- Orders and inventory changes are auditable.
- High-risk actions require approval.
- Every external API call is protected by a tenant-scoped idempotency key and durable log.
- Repeating a request with the same idempotency key returns the original result and does not create a duplicate provider transaction.
- Provider timeout, retry, and partial-failure scenarios are tested.
- Tests cover stock/order consistency, duplicate prevention, and human fallback.

## Non-Goals
- Advanced supply-chain optimization.
- Autonomous purchasing without policy/approval.

## Gemini Instruction
Prioritize data consistency and auditability over autonomy.
