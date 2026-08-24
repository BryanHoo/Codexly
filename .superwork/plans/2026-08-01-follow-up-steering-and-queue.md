# Follow-up Steering And Queue Implementation Plan

**Goal:** 支持运行中的 Codex Task 接收引导消息或暂存后续消息，并通过全局设置选择默认行为。

**Suggested Spec Reads:**

- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex App Server RPC、Task 归属和运行态生命周期。
- `.superwork/spec/frontend/state-management.md` — 约束 Task 级实时状态与本地暂存状态边界。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Composer 组件职责和交互组件拆分。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束可访问性、浏览器流程和测试覆盖。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Protocol Schema、Client 边界校验和契约测试。
- `docs/architecture-design.md` — 确认 Provider、Server、Client 与 Web 的依赖方向。
- `docs/web-design.md` — 确认工作台 Composer 和全局设置的产品交互。

**Architecture:** 在 Provider 无关的 `AgentProvider` 能力中新增 `steerTurn`，由 Codex Adapter 映射到 `turn/steer`；Server 和 Client 暴露受控 Mutation。全局设置持久化 `followUpBehavior`。Web Composer 在运行中将提交分派为即时引导或 Task 级 FIFO 队列，队列在当前 Turn 结束后自动启动下一 Turn，并允许手动立即引导或取消。

**Tech Stack:** TypeScript、React 19、Fastify、TypeBox、SQLite、Vitest、Playwright、Codex App Server JSON-RPC。

## Global Constraints

- 保持 `protocol <- core <- provider-codex <- server` 与 `protocol <- client <- web` 依赖方向。
- 所有外部请求通过 TypeBox 严格 Schema 校验，并使用 Idempotency Key。
- `turn/steer` 必须携带 `expectedTurnId`，且不能接受 Turn 设置覆盖。
- 排队消息按 Task 隔离，附件只在实际发送时上传，取消或离开生命周期时释放预览资源。
- 不启动开发服务器；浏览器验证只复用现有可用页面，否则以 Playwright 测试为准并明确记录。

### Task 1: 暴露运行中引导契约

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/client/src/http-client.ts`
- Test: `packages/protocol/src/project.test.ts`
- Test: `packages/core/src/agent-provider.test.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`
- Test: `packages/server/src/app.test.ts`
- Test: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `AgentPromptInput`、`AgentProviderTurnInput`、活动 `taskId/turnId`。
- Produces: `steerTurn` Provider 端口、严格 HTTP Mutation Schema、`CodexlyClient.steerTurn` 和 `turns.steer` 能力位。

**Behavior:**

- 验证 Task 与活动 Turn 后，将统一 Prompt 输入映射为 `turn/steer { threadId, expectedTurnId, input }`，成功返回已接受的 Turn ID，错误保持受控边界。

**Stop Conditions:**

- 如果当前 Codex Schema 不支持 `turn/steer` 或返回契约无法确认，则停止 Provider 写入并报告阻塞。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/core/src/agent-provider.test.ts packages/provider-codex/src/agent-provider.test.ts packages/server/src/app.test.ts packages/client/src/http-client.test.ts`

Expected: 引导契约、RPC 映射、HTTP 校验和 Client 调用测试全部通过。

### Task 2: 持久化默认跟进行为

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/server/src/sqlite-state-repository.ts`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/app.ts`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Test: `packages/protocol/src/project.test.ts`
- Test: `packages/server/src/sqlite-state-repository.test.ts`
- Test: `packages/server/src/app.test.ts`
- Test: `apps/web/src/features/settings/components/global-settings-dialog.test.tsx`

**Interfaces:**

- Consumes: `AgentGlobalSettings` 与现有 `/v1/settings` 读写流程。
- Produces: 必填的 `followUpBehavior: "queue" | "steer"`、SQLite migration 和设置对话框控件。

**Behavior:**

- 新安装和升级后的设置默认使用 `queue`，用户可在全局设置中切换并持久化，读取和更新均通过严格 Schema。

**Stop Conditions:**

- 如果现有数据库迁移无法为旧记录提供确定默认值，则停止并修正迁移，不增加可空兼容分支。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/server/src/sqlite-state-repository.test.ts packages/server/src/app.test.ts apps/web/src/features/settings/components/global-settings-dialog.test.tsx`

Expected: 新旧数据库、HTTP 设置和设置对话框均稳定读写默认跟进行为。

### Task 3: 实现 Composer 引导与消息队列

**Files:**

- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/workbench/composer-draft-context.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Test: `apps/web/src/features/workbench/composer-draft-context.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`

**Interfaces:**

- Consumes: `followUpBehavior`、活动 Turn、`CodexlyClient.steerTurn`、Composer Prompt/Skill/Attachment 草稿。
- Produces: Task 级 `QueuedPrompt` FIFO、运行中提交分派、立即引导按钮、取消按钮和自动续发行为。

**Behavior:**

- 运行中提交按设置立即引导或追加队列；队列显示在输入框上方，单项可立即作为引导发送或取消，活动 Turn 完成后队首自动作为新 Turn 发送且失败时保留重试。

**Stop Conditions:**

- 如果无法在路由切换和附件预览释放之间保持明确所有权，则停止 UI 接线并先修正 Draft Store 生命周期。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/composer-draft-context.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx`

Expected: 引导、排队、立即发送、取消、FIFO 自动续发和 Task 隔离测试全部通过。

### Task 4: 覆盖浏览器流程并固化规范

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: 完整 Web -> Client -> Server -> Provider 跟进消息流程。
- Produces: 浏览器级行为证据与稳定工程约束。

**Behavior:**

- 浏览器覆盖设置切换、运行中排队、立即引导和取消；工程文档明确 `turn/steer` 与本地 FIFO 队列的边界。

**Stop Conditions:**

- 如果现有 E2E Harness 无法表达活动 Turn 与 steer Mutation，则先扩展受控 Harness，不依赖真实外部 Codex 服务。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全量质量门禁和浏览器流程通过，且 Chrome DevTools 检查无布局重叠或控制台错误；若无现有页面且按要求不启动服务，则记录未执行的人工 CDP 检查。
