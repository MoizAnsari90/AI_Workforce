# Documentation Plan: Project Summary & Architecture Notes

**Project:** AI Workforce — Autonomous Operations Team
**Focus:** How the project integrates the Gemini API and relevant Google technologies
**Planned deliverable:** `docs/PROJECT_SUMMARY_ARCHITECTURE_NOTES.md`
**Language and format:** Professional English, Markdown
**Target length:** Approximately 500–700 words, plus one compact architecture diagram and source references

## 1. Purpose and audience

Produce a concise technical overview for reviewers, engineering stakeholders, and external evaluators. Explain the business problem, Gemini's specific contribution, and how the integration fits into the application's architecture. Use concrete implementation details supported by the repository.

## 2. Proposed document structure

| Section | Content |
| --- | --- |
| Project summary | A short introduction to the multi-tenant platform and its support, merchant-assistant, and workflow use cases. |
| Architecture overview | Next.js frontend, Express/TypeScript API, PostgreSQL/Prisma, Redis/BullMQ, and the server-side Gemini integration. Include a compact Mermaid diagram with distinct support, retrieval, and workflow paths. |
| Gemini integration | A small table describing grounded support responses, document/query embeddings, workflow task execution, workspace intent classification, and merchant-question normalization. |
| Representative request flow | Trace an inbound WhatsApp support message through validation, queueing, tenant context, FAQ/retrieval selection, conditional Gemini generation, and response delivery or human handling. |
| Reliability and security | Explain server-side credentials, tenant-scoped data access, structured-output validation where implemented, approval controls for applicable workflow tools, and path-specific fallbacks. |
| Google technology scope and verification | Distinguish direct Gemini API usage from Google Cloud deployment or Vertex AI. State the limits of the evidence and link to implementation sources. |

The opening summary should stand alone if copied into a submission form. Keep detailed deployment instructions and the broader production audit in their existing documents.

## 3. Implementation evidence identified

| Source | What it establishes |
| --- | --- |
| [Gemini service](../apps/api/src/services/geminiService.ts) | `GoogleGenAI` client, API-key initialization, generation calls, selected JSON-schema output constraints, and 768-dimensional embedding requests. |
| [LLM response routing](../apps/api/src/services/llmService.ts) | Conditional use of Gemini for retrieved support context, FAQ handling, and deterministic/human fallback paths. |
| [Knowledge retrieval](../apps/api/src/services/ragService.ts) | Tenant-filtered chunk retrieval, stored embeddings, application-side similarity scoring, and lexical fallback. |
| [Merchant question service](../apps/api/src/services/merchantQuestionService.ts) | Restricted intent/search normalization; verified commerce services supply resulting business facts. |
| [Workflow orchestrator](../apps/api/src/services/orchestratorService.ts) | Integration of Gemini-backed agent tasks into persisted workflow execution. |
| [Environment configuration](../apps/api/src/config/env.ts) | Server-side API-key and model configuration names. |

Review supporting routes, webhook processing, harness controls, and relevant tests before drafting their corresponding claims.

## 4. Accuracy rules

- Describe the current implementation, not only the capabilities advertised in the README.
- Current evidence shows the `@google/genai` SDK initialized with an API key. Do not claim Vertex AI, Google Cloud IAM/service-account authentication, Cloud Run hosting, or managed vector search without implementation/deployment evidence.
- Google Calendar is a separate Google API integration; do not classify it as a Google Cloud AI service.
- Explain that retrieval currently scores a bounded set of tenant-filtered chunks in application code. Do not describe it as a verified pgvector-indexed retrieval pipeline.
- Present prompt grounding and low temperature as controls, not guarantees against hallucinations.
- Distinguish constrained classification outputs from free-text support/workflow generation. Do not imply every Gemini response has schema validation or the same timeout policy.
- Identify model selection through configuration. Verify any model availability or platform-specific claims against official Google documentation before including them.
- Describe automated tests as implementation evidence. Do not present earlier test results as a fresh run or proof of live Gemini/provider acceptance.
- Include no credentials, customer data, invented benchmarks, unsupported production claims, or undocumented Google Cloud services.

## 5. Drafting and review sequence

1. Confirm the relevant call paths and supporting controls against source and tests.
2. Consult official Google documentation for any external API/platform claims needed in the final text.
3. Write the standalone summary, use-case table, and architecture notes.
4. Add the diagram and concise source references.
5. Check every technical claim against its evidence; remove unnecessary implementation detail and promotional language.

**Acceptance criteria:** The final Markdown document clearly answers what the project does, where Gemini is used, what data reaches the model, how outputs are handled, and which Google technologies are actually implemented. Its diagram must match the prose and the code.
