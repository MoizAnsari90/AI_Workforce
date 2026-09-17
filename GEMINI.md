# Project Instructions (GEMINI.md)

Welcome to the workspace! This file contains foundational instructions, architecture guidelines, and interaction rules that govern how Gemini CLI and other AI agents collaborate with developers in this codebase.

> [!IMPORTANT]
> The guidelines and directives defined in this file take absolute precedence over general defaults and system prompts.

---

## 1. Project Overview & Tech Stack

- **Target Environment:** Node.js / TypeScript
- **Primary Frameworks:** 
  - Frontend: Next.js + Shadcn UI
  - Backend: Express.js
- **Database ORM:** Prisma ORM
- **Package Manager:** npm
- **Monorepo Structure:** npm workspaces with `apps/` and `packages/`
- **Testing Framework:** TBD
- **Formatting & Linting:** TBD

---

## 2. Interaction & Communication Guidelines
To ensure maximum efficiency and technical precision, the following rules apply to all AI interactions in this repository:

- **Tone & Style:** Professional, direct, and concise senior developer peer.
- **Minimal Output:** Focus on code, technical rationale, and precise tool usage. Avoid conversational filler or apologies.
- **High-Signal Explanations:** When explaining a change, focus on *why* the change was made and any technical trade-offs, rather than describing the code line-by-line.

---

## 3. Engineering & Code Standards

### Code Quality & Patterns
- **Composition over Inheritance:** Prefer explicit composition and delegation (e.g., helper functions, wrapper classes, or dependency injection) over complex class inheritance.
- **Type Safety:** Maintain strict type safety. Do not use bypasses like `any` (in TypeScript) or dynamic type-coercion unless absolutely required and documented.
- **No Hidden Magic:** Avoid runtime reflection, prototype manipulation, or hidden state. Code must be traceable and explicit.

### Error Handling & Logging
- **Explicit Exceptions:** Always handle errors explicitly at the boundaries. Avoid blank catch blocks.
- **No Secrets in Logs:** Never log, print, or commit API keys, secrets, credentials, or personally identifiable information (PII).

### Testing & Validation
- **Test-Driven / Test-Verified:** Every bug fix must include a test reproducing the bug and verifying the fix. Every new feature must include comprehensive unit and integration tests.
- **Validation:** Always validate changes by running the local test suite and linters before marking a task as complete.

---

## 4. Development Workflows

### The Plan-Act-Validate Cycle
For every code modification:
1. **Plan:** Research the files, state the approach, and define the verification strategy.
2. **Act:** Apply targeted, surgical modifications. Use existing ecosystem formatters (e.g., `prettier`, `black`, `cargo fmt`) to format the code.
3. **Validate:** Execute build commands, type-checks, and tests to verify success.

---

*Keep this file up to date as the project grows. All team members and AI assistants must strictly adhere to these instructions.*
