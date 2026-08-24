# HTTP Cancellation and Diagnostics Implementation Plan

**Goal:** 为浏览器 HTTP 请求建立可取消且有界的执行策略，并补齐 Server 与 Codex Provider 的结构化诊断链路。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/hook-guidelines.md` — Query 副作用必须处理取消和卸载清理。
- `.superwork/spec/frontend/state-management.md` — Snapshot 与 Query Cache 必须有界并在 Task 切换时回收。
- `.superwork/spec/backend/quality-guidelines.md` — 约束结构化日志、敏感内容和未知 Provider 事件告警。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 HTTP、RPC 和 Provider 生命周期超时。
- `docs/architecture-design.md` — 定义日志字段、请求耗时和端到端诊断边界。

**Architecture:** `packages/client` 在统一请求边界组合调用方 `AbortSignal` 与 `AbortSignal.timeout()`，并按 Query、普通读取和幂等 Mutation 选择固定策略；`apps/web` 的所有 TanStack Query 明确透传上下文 `signal`。`packages/server` 在 Fastify 创建阶段启用带字段脱敏的 Pino、设置全局 `handlerTimeout` 并记录请求耗时。`packages/provider-codex` 对未知通知与映射失败通过可注入的结构化 Logger 告警，只记录方法、固定 Codex 版本和关联 Project/Task 身份。

**Tech Stack:** TypeScript 6、Node.js 24 Fetch/AbortSignal、TanStack Query 5、Fastify 5/Pino、Vitest 4、pnpm Workspace。

## Global Constraints

- 不记录 Prompt、通知参数正文、完整命令输出、文件内容、认证 Header、Cookie 或 Secret。
- 保持 `protocol <- core <- provider-codex/server/client <- web` 依赖方向，不跨包深层导入。
- 只实现新取消、超时和日志策略，删除被替代的无界或静默路径，不增加旧行为兼容分支。
- 所有代码行为切片通过 `superwork-tdd` 执行，最终运行 `pnpm check`。

### Task 1: 建立 Client 请求取消和超时策略

- [x] **Task Status:** completed

<!-- task-fields -->

**Files:**

- Modify: `packages/client/src/http-client.ts`, `packages/client/src/http-client.test.ts`, `packages/client/src/index.ts`
- Modify: `apps/web/src/features/projects/project-queries.ts`, `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/features/workbench/hooks/use-background-terminals.ts`, `apps/web/src/features/workbench/components/project-source-dialog.tsx`
- Modify: `.superwork/spec/frontend/hook-guidelines.md`, `.superwork/spec/frontend/state-management.md`

**Interfaces:**

- Consumes: TanStack Query `QueryFunctionContext.signal` and existing Protocol response schemas
- Produces: exported Client read/request option and timeout policy types
- Produces: `MutationOptions` retains Idempotency Key semantics

- **Behavior Slice:** 为 Query 使用调用方取消信号与 Query 超时，为没有调用方信号的普通读取使用独立较短超时，为幂等 Mutation 使用独立较长超时；通过 `AbortSignal.any()` 组合信号，确保 Task/Project/文件/终端 Query 切换后旧 Fetch 被中止且不能完成解析校验后进入缓存。
- **Proof Intent:** 单元测试验证 Fetch 收到组合后的 `signal`、调用方中止会 Reject、三类策略使用各自超时；Query 测试验证 TanStack Query 的 `signal` 被传给 Client，并保持分页参数正确。

<!-- task-verification -->

**Verification:** run `pnpm exec vitest run packages/client/src/http-client.test.ts apps/web/src/features/projects/project-queries.test.tsx`.

Expected: all selected tests pass with cancellation and timeout assertions.

**Stop Conditions:**

- 若目标运行时不支持 `AbortSignal.any()` 或 `AbortSignal.timeout()`，停止并修订架构。
- 若某个 Query Client 接口无法在不泄漏 React 类型到 `packages/client` 的前提下接收 `signal`，停止并修订接口。

### Task 2: 启用 Fastify 有界处理和脱敏结构化日志

- [x] **Task Status:** completed

<!-- task-fields -->

**Files:**

- Modify: `packages/server/src/app.ts`, `packages/server/src/app.test.ts`
- Modify: `.superwork/spec/backend/quality-guidelines.md`, `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `docs/architecture-design.md`

**Interfaces:**

- Consumes: Fastify 5 `handlerTimeout`, Logger/Pino options and request lifecycle
- Produces: `CreateCodexlyServerOptions` 中可测试覆盖的 Logger 与 handler timeout 配置
- Produces: `createCodexlyServer` retains its `FastifyInstance` return contract

- **Behavior Slice:** 在 Fastify 实例创建时默认启用 JSON Pino，脱敏认证、Cookie 和 API Key 字段，设置非零 `handlerTimeout`，并让完成日志携带 `durationMs`、`requestId`、method、route 与 statusCode；测试可显式关闭或注入 Logger，生产默认不能在运行时保持 Null Logger。
- **Proof Intent:** `inject` 测试验证默认 `handlerTimeout` 非零；内存日志流验证完成日志存在耗时与请求身份且敏感 Header 被替换，错误仍走现有协议映射。

<!-- task-verification -->

**Verification:** run `pnpm exec vitest run packages/server/src/app.test.ts`.

Expected: Fastify timeout/logging tests and all existing route tests pass.

**Stop Conditions:**

- 若 Fastify 当前版本的 Logger 类型或生命周期字段与本地 `5.10.0` 不一致，停止并依据本地类型与官方文档修订。
- 若日志测试会输出真实敏感数据，立即停止并扩大脱敏范围。

### Task 3: 记录 Provider 被丢弃通知的安全诊断

- [x] **Task Status:** completed

<!-- task-fields -->

**Files:**

- Modify: `packages/provider-codex/src/agent-provider.ts`, `packages/provider-codex/src/agent-provider.test.ts`, `packages/provider-codex/src/index.ts`
- Modify: `packages/provider-codex/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- Modify: `.superwork/spec/backend/quality-guidelines.md`, `.superwork/spec/backend/runtime-lifecycle.md`

**Interfaces:**

- Consumes: `CodexRpcClient` notification method/params and pinned `SUPPORTED_CODEX_VERSION`
- Produces: minimal injectable Provider Logger contract
- Produces: structured `unknown_notification` and `invalid_notification` warnings

- **Behavior Slice:** 将映射异常和未知通知从静默 `return` 攣为告警后丢弃；字段只包含 diagnostic code、method、Codex version、projectId、可提取的 taskId，不序列化 params、Prompt 或 Item 内容；正常事件和后续关键事件处理不受单条坏通知影响。
- **Proof Intent:** 测试注入 Spy Logger，分别触发未知方法与字段漂移，断言告警字段完整且不包含输入正文，并断言后续合法通知仍发布。

<!-- task-verification -->

**Verification:** run `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts`.

Expected: diagnostic and existing mapping/lifecycle tests pass.

**Stop Conditions:**

- 若引入 Logger 会使 Provider 反向依赖 Server，停止并改用 Provider 自有最小接口。
- 若无法从通知安全提取 Task ID，则记录 `taskId: null`，不得记录原始参数补偿。

### Task 4: 完成跨层验证

- [x] **Task Status:** completed

<!-- task-fields -->

**Files:**

- Modify: `.superwork/plans/2026-07-29-http-cancellation-and-diagnostics.md` task status only after each proof passes

**Interfaces:**

- Consumes: 前三个任务的测试与文档证据
- Produces: 可由 `superwork-check` 审核的完成计划和干净的类型/依赖边界结果

- **Behavior Slice:** 格式化改动并运行项目统一门禁，确认 Client、Web、Server、Provider、协议边界和发布构建共同通过。
- **Proof Intent:** 检查无遗漏 Query、无固定 `logger: false`、无 Provider 静默映射 catch，并确认所有变更文件均由 Prettier、ESLint、TypeScript、Vitest、构建和包校验覆盖。

<!-- task-verification -->

**Verification:** run Prettier for the changed files, then run `pnpm check`.

Expected: both commands exit with code 0 and no warnings are treated as errors.

**Stop Conditions:**

- 任一门禁失败时停止完成声明并回到对应任务修复。
- 若失败属于既有且与本计划无关的工作区状态，保留证据并交由 `superwork-check` 判断。
