# Task MCP Status Implementation Plan

**Goal:** 完整展示当前 Task 的 MCP 加载、成功、失败与安全诊断信息，并支持手动重新加载。

**Suggested Spec Reads:**

- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Task 归属、Codex App Server RPC、日志和运行时状态清理。
- `.superwork/spec/frontend/state-management.md` — 约束 TanStack Query 远端状态与手动 Mutation。
- `.superwork/spec/shared/quality-guidelines.md` — 约束公开 Schema、边界校验与契约测试。
- `docs/architecture-design.md` — 约束 Task 级 MCP Inspector 和 Provider 安全边界。
- `docs/web-design.md` — 约束 Inspector 加载、错误、成功和重试反馈。

**Architecture:** 使用 Codex `mcpServerStatus/list` 的分页清单作为成功详情源，使用 `mcpServer/startupStatus/updated` 作为 Task 级启动状态和错误源；Provider 合并并清理状态，Protocol 只公开安全字段。手动重试经幂等 HTTP Mutation 调用 `config/mcpServer/reload`，Web Query 在重新加载期间轮询并显示逐服务状态。

**Tech Stack:** TypeScript 6、TypeBox、Fastify 5、React 19、TanStack Query 5、Tailwind CSS 4、shadcn/Radix、Vitest、Playwright、pnpm。

## Global Constraints

- 保留 MCP 名称、Codex 错误消息等代码相关原文，界面解释使用中英文 i18n。
- 不向 Protocol 或 Web 暴露 MCP `command`、`args`、`env`、URL、工具定义、资源内容或 Secret。
- 所有写请求携带 `Idempotency-Key`，失败结果允许使用同一 Key 重试。
- 使用当前 Codex `0.146.0` 官方生成 Schema 中的状态、认证和重载契约，不保留旧的仅名称逻辑。
- 关键映射、状态归属与安全截断位置添加清晰中文注释。

### Task 1: 扩展共享 MCP 契约

**Files:**

- Modify: `packages/protocol/src/agent-task.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/agent-provider.test.ts`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `docs/architecture-design.md`

**Interfaces:**

- Consumes: Codex `McpServerStatus`、`McpServerStatusUpdatedNotification` 和 `McpAuthStatus`。
- Produces: 扩展后的 `AgentMcpServerPage` 与 `AgentProvider.reloadMcpServers(taskId)`。

**Behavior:**

- 定义逐服务启动状态、认证状态、工具数量、可空服务元数据、失败原因与安全错误日志，并通过严格 Schema 拒绝额外敏感字段。

**Stop Conditions:**

- 若官方 Codex `0.146.0` Schema 不包含状态通知或重载 RPC，则停止并重新确认接口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/core/src/agent-provider.test.ts`

Expected: 扩展后的 MCP 契约和 Provider 端口测试通过。

### Task 2: 映射 Codex MCP 生命周期

**Files:**

- Modify: `packages/provider-codex/src/agent-provider-notifications.ts`
- Modify: `packages/provider-codex/src/agent-provider-runtime.ts`
- Modify: `packages/provider-codex/src/agent-provider-base.ts`
- Create: `packages/provider-codex/src/agent-provider-mcp.ts`
- Modify: `packages/provider-codex/src/task-runtime-state.ts`
- Modify: `packages/provider-codex/src/runtime-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/src/task-runtime-state.test.ts`

**Interfaces:**

- Consumes: `mcpServerStatus/list`、`mcpServer/startupStatus/updated`、`config/mcpServer/reload`。
- Produces: Task 级合并状态、截断错误诊断和可轮询的重新加载结果。

**Behavior:**

- 捕获 Task 归属内的启动通知，校验并保存状态；分页读取成功详情并合并失败项；重试时标记已知服务为 `starting`、调用官方重载 RPC，并确保 Task 释放时清理状态。

**Stop Conditions:**

- 若通知在 Runtime Owner 建立前无法安全归属到 Project，则停止并补充显式暂存设计。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts packages/provider-codex/src/task-runtime-state.test.ts`

Expected: 分页、状态合并、错误映射、重载和清理测试全部通过。

### Task 3: 提供幂等重试 API

**Files:**

- Modify: `packages/protocol/src/agent-actions.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/server/src/routes/task-action-routes.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client-projects.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/web/src/features/projects/project-query-options.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`

**Interfaces:**

- Consumes: `AgentProvider.reloadMcpServers(taskId)` 与现有 `runIdempotent`。
- Produces: `POST /v1/projects/:projectId/tasks/:taskId/mcp-servers/retry`、`CodeAgentClient.retryMcpServers` 和 Query Mutation options。

**Behavior:**

- 为当前 Project/Task 校验归属，以幂等写操作触发重载，返回新状态页，并使前端可更新相同 Query Cache。

**Stop Conditions:**

- 若临时 Task 路由不能通过现有 Project 路径重写共享端点，则停止并补齐路由映射测试。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts packages/client/src/http-client.test.ts apps/web/src/features/projects/project-queries.test.tsx`

Expected: 普通与临时 Task 的读取和手动重试契约通过，错误保持统一 Mutation 结构。

### Task 4: 完成 MCP Inspector 状态体验

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-inspector-sections.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `tests/e2e/app-shell-runtime.spec.ts`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: `AgentMcpServerPage` Query、重试 Mutation、`CodeAgentMutationError`。
- Produces: 稳定 Loading、逐服务 Success/Starting/Failed/Cancelled、可展开错误日志和手动 Retry UI。

**Behavior:**

- 用语义图标和文本同时呈现状态；成功行展示工具数量、认证方式与可用版本；失败行展示失败原因和可展开原始诊断；整体读取失败保留详细请求错误；重试按钮提供进行中状态并在 `starting` 期间轮询。

**Stop Conditions:**

- 若 Inspector 当前宽度无法容纳状态元数据，则优先折行和 Collapsible，不扩大全局布局。

- [x] **Task Status:** completed

Run: `pnpm build && pnpm exec playwright test tests/e2e/app-shell-runtime.spec.ts --grep "MCP"`

Expected: 组件测试覆盖所有状态和重试，相关浏览器测试通过且无重叠或纯颜色状态表达。
