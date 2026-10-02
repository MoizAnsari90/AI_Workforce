# AI Workforce Bundles: Operational Guide

This document outlines the functionality, connections, and workflows of our core AI Workforce Bundles. These bundles are designed to automate specific industry tasks, integrate with external systems, and empower human teams.

## 1. E-commerce Operations AI Bundle

This bundle is designed to streamline and automate key operational tasks for e-commerce businesses. It acts as an intelligent assistant, managing the backend complexities so that the business can focus on growth and customer satisfaction.

**How it Works:**
The E-commerce Operations AI Bundle integrates directly with e-commerce platforms (like Shopify) and their associated systems via APIs. It leverages backend services to perform tasks that would otherwise require manual intervention or dedicated staff.

**Key Tasks & Functionalities:**
*   **Inventory Management:**
    *   **Stock Monitoring:** Continuously checks inventory levels across products and locations.
    *   **Low Stock Alerts:** Notifies stakeholders when stock for a product reaches a predefined reorder point.
    *   **Reorder Recommendations:** Suggests optimal quantities to reorder based on demand, current stock, and reorder policies.
    *   **Inventory Adjustments:** Manages stock movements (e.g., receiving new stock, adjusting for damages) via API calls.
*   **Order Management:**
    *   **Refund Processing:** Initiates refunds for customer orders based on predefined rules or agent requests.
    *   **Order Cancellation:** Handles order cancellations, ensuring proper communication with the e-commerce platform.
*   **Sales Performance Tracking:**
    *   **Metric Recording:** Records sales performance metrics (e.g., campaign effectiveness, conversion rates) to provide insights.
*   **Integration:**
    *   Connects directly with **Shopify** and other e-commerce APIs to fetch product data, inventory levels, and execute order-related actions.
    *   Can integrate with other backend services for broader operational oversight.

**Connection Example:**
When a customer requests a refund, the AI agent interacting with the customer might trigger the `processRefund` function in the `shopifyTool.ts` service, which then communicates with the Shopify API to complete the refund. Similarly, inventory alerts are triggered by monitoring stock levels fetched from the e-commerce platform.

---

## 2. Healthcare & Clinic Patient Receptionist Bundle

This bundle focuses on automating administrative and patient-facing tasks within a clinic or healthcare setting, improving patient experience and operational efficiency.

**How it Works:**
The bundle utilizes AI agents trained for reception and administrative roles. It can integrate with clinic management systems (e.g., Electronic Health Records - EHR, scheduling software) via APIs to manage patient interactions and administrative workflows.

**Key Tasks & Functionalities:**
*   **Appointment Management:**
    *   **Scheduling:** Assists patients in booking new appointments based on available slots.
    *   **Rescheduling/Cancellation:** Handles requests to change or cancel existing appointments.
    *   **Slot Locking:** Temporarily reserves appointment slots for patients while confirming details.
*   **Patient Intake:**
    *   Gathers necessary patient information (contact details, reason for visit, basic medical history context) before an appointment.
*   **Information Dissemination:**
    *   Answers frequently asked questions about clinic services, operating hours, and preparation for appointments.
*   **Triage and Routing:**
    *   Guides patients to the correct department or service.
    *   **CRITICAL GUARDRAIL:** **Strictly prohibits** providing medical diagnosis, prescription advice, or handling medical emergencies. Patients with emergencies are immediately instructed to contact emergency services (e.g., call 911).

**Connection Example:**
The "Clinic Receptionist Agent" (as defined in `templateService.ts`) would interact with the clinic's scheduling system API to find available slots, book appointments, and update patient records. For administrative tasks, it acts as a virtual receptionist.

---

## 3. Real Estate Lead Qualification Bundle

This bundle is tailored for the real estate industry, automating the crucial initial stage of lead qualification to help agents focus on high-potential prospects.

**How it Works:**
The bundle integrates with lead sources (e.g., website forms, third-party lead providers) and CRM systems. It receives lead data, applies predefined qualification criteria, scores leads, and prepares them for the sales pipeline.

**Key Tasks & Functionalities:**
*   **Lead Ingestion:**
    *   Receives new leads through API integrations or manual input.
*   **Automated Qualification:**
    *   Analyzes lead data against predefined criteria (e.g., budget range, desired location, timeline for purchase/sale, decision-maker status).
    *   Assigns a qualification score to each lead.
*   **Lead Prioritization:**
    *   Ranks leads based on their qualification score and potential value, helping sales agents focus their efforts.
*   **Sales Pipeline Integration:**
    *   Updates the status of leads within the sales pipeline (e.g., New, Contacted, Qualified, Nurturing).
    *   Can trigger automated follow-up actions (e.g., sending introductory emails, scheduling follow-up reminders).
*   **CRM Synchronization:**
    *   Updates lead information, qualification status, and scores in the connected CRM system.
    *   Assigns leads to specific sales agents based on defined rules (e.g., territory, lead score, agent availability).

**Connection Example:**
When a new lead is submitted via a website form, an API call sends the lead's details to our system. The Real Estate Lead Qualification Bundle then processes this lead, uses logic defined in `leadService.ts` and `salesService.ts` to qualify it, and updates the lead's status in a connected **CRM** (like Salesforce or HubSpot) via the `crmTool.ts` service. The `novamartSimulation.test.ts` file shows an example of lead creation and processing which is conceptually similar.

---

## 4. Cross-Bundle Operational Safeguards & Reliability

These safeguards are shared platform capabilities. They apply across E-commerce, Healthcare, and Real Estate bundles so that every bundle inherits the same production controls.

### 1. Human-in-the-Loop (HITL) Fallback Logic

Automated execution must escalate to live human staff when AI confidence is low, an API execution fails, or a complex edge case arises.

**Required behavior:**
- Define a confidence threshold and risk classification for every AI decision.
- Route low-confidence responses, ambiguous patient/lead requests, policy exceptions, and failed external API calls to the authenticated human inbox for the same tenant.
- Preserve the full conversation, structured inputs, tool attempts, error details, and proposed next action in the escalation record.
- Pause autonomous execution while the case is pending; do not retry a risky action until a human approves or explicitly re-runs it.
- Require a human decision (`resume`, `abort`, or `correct and retry`) and record the decision in the audit log.
- If a patient reports an emergency, the agent must stop automation and immediately instruct the patient to contact emergency services; never provide diagnosis or treatment advice.
- Track escalation SLA, owner, status, and resolution so operations teams can measure handoff quality.

### 2. Multi-Channel Reminders & No-Show Reduction

For Healthcare and Real Estate schedules, the platform should automatically send confirmation reminders **24 hours before an appointment or viewing**.

**Workflow:**
1. Create an appointment/viewing with a stable tenant-scoped appointment ID.
2. Schedule a reminder job for exactly 24 hours before the event.
3. Send a WhatsApp confirmation when the contact has opted in and a valid phone number is available.
4. Send a Voice confirmation through the configured Vapi/Retell provider when voice is enabled or WhatsApp delivery fails.
5. Record delivery status, acknowledgement, opt-out, and any reschedule/cancel response.
6. If no acknowledgement is received, apply the tenant's configured retry policy and optionally escalate to staff.

Reminders must use the minimum necessary data, honor consent and do-not-contact rules, and never include sensitive medical details in a notification. A patient or prospect can confirm, reschedule, cancel, or request a human callback; each response must update the same appointment record idempotently.

### 3. Database Idempotency & Duplicate Prevention

Every action execution tool must enforce an idempotency key before performing an external or state-changing operation. This includes Shopify refunds, Shopify order cancellations, CRM writes, calendar slot locks, appointment bookings, invoice creation, and other irreversible actions.

**Required contract:**
- The caller supplies `idempotencyKey`, scoped to `tenantId`, action type, and target resource.
- `IdempotencyLog` uses a unique constraint on `(tenantId, idempotencyKey)` and atomically claims the operation before any external call.
- A repeated request with the same key returns the original result, even if the first request timed out or the provider response was lost.
- The log records request hash, status (`pending`, `succeeded`, `failed`), provider reference, response snapshot, attempt count, and timestamps.
- Retries may resume only safe, explicitly configured operations; they must never create a second refund, cancellation, booking, slot lock, or ledger entry.
- A unique database constraint is the final safeguard; application-level checks alone are insufficient.

### 4. Patient & Lead Data Privacy (HIPAA/GDPR Compliance Readiness)

The platform must be designed for HIPAA/GDPR readiness while recognizing that operational documentation alone is not legal certification.

**Data protection requirements:**
- Encrypt patient intake notes, medical-context fields, sensitive lead details, credentials, and other regulated fields at rest using field-level encryption or an envelope-encryption service.
- Use authenticated encryption (for example AES-256-GCM), per-field nonce/tag/version metadata, and tenant-scoped key separation managed by a KMS or equivalent key-management boundary.
- Encrypt data in transit with TLS and never place secrets, raw patient notes, or sensitive lead payloads in logs, analytics events, browser storage, or error messages.
- Enforce tenant isolation in every query and API route; users may access only records belonging to their authenticated tenant and permitted role.
- Apply least-privilege RBAC, purpose-based access, access logging, retention/deletion policies, consent records, and data-export/delete workflows.
- Mask or tokenize identifiers in notifications and reports, and minimize the data included in reminders.
- Test cross-tenant access, encryption/decryption failure, key rotation, backup/restore, and unauthorized disclosure scenarios as release-blocking security controls.

---
