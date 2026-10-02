# Phase 04 — Marketing AI Employee

## Goal
Create an AI Marketing Employee that researches, plans, creates, validates and measures marketing work.

## Depends On
Phase 03.

## Scope
- Brand profile
- Brand voice
- Content calendar
- Campaigns
- Content drafts
- Social publishing tools where integrations are available (Direct API execution for publishing)
- Campaign analytics
- Lead-generation attribution
- Marketing tasks
- Approval workflow
- Strict Human-in-the-Loop (HITL) Approval Gate before any public post, ad campaign launch, or ad-spend modification
- Cross-bundle privacy controls: do not expose patient intake notes, sensitive lead details, credentials, or regulated identifiers in campaign content, audiences, logs, or analytics
- Cross-bundle reliability controls: idempotent publishing actions, low-confidence human fallback, and auditable reminder/confirmation workflows

## Marketing Loop
Discover
→ Research
→ Plan
→ Create
→ Verify
→ Human approval if required
→ Publish
→ Measure
→ Learn
→ Repeat

## Brand Safety
Marketing Agent must follow:
- approved brand voice
- approved claims
- prohibited claims
- target audience
- business policies
- privacy and consent rules

No unverified factual claims should be published automatically. Marketing outputs must not infer or expose sensitive health information, and any low-confidence or policy-ambiguous output must route to a live human inbox before publication.

## Acceptance Criteria
- Business can define brand rules.
- Agent can create campaign/content plans.
- Content passes configured checks before publishing.
- Publishing is permission-controlled and idempotent.
- Performance metrics can be recorded.
- Campaign activity is auditable.
- Human approval can be required.
- Privacy, consent, duplicate-publication, and fallback paths are tested.

## Non-Goals
- Fully autonomous ad-spend changes.
- Unlimited social platform integrations.

## Gemini Instruction
Treat external publishing as a tool with explicit permissions. Separate content generation from publishing.
