# ACP 聊天任务分支

**Goal:** 在 Web 与桌面从聊天消息创建独立任务，命名为「原任务名 的复制」。

**Suggested Spec Reads:**

- `.superwork/spec/core/shared/index.md` 说明会话与历史持久化契约。
- `.superwork/spec/guides/index.md` 说明跨端和验证要求。

**Architecture:** 两端复用现有任务分支入口，共用 ACP 适配器处理原生分支和历史接续。

**Tech Stack:** TypeScript、React、Fastify、Tauri、ACP v1。

## Global Constraints

- 共享适配器维护会话和历史，沿用分组、增量渲染及任务导航。

### Task 1: 共享 ACP 会话及历史分支

**Files:**

- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/task-attachments.ts`
- Modify: `packages/provider-acp/src/connection.ts`
- Modify: `packages/provider-acp/src/event-projection.ts`
- Modify: `packages/provider-acp/src/history-use.ts`
- Modify: `packages/provider-acp/src/history.ts`
- Modify: `packages/provider-acp/src/provider.ts`
- Modify: `packages/provider-acp/src/replay.ts`
- Modify: `packages/provider-acp/src/task-continuation.ts`
- Modify: `packages/provider-acp/src/task-management.ts`
- Create: `packages/provider-acp/src/connection-callbacks.ts`
- Create: `packages/provider-acp/src/connection-cancellation.ts`
- Create: `packages/provider-acp/src/fork-cursors.ts`
- Test: `packages/provider-acp/src/provider-task-fork.test.ts`
- Create: `packages/provider-acp/src/task-fork.ts`

**Interfaces:**

- Consumes: `AcpHistory` 与 ACP Agent 能力
- Produces: AgentProvider.forkTask

**Behavior:**

- 按选定消息截断并保留可继续的会话。相同幂等键复用结果。

**Stop Conditions:**

- 暂停受无法校验的任务归属或未解决的跨端接口所阻塞的变更。

- [x] **Task Status:** completed

Run: `pnpm test packages/provider-acp/src/provider-task-fork.test.ts`

Expected: 分支历史、续聊和原生游标测试通过。

### Task 2: 贯通两端传输

**Files:**

- Modify: `desktop/src-tauri/src/application/acp_task_commands.rs`
- Modify: `desktop/src-tauri/src/application/acp_task_management.rs`
- Test: `desktop/src/platform/tauri/sidebar-client.test.ts`
- Modify: `desktop/src/platform/tauri/sidebar-client.ts`
- Modify: `desktop/src/protocol/agent-actions.ts`
- Modify: `packages/protocol/src/acp-capabilities.ts`
- Modify: `packages/protocol/src/agent-actions.ts`
- Modify: `packages/provider-acp/src/host-dispatch.ts`
- Test: `packages/server/src/app-task-mutations.test.ts`
- Modify: `packages/server/src/routes/task-action-routes.ts`

**Interfaces:**

- Consumes: AgentProvider.forkTask
- Produces: `ForkAgentTaskRequest`、Web fork 路由与桌面 task.fork 宿主消息

**Behavior:**

- 传输消息定位及幂等身份，校验任务归属。

**Stop Conditions:**

- 暂停受无法校验的任务归属或未解决的跨端接口所阻塞的变更。

- [x] **Task Status:** completed

Run: `pnpm typecheck`

Expected: 共享协议与 Web 调用通过类型检查。

### Task 3: 在复制旁显示分支入口

**Files:**

- Modify: `apps/web/src/features/search/history-task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-contracts.ts`
- Test: `apps/web/src/features/workbench/components/task-timeline-messages.test.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-status.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store-assistant.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store-items.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-active-task.tsx`
- Modify: `desktop/src/features/search/history-task-timeline.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-contracts.ts`
- Modify: `desktop/src/features/workbench/components/task-timeline-status.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-store-assistant.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-store-items.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-shell-active-task.tsx`
- Test: `tests/e2e/app-shell-composer-actions.spec.ts`

**Interfaces:**

- Consumes: `ForkAgentTaskRequest`
- Produces: 用户与助手消息操作

**Behavior:**

- 复制旁展示分支入口，完成后进入新任务。

**Stop Conditions:**

- 暂停受无法校验的任务归属或未解决的跨端接口所阻塞的变更。

- [x] **Task Status:** completed

Run: `pnpm test apps/web/src/features/workbench/components/task-timeline-messages.test.tsx`

Expected: 消息操作回归通过。

## 验证记录

- 新增回归先确认缺少分支实现和消息操作入口时的失败，再通过原生游标、降级历史接续、幂等重试和 Web 路由传参测试。
- ACP 适配器、Web 任务接口和聊天时间线组合回归通过 489 项，11 项按现有配置跳过。桌面单元测试通过 837 项。
- Web 分支按钮的选中消息定位与跳转在 Chromium、Firefox、WebKit 通过。桌面 ACP 会话及时间线在 Chromium、WebKit 通过 30 项。
- Node / Web 与桌面前端生产构建、两端类型检查通过。Web 性能通过 14 项，1 项按现有配置跳过。
- 最终全仓 Vitest 通过 3660 项，19 项按现有配置跳过。桌面 Rust 主套件通过 520 项，8 项忽略，额外平台集成通过 6 项。编译 ACP 宿主通过 11 项。
- 两端 lint、架构、格式及包体预算通过。Web 发布包检查通过。真机 Agent 账号与 Windows、Ubuntu 桌面运行留待对应环境验收。
