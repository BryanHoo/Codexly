# Pending Request Loop Implementation Plan

**Goal:** 为命令审批、文件变更审批和 User Input 建立可恢复、可幂等解决的端到端双向请求闭环。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` - 约束跨层改动、验证命令和工程边界。
- `.superwork/spec/shared/index.md` - 约束 Protocol、Core 与 Client 的公开契约和依赖方向。
- `.superwork/spec/backend/index.md` - 约束 Provider 服务端请求、Fastify 校验和运行时生命周期。
- `.superwork/spec/frontend/index.md` - 约束 Snapshot、实时事件、语义控件和页面恢复。
- `docs/architecture-design.md` - 定义 Codex 审批映射、Pending Request 身份与安全边界。
- `docs/web-design.md` - 定义 Confirmation、User Input 与断线恢复交互。

**Architecture:** 在 Protocol 中定义带 `type` 判别字段的 `PendingRequest` 联合、解决请求/响应和三类生命周期事件；Core Provider 端口持有原生请求关联并执行最终身份校验；Codex Adapter 将 JSON-RPC Server Request 转换为统一请求，在本地解决、原生清理或 Turn 终止时发布状态事件；Server 暴露统一幂等解决路由；Client 与 Web 只消费已校验协议，并以 Snapshot + Agent Event 恢复交互状态。

**Tech Stack:** TypeScript、TypeBox、Codex App Server JSONL/RPC、Fastify 5、React 19、TanStack Query、AI Elements、Vitest、Playwright、pnpm。

## Global Constraints

- 保持 `protocol <- core <- provider-codex <- server` 与 `protocol <- client <- web` 依赖方向，只从包根入口导入。
- `PendingRequest` 必须使用 `command_approval`、`file_change_approval`、`user_input` 判别值，Provider 原生字段不得直接泄漏到 Web。
- 解决请求必须校验 `projectId + taskId + turnId + itemId + requestId`、请求类型和当前状态。
- 所有 Mutation 必须要求 `Idempotency-Key`；相同 Key 与 Payload 复用结果，冲突 Payload 返回冲突。
- Snapshot 只返回当前未解决请求；实时状态可保留本次会话内的 `resolved` 或 `expired` 终态说明。
- Turn 完成、中断或原生 `serverRequest/resolved` 清理未解决请求时必须发布 `pending_request.expired`。
- 关键逻辑添加简短、清晰的中文注释，不保留冗余旧逻辑。

### Task 1: Define Protocol And Core Contracts

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/agent-event.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/protocol/src/agent-event.test.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: Existing `AgentTaskSnapshotSchema`, `AgentEventSchema`, `AgentMutationErrorSchema` and `AgentProvider` public contracts.
- Produces: `PendingRequestSchema`, `ResolvePendingRequestRequestSchema`, `ResolvePendingRequestResponseSchema`, three pending-request event variants, Snapshot `pendingRequests`, pending-request error codes and `AgentProvider.resolvePendingRequest(input)`.

**Behavior Slice:** Protocol Schema accepts all supported Pending Request/event/resolve variants, rejects malformed identities and cross-type resolutions, while the Core transport type strips only event transport fields.

**Proof:** Add schema and type-level unit coverage for each discriminant, Snapshot hydration fields, terminal lifecycle events and invalid extra/missing identity fields.

**Verification:** Run `pnpm exec vitest run packages/protocol/src/project.test.ts packages/protocol/src/agent-event.test.ts packages/core/src/agent-provider.test.ts`.

**Expected:** All selected tests pass with no schema or type failures.

**Stop Conditions:**

- Stop for plan repair if a required public contract would create a reverse dependency, or if Codex-native response types cannot be represented without exposing arbitrary JSON-RPC payloads.

### Task 2: Implement Codex Provider Request Lifecycle

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/src/jsonl-rpc-client.test.ts`
- Modify: `packages/provider-codex/test/fixtures/fake-app-server.mjs`

**Interfaces:**

- Consumes: `CodexRpcClient.onServerRequest`, `CodexRpcClient.respondToServerRequest`, three Codex request methods, `serverRequest/resolved` and Turn terminal notifications.
- Produces: `PendingRequestResolutionError`, unified `PendingRequest` records, Codex approval/User Input response payloads, Snapshot unresolved requests and three pending-request event variants.

**Behavior Slice:** A Server Request is created exactly once, survives a Task read, resolves once through the matching JSONL request ID, and expires without response when Codex or the Turn clears it.

**Proof:** Use unit fixtures and Fake App Server scenarios to cover command allow, file deny, User Input, duplicate resolution attempt, expiration, Turn early completion and read-after-request recovery.

**Verification:** Run `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts packages/provider-codex/src/jsonl-rpc-client.test.ts packages/provider-codex/src/app-server-process.test.ts`.

**Expected:** All selected tests pass, and Fake App Server receives each expected response exactly once.

**Stop Conditions:**

- Stop for debugging if generated Codex 0.145.0 bindings disagree with actual Fake App Server frames, or if request cleanup can race into two terminal events.

### Task 3: Add The Idempotent Server And Client Resolve Path

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `packages/client/src/index.ts`

**Interfaces:**

- Consumes: Protocol resolve body/response Schema, `AgentProvider.resolvePendingRequest`, existing Fastify idempotency cache and Client mutation boundary.
- Produces: `POST /v1/pending-requests/:requestId/resolve`, normalized pending-request errors and `CodeAgentClient.resolvePendingRequest(request, resolution, options)`.

**Behavior Slice:** Matching identities resolve once and return the terminal request; same key/payload replays the result, while changed payloads, cross-Task identities and expired requests fail without a second Provider response.

**Proof:** Fastify `inject` and Client fetch tests cover allow, deny, duplicate submission, idempotency conflict, cross-Task identity, expired state and malformed responses.

**Verification:** Run `pnpm exec vitest run packages/server/src/app.test.ts packages/client/src/http-client.test.ts`.

**Expected:** All selected tests pass; duplicate requests call the Provider once and invalid identities call it zero times.

**Stop Conditions:**

- Stop for plan repair if the existing generic idempotency cache cannot distinguish request resources without changing unrelated mutation semantics.

### Task 4: Render And Recover Pending Requests In Web

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/shared/ai-elements/confirmation.tsx`
- Create: `apps/web/src/features/workbench/components/pending-request.tsx`
- Create: `apps/web/src/features/workbench/components/pending-request.test.tsx`
- Modify: `apps/web/src/features/conversation/runtime/task-runtime.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-runtime.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/use-task-runtime.ts`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: Snapshot `pendingRequests`, pending-request Agent Events and `CodeAgentClient.resolvePendingRequest`.
- Produces: AI Elements `Confirmation`, semantic approval/User Input controls, request submission states and Task Runtime pending-request reconciliation.

**Behavior Slice:** Snapshot hydration restores an unresolved request after refresh, realtime events create/resolve/expire it, and the user can complete approval or User Input without duplicate submission or cross-Task response.

**Proof:** Reducer and component tests cover all control variants, allow, deny, duplicate click suppression and expired state; Playwright covers refresh recovery and Fake App Server approval/User Input flows.

**Verification:** Run `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-runtime.test.ts apps/web/src/features/workbench/components/pending-request.test.tsx apps/web/src/shared/ai-elements/ai-elements.test.tsx`, then `pnpm test:e2e`.

**Expected:** All selected tests and Playwright flows pass with no console, overflow or accessibility errors.

**Stop Conditions:**

- Stop for debugging if the WebSocket event arrives before the HTTP result and produces inconsistent terminal UI, or if focus/accessibility behavior cannot be asserted with existing test infrastructure.

## Final Verification

- Run `pnpm check`; expect formatting, lint, dependency boundaries, unit tests, typecheck, production builds and package checks to pass.
- Run `pnpm test:e2e`; expect full browser flows, Fake App Server approval/User Input, expiration and refresh recovery to pass.
- Inspect `git diff --check`; expect no whitespace errors.
