# Agent Actions Mutation Implementation Plan

**Goal:** 完成创建 Task、提交 Prompt、运行 Turn 与中断 Turn 的首条可用写入闭环，并通过真实 Fake App Server 覆盖完成与中断路径。

**Suggested Spec Reads:**

- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex App Server RPC、事件和关闭生命周期。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Fastify Schema、错误翻译与 Fake App Server 测试。
- `.superwork/spec/frontend/state-management.md` — 约束 Snapshot、实时事件、重连和状态清理。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Composer 交互、可访问性和工作台视觉。
- `.superwork/spec/shared/quality-guidelines.md` — 约束公开 Schema、Provider 能力和跨包契约。
- `docs/architecture-design.md` — 定义 Task/Turn 数据流与 Provider 无关边界。
- `docs/web-design.md` — 定义 Prompt Input、Mutation 和实时 Timeline 的组合方式。

**Architecture:** 在 `protocol` 定义 Provider 无关的输入、Mutation、能力及错误契约；`core` 扩展写入端口；Codex Adapter 负责 RPC 映射与原生响应校验；Server 用 Fastify Schema 和进程内幂等表交付 API；Client 校验响应；Web 以受控草稿和实时 Snapshot 派生 Composer 状态。所有新增行为沿现有 `protocol <- core <- provider/server/client <- web` 方向实现。

**Tech Stack:** TypeScript 6、TypeBox、Fastify 5、React 19、TanStack Query/Router、Vitest、Playwright、pnpm。

## Global Constraints

- 所有 Mutation 必须要求非空 `Idempotency-Key`，同一 Key 与同一操作返回首次成功响应，不得重复调用 Provider。
- Web 不接触 Codex `thread` 原生命名；Codex 原生请求与响应只存在于 `packages/provider-codex`。
- Prompt 失败必须保留草稿；只有创建 Turn 成功后清空草稿。
- 运行态由 Snapshot 与实时事件驱动；`reconnecting` 不丢失已呈现内容，`failed` 保留可重试输入。
- 关键逻辑添加简短、清晰的中文注释，删除被新写入链路取代的禁用占位逻辑。
- 不新增兼容旧 Mutation 结构或原生 RPC 透传接口。

### Task 1: 定义 Mutation 契约与 Core 写入端口

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `AgentTaskSchema`, `AgentTurnSchema`, `AgentCapabilitiesSchema`, `AgentProvider`
- Produces: `AgentMutationSchemas` — structured input, request/response/error schemas and expanded capabilities
- Produces: `AgentProviderMutations` — `startTask`, `startTurn`, and `interruptTurn`

**Behavior Slice:** 用 TypeBox 判别联合表达文本 Agent Input，并让能力与端口明确声明 Task 创建、Turn 启动和中断；非法空输入、未知字段和不完整响应必须在 Schema 边界失败。

**Proof Intent:** 协议测试验证全部合法/非法 Mutation 样例；Core 类型测试用 Fake Provider 证明三个写入方法接受和返回统一契约。

**Verification:** Run `pnpm exec vitest run packages/protocol/src/project.test.ts packages/core/src/agent-provider.test.ts`; expect all targeted tests to pass.

Expected: targeted Protocol and Core tests exit 0.

**Stop Conditions:**

若 Codex 0.145.0 的 RPC 参数无法映射到 Provider 无关输入，或现有能力结构无法在不破坏读取消费者的情况下扩展，则先修订本计划接口。

### Task 2: 实现 Codex 写入映射

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/test/fixtures/fake-app-server.mjs`

**Interfaces:**

- Consumes: `AgentMutationSchemas` — structured input, request/response/error schemas and expanded capabilities
- Consumes: `AgentProviderMutations` — `startTask`, `startTurn`, and `interruptTurn`
- Produces: `CodexMutationMapping` — validated `thread/start`, `turn/start`, and `turn/interrupt` adapter mapping

**Behavior Slice:** 创建 Task 固定使用当前 Project `rootPath`；提交文本输入映射到 Codex `input`；中断必须带已验证的 Task/Turn ID；成功写入立即把 Task ID 纳入项目事件白名单，使随后通知进入现有事件链路。

**Proof Intent:** Fake RPC 单元测试精确断言 method/params、响应映射、项目归属和畸形响应拒绝；Fake App Server 支持可控完成与中断通知。

**Verification:** Run `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts`; expect write RPC mapping and existing read/event tests to pass.

Expected: targeted Codex Provider tests exit 0.

**Stop Conditions:**

若已安装 Codex 类型或协议文档显示参数名与假设不一致，按本地 0.145.0 协议定义修订统一映射后更新计划。

### Task 3: 交付幂等 HTTP API 与 Client Mutation

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `packages/client/src/index.ts`

**Interfaces:**

- Consumes: `AgentMutationSchemas` — structured input, request/response/error schemas and expanded capabilities
- Consumes: `AgentProviderMutations` — `startTask`, `startTurn`, and `interruptTurn`
- Produces: `AgentMutationHttpApi` — three idempotent POST endpoints
- Produces: `CodeAgentClientMutations` — typed create/start/interrupt methods

**Behavior Slice:** Fastify 在调用 Provider 前校验 Params、Body 和 `Idempotency-Key`；同操作同 Key 复用完成中的 Promise 或成功响应，不同 payload 复用同 Key 返回冲突；Provider/归属错误翻译为结构化错误；Client 发送 JSON 并校验响应。

**Proof Intent:** `app.inject` 覆盖缺失/空 Key、非法 Body、重复请求、冲突 Key、未知资源和成功状态码；Client 测试覆盖路径、Header、Body、响应 Schema 与失败保留。

**Verification:** Run `pnpm exec vitest run packages/server/src/app.test.ts packages/client/src/http-client.test.ts`; expect all targeted tests to pass.

Expected: targeted Server and Client tests exit 0.

**Stop Conditions:**

若中断 API 仅凭 `turnId` 无法安全验证 Task/Project 归属，则通过 Provider 返回明确的 not-found/conflict 错误，不得绕过归属检查。

### Task 4: 启用 Composer 状态机与实时控制

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/conversation/runtime/use-task-runtime.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/shared/ai-elements/prompt-input.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`

**Interfaces:**

- Consumes: `CodeAgentClientMutations` — typed create/start/interrupt methods
- Consumes: `TaskRuntimeState` — Snapshot status, active Turn, connection state and refetch lifecycle
- Produces: `ComposerMutationState` — `idle | submitting | running | reconnecting | failed`
- Produces: `WorkbenchComposerActions` — submit, create-and-submit, and interrupt user actions

**Behavior Slice:** 无 Task 时提交先创建 Task 再启动 Turn 并导航；已有 Task 直接启动 Turn；`submitting` 防止重复提交；运行时按钮显示停止图标并中断当前运行 Turn；重连时禁用操作；失败展示可访问错误且保留草稿；成功提交清空草稿，实时事件继续更新 Timeline。

**Proof Intent:** Testing Library/Vitest 覆盖五种状态、创建和续写、重复提交防护、成功清稿、失败保稿及停止按钮调用。

**Verification:** Run `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-composer.test.tsx apps/web/src/features/conversation/runtime/task-runtime.test.ts`; expect all targeted tests to pass.

Expected: targeted Composer and runtime tests exit 0.

**Stop Conditions:**

若 Router 导航或 Query 缓存无法在创建后建立 Snapshot 订阅，则先补充最小 Query 失效/导航接口，不引入全局 Store。

### Task 5: 覆盖真实写入闭环并更新稳定规范

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/provider-codex/test/fixtures/fake-app-server.mjs`
- Modify: `tests/fixtures/fake-realtime-server.mjs`
- Modify: `tests/realtime-path.test.ts`
- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: `AgentMutationHttpApi` — three idempotent POST endpoints
- Consumes: `WorkbenchComposerActions` — submit, create-and-submit, and interrupt user actions
- Produces: `FakeAgentActionScenarios` — completion and interruption App Server flows
- Produces: `AgentActionVerification` — integration, E2E, and stable-spec evidence

**Behavior Slice:** 在同一个真实 Fake App Server 进程中验证“提交 Prompt -> `turn/start` -> 流式回复 -> `turn/completed`”与“提交 -> `turn/interrupt` -> `turn/completed(interrupted)`”；规范记录幂等、能力和 Composer 状态约束。

**Proof Intent:** 集成测试验证 Client Mutation 与事件顺序；Playwright 从 Composer 操作并观察用户消息、流式 Agent 回复、完成后恢复提交按钮及中断终态。

**Verification:** Run `pnpm check` then `pnpm test:e2e`; expect both commands to exit 0 with the new completion and interruption paths passing.

Expected: `pnpm check` and `pnpm test:e2e` both exit 0.

**Stop Conditions:**

若 Fake App Server 与浏览器测试暴露跨层协议漂移，返回最早失败的任务修复，不在 E2E 中添加绕过生产代码的专用路径。
