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

## Operations Loop
Observe
→ Detect issue
→ Analyze
→ Recommend action
→ Verify
→ Human approval if required
→ Execute approved action
→ Record result

## Guardrails
The agent must not:
- silently change stock records without audit
- place high-value purchase orders without approval
- delete order history
- invent supplier/product data

## Acceptance Criteria
- Inventory can be tracked per tenant.
- Low-stock alerts work.
- Agent can generate reorder recommendations.
- Orders and inventory changes are auditable.
- High-risk actions require approval.
- Tests cover stock/order consistency.

## Non-Goals
- Advanced supply-chain optimization.
- Autonomous purchasing without policy/approval.

## Gemini Instruction
Prioritize data consistency and auditability over autonomy.
