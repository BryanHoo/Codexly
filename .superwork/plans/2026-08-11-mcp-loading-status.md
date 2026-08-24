# Feature Implementation Plan

**Goal:** 在 MCP 启动状态变化时实时显示每个服务正在加载、加载成功或失败，并移除列表底部的 Provider 描述。

**Suggested Spec Reads:**

- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex App Server 通知、Provider 生命周期与事件映射。
- `.superwork/spec/frontend/state-management.md` — 约束实时事件与 React Query 状态同步。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector MCP 行的展示职责。
- `.superwork/spec/shared/quality-guidelines.md` — 约束跨包协议、Schema 与契约测试。

**Architecture:** 将 Codex `mcpServer/startupStatus/updated` 映射为 Provider 无关的 `mcp_server.status_updated` 事件，经现有 Project WebSocket 事件流交付；Web 收到事件后仅刷新对应 Task 的 MCP 状态页，继续由 `mcpServerStatus/list` 提供工具数和认证元数据。MCP 行只保留状态元数据、失败原因和错误日志，不再渲染 `description`。

**Tech Stack:** TypeScript、TypeBox、Fastify/WebSocket、React、TanStack Query、Vitest、Playwright、pnpm。

## Global Constraints

- 保持 MCP 清单只暴露当前 Task 可读取的安全字段，不传递工具定义、资源、URL、Secret 或原生 Provider 结构。
- 复用现有 Project 事件流和 React Query 缓存，不新增轮询或第二套状态通道。
- 所有外部通知先完成运行时校验和错误脱敏，再进入统一协议。
- 不保留旧的 MCP 描述展示逻辑，不启动开发服务器。

### Task 1: 发布统一 MCP 启动状态事件

**Files:**

- Modify: `packages/protocol/src/agent-event.ts`
- Modify: `packages/protocol/src/agent-event.test.ts`
- Modify: `packages/provider-codex/src/agent-provider-runtime.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: Codex `mcpServer/startupStatus/updated` notification and `readMcpServerStartupStatus`
- Produces: `McpServerStatusUpdatedEvent`

**Behavior:**

- 在已验证 Project Task 的 MCP 启动状态变化时更新 Provider 缓存并发布严格、脱敏、可恢复的统一事件；归属未验证时遵循现有事件暂存规则。

**Stop Conditions:**

- 若锁定 Codex Schema 不包含 `mcpServer/startupStatus/updated`，或通知无法关联 Task，则停止并重新评估协议边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/agent-event.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: MCP 状态事件通过 Protocol 校验，并由 Provider 对已验证 Task 发布且保留脱敏错误。

### Task 2: 实时刷新 MCP 列表并移除描述

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/project-runtime-history.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-events.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`
- Modify: `apps/web/src/features/projects/project-query-options.ts`
- Test: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/features/projects/project-provider.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-sections.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

**Interfaces:**

- Consumes: `McpServerStatusUpdatedEvent`
- Consumes: Task MCP React Query key
- Produces: `McpServerQueryRefresh`
- Produces: Description-free MCP row rendering

**Behavior:**

- Web 收到每个 MCP 状态事件后只刷新对应 Task 的 MCP 清单，使 `starting`、`ready`、`failed`、`cancelled` 逐项更新；MCP 行不再渲染 `server.description`。

**Stop Conditions:**

- 若 Project Runtime 无法安全访问查询缓存，或事件会导致跨 Project/Task 刷新，则停止并调整回调接口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/project-runtime.test.ts apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: MCP 事件只触发目标 Task 刷新，加载与成功状态可见，Provider 描述不出现在渲染结果中。

### Task 3: 固化约束并验证完整链路

**Files:**

- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `tests/e2e/app-shell-runtime.spec.ts`

**Interfaces:**

- Consumes: `McpServerStatusUpdatedEvent`
- Consumes: `McpServerQueryRefresh`
- Produces: Stable architecture constraints and browser-level regression coverage

**Behavior:**

- 记录 MCP 启动通知实时交付与描述隐藏规则，并验证列表能展示逐项加载/成功状态且不显示 `serverInfo.description`。

**Stop Conditions:**

- 若端到端 Fixture 无法在不依赖真实 Codex 进程的情况下稳定模拟事件，则停止并使用等价的契约测试证明链路。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 全量质量门禁通过，MCP 实时状态和描述隐藏无协议、类型、架构或构建回归。
