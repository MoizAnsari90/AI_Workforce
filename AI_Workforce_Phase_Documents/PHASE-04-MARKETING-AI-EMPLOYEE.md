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

No unverified factual claims should be published automatically.

## Acceptance Criteria
- Business can define brand rules.
- Agent can create campaign/content plans.
- Content passes configured checks before publishing.
- Publishing is permission-controlled.
- Performance metrics can be recorded.
- Campaign activity is auditable.
- Human approval can be required.

## Non-Goals
- Fully autonomous ad-spend changes.
- Unlimited social platform integrations.

## Gemini Instruction
Treat external publishing as a tool with explicit permissions. Separate content generation from publishing.
