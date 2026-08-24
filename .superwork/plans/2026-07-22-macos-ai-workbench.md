# Feature Implementation Plan

**Goal:** Build a polished macOS-native coding-agent workbench page inspired by Codex and Cursor while using source-owned AI Elements patterns.

**Suggested Spec Reads:**

- `.superwork/spec/frontend/index.md` — defines the Web package boundaries, quality gates, and accessibility expectations.
- `.superwork/spec/frontend/component-guidelines.md` — constrains component responsibilities and compact workbench composition.
- `.superwork/spec/frontend/quality-guidelines.md` — defines browser behavior and E2E verification requirements.
- `docs/web-design.md` — defines the three-region shell, AI Elements ownership model, Composer behavior, and responsive rules.

**Architecture:** Add a small source-owned AI Elements presentation layer under `shared/ai-elements`, then compose it in the existing workbench feature. Keep all state local and presentational, preserve the current route contract, and do not introduce AI SDK Runtime, transport, or protocol changes.

**Tech Stack:** React 19, TypeScript, Vite 8, Tailwind CSS 4, lucide-react, Playwright, pnpm.

## Global Constraints

- Keep Web dependencies within `@code-agent/client`, `@code-agent/protocol`, and existing frontend libraries.
- Adapt AI Elements component composition without importing `ai` or `@ai-sdk/react`.
- Use macOS-native density, restrained neutral surfaces, project green status accents, semantic HTML, keyboard focus, and accessible names.
- Keep runtime-dependent mutations disabled until a real client contract exists.
- Add concise Chinese comments only around key composition or interaction logic.

### Task 1: Add source-owned AI Elements primitives

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/shared/ai-elements/conversation.tsx`
- Create: `apps/web/src/shared/ai-elements/message.tsx`
- Create: `apps/web/src/shared/ai-elements/reasoning.tsx`
- Create: `apps/web/src/shared/ai-elements/tool.tsx`
- Create: `apps/web/src/shared/ai-elements/prompt-input.tsx`
- Create: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`

**Interfaces:**

- Consumes: `ReactHTMLProps` — standard React HTML element props.
- Consumes: `IconButton` — existing accessible shared icon button.
- Produces: `AIElementsPrimitives` — composable `Conversation*`, `Message*`, `Reasoning*`, `Tool*`, and `PromptInput*` exports with no AI SDK types.

**Behavior Slice:** Render accessible, theme-aware conversation, message, structured activity, and Composer primitives that match AI Elements composition while remaining independent from business state.

**Proof Intent:** TypeScript and ESLint accept every primitive; controls expose names and collapsible states through semantic elements.

**Verification:** Run `pnpm typecheck && pnpm lint`.

Expected: Both commands exit with code 0.

**Stop Conditions:**

Stop for plan repair if an AI Elements primitive requires a new runtime or protocol dependency, or if existing shared UI cannot support accessible composition without changing its public contract.

### Task 2: Compose the macOS workbench shell

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Create: `apps/web/src/features/workbench/components/thread-sidebar.tsx`
- Create: `apps/web/src/features/workbench/components/thread-timeline.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/shared/ui/icon-button.tsx`
- Modify: `apps/web/src/shared/styles/globals.css`

**Interfaces:**

- Consumes: `AIElementsPrimitives` — composable `Conversation*`, `Message*`, `Reasoning*`, `Tool*`, and `PromptInput*` exports with no AI SDK types.
- Consumes: `WorkbenchShellProps` — existing `workspaceId` and optional `threadId` route inputs.
- Produces: `WorkbenchShell` — three-region responsive workbench preserving documented route behavior.

**Behavior Slice:** Replace the basic two-column shell with a polished three-region desktop workbench: repository/thread navigation, structured conversation timeline, Inspector context, and a bottom Composer. Add local collapse controls, accessible landmarks, empty workspace handling, and responsive drawer-like panel behavior without enabling runtime mutations.

**Proof Intent:** Desktop renders all three stable regions without overlap; narrow view keeps the timeline usable and exposes navigation/context toggles; Composer and server-dependent actions remain disabled.

**Verification:** Run `pnpm --filter @code-agent/web build`.

Expected: Vite production build exits with code 0.

**Stop Conditions:**

Stop for plan repair if the shell requires route, server, client, or protocol changes, or if responsive regions cannot remain usable at 390px without changing the requested three-region information architecture.

### Task 3: Lock user-visible behavior with E2E coverage

- [x] **Task Status:** completed

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `WorkbenchShell` — three-region responsive workbench preserving documented route behavior.
- Produces: `WorkbenchE2EProof` — Playwright assertions for desktop layout, panel toggles, disabled runtime actions, collapsible activity, and narrow viewport stability.

**Behavior Slice:** Verify that the new workbench is operable through accessible controls and remains stable across desktop and mobile-sized viewports.

**Proof Intent:** Tests fail against the old shell for missing Inspector and interaction controls, then pass against the completed implementation.

**Verification:** Run `pnpm test:e2e`.

Expected: All Playwright tests pass.

**Stop Conditions:**

Enter debugging if failures reproduce an implementation regression; repair the plan if the test requires undocumented backend behavior or external services.

### Task 4: Run final repository verification

- [x] **Task Status:** completed

**Files:**

- Modify: `.superwork/plans/2026-07-22-macos-ai-workbench.md`

**Interfaces:**

- Consumes: `WorkbenchE2EProof` — Playwright assertions for desktop layout, panel toggles, disabled runtime actions, collapsible activity, and narrow viewport stability.
- Produces: `WorkbenchVerificationEvidence` — auditable repository and visual verification result.

**Behavior Slice:** Validate formatting, lint, architecture, unit tests, production build, package shape, and browser behavior as one completed workbench change.

**Proof Intent:** The repository quality gate and E2E suite both complete without errors, and visual browser inspection shows no blank canvas, overlap, clipping, or broken responsive controls.

**Verification:** Run `pnpm check` and `pnpm test:e2e`.

Expected: Both commands exit with code 0 and visual inspection shows no layout defects.

**Stop Conditions:**

Enter debugging for a reproducible code or test regression; report a blocker if validation depends on unavailable external infrastructure after local alternatives are exhausted.
