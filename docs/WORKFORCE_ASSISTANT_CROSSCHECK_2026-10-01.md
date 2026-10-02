# Workforce assistant live cross-check — 2026-10-01

Tested the running local API at POST `/api/v1/tenants/:tenantId/workforce/ask` for the user's workspace. This exercised backend authentication and the assistant route, not the browser/proxy UI. All 12 requests returned HTTP 200; HTTP success alone does not establish answer quality. No business records, inventory, orders or approvals were modified.

Independent database baseline: 15 inbound customer messages, 2 AI outbound replies, 0 total tasks, 0 completed agent-assigned tasks, 0 pending approvals, 0 open low-stock alerts.

A separate read-only Shopify request confirmed `sku-managed-1`: 100 available units, consisting of Shop location: 50 and Snow City Warehouse: 50. The chat stock check was timestamped 2026-10-01T18:56:24.354Z.

## Exact questions and answers

1. **AI ne kitne customer messages ka jawab diya hai?**

   Answer: Workspace totals (all time): 2 AI outbound replies and 15 inbound customer messages are recorded. Reply count does not represent unique customer messages answered.

   Assessment: Correct recorded counts and an appropriate limitation. Reply totals cannot establish how many unique customer messages were answered.

2. **Kitni approvals pending hain?**

   Answer: Currently 0 approvals are pending.

   Assessment: Correct against database.

3. **Total tasks kitne hain?**

   Answer: Workspace totals (all time): 0 tasks are recorded.

   Assessment: Correct against database.

4. **Kitne agent tasks complete hue hain?**

   Answer: Workspace totals (all time): 0 agent-assigned tasks are completed, out of 0 total tasks.

   Assessment: Correct against database.

5. **Kitne low stock alerts open hain?**

   Answer: Currently 0 low-stock alerts are open in the workspace database. This is not a live Shopify inventory check.

   Assessment: Correct. Local alert records are distinguished from live Shopify inventory.

6. **Mere workspace ki performance ka short summary do.**

   Answer: Workspace totals (all time): 0 completed agent tasks, 0 total tasks, 2 AI outbound replies and 15 inbound customer messages. Currently 0 approvals are pending and 0 low-stock alerts are open.

   Assessment: Correct against database.

7. **SKU sku-managed-1 ka location-wise stock batao.**

   Answer: Live Shopify stock for SKU sku-managed-1: 100 available units. By location: Shop location: 50 units; Snow City Warehouse: 50 units. Source: Shopify Admin API. Checked at 2026-10-01T18:56:24.354Z.

   Assessment: Correct against a separate Shopify lookup.

8. **HR Clothing product available hai?**

   Answer: Please share the exact product SKU. For example: "Check stock for SKU: sku-managed-1". Product-name search is not available yet.

   Assessment: Appropriate clarification for the currently supported SKU-only lookup; product-name availability is not verified.

9. **SKU DOES-NOT-EXIST-CROSSCHECK-20261001 ka stock kitna hai?**

   Answer: Live Shopify stock could not be verified. Check the exact SKU and the Shopify connection in Integrations, then try again. No stock quantity is available from this check.

   Assessment: Safe, but imprecise. Does not invent stock; should distinguish an unknown/ambiguous SKU from provider or connection failure.

10. **SKU sku-managed-1 aur SKU DOES-NOT-EXIST-CROSSCHECK-20261001 dono ka stock batao.**

    Answer: Live Shopify stock for SKU sku-managed-1: 100 available units. By location: Shop location: 50 units; Snow City Warehouse: 50 units. Source: Shopify Admin API. Checked at 2026-10-01T18:56:25.908Z.

    Assessment: Incomplete. The second SKU is silently ignored. Should either handle each requested SKU or explicitly request one SKU at a time.

11. **Aaj AI ne kitne customer messages ka jawab diya hai?**

    Answer: Workspace totals (all time): 2 AI outbound replies and 15 inbound customer messages are recorded. Reply count does not represent unique customer messages answered.

    Assessment: Incomplete. The all-time label is honest but does not answer today's request. Needs date filtering with a defined timezone, or an explicit unsupported-period response.

12. **Order 123 ka tracking status kya hai?**

    Answer: The provided metrics do not contain any information or tracking status for Order 123.

    Assessment: Correctly admits missing data. Order tracking is unsupported; this Gemini request succeeded during the audit.

## Findings

- Nine answers had correct verified data or appropriate scope clarification.
- One answer failed to distinguish the reason for a failed lookup.
- Two answers were incomplete: multiple SKUs and a date-specific request.
- These results describe this test run, not a general reliability percentage.
- This turn performed an audit only; the identified product gaps were not changed.

## Follow-up fixes verified — 2026-10-02 (Asia/Karachi)

The three failing/unclear prompts were repeated against the running API after the fixes:

- Two-SKU request: returns `partial`, with 100 units for `sku-managed-1` (50 per location) and an explicit `SKU not found` result for the nonexistent SKU. Both requested items are represented. Up to five distinct SKUs are supported per request.
- Nonexistent SKU: now explicitly says `SKU not found in the connected Shopify store`. Ambiguous matches, untracked inventory and provider failures have separate error categories.
- Today's reply count: initially answered with an all-time number. The follow-up now filters the inbound and AI outbound messages by Asia/Karachi calendar-day boundaries and labels the period in the answer. Today/yesterday, this/last week and month, the past seven days, and explicit ISO, Pakistan-style numeric, or named dates are supported for replies, tasks, approvals and low-stock alert records. Historical stock remains unsupported.

Live date cross-check on 2026-10-02: the assistant returned 0 inbound and 0 AI outbound messages for today and yesterday. Direct read-only database counts using the same Karachi-time windows also returned 0/0. The earlier 15 inbound and 2 outbound figures were workspace-wide totals, not counts for those days.

The API TypeScript build passed after the date-filter implementation. The latest targeted run passed 45 tests across metrics and Shopify stock handling, including a regression test that distinguishes date-bounded message counts from all-time totals. Business inventory/orders were not changed by these read-only checks.
