# Feature Implementation Plan

**Goal:** 上下文 Inspector 只展示当前 Task 能读取到的 MCP 服务，而不是当前 Project 配置中启用的 MCP 服务。

**Suggested Spec Reads:**

- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex Task 生命周期、归属校验与 MCP Provider 边界。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector MCP 栏目的状态与原始名称展示。
- `.superwork/spec/frontend/state-management.md` — 约束 Task 级查询键和切换隔离。
- `.superwork/spec/shared/quality-guidelines.md` — 约束公开协议和调用方验证。

**Architecture:** 将 Core 能力改为接收 `taskId`，Codex Provider 分页调用 `mcpServerStatus/list { threadId, detail: "toolsAndAuthOnly" }` 并仅映射名称；Server 和 Client 改用 Task 级资源路径；Web 仅在存在当前 Task 时发起 Task 级查询。

**Tech Stack:** TypeScript、Fastify、React、TanStack Query、Vitest、Playwright。

## Global Constraints

- 删除旧 `config/read mcp_servers` 展示逻辑，不保留 Project 级兼容端点。
- Provider 边界只暴露 MCP 名称，不暴露工具、资源、认证状态或配置 Secret。
- 所有 Task 查询必须校验 Project 归属，并覆盖分页与重复 Cursor 防护。

### Task 1: 实现 Task 级 Provider MCP 清单

**Files:**

- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/test/fixtures/fake-app-server.mjs`

**Interfaces:**

- Consumes: `CodexListMcpServerStatusRequest`。
- Produces: `TaskMcpServerPage`。

**Behavior:**

- 分页读取指定 Task 的 MCP 状态、校验响应、去重排序名称，并拒绝重复 Cursor。

**Stop Conditions:**

- 如果当前 Codex 绑定不支持 `threadId` 或响应结构与生成协议不一致，则停止并报告协议阻塞。

- [x] **Task Status:** completed

Run: `pnpm --filter @code-agent/provider-codex test -- agent-provider.test.ts`

Expected: Task 级 MCP Provider 测试通过。

### Task 2: 迁移 Server 与 Client 到 Task 级 MCP 端点

**Files:**

- Modify: `packages/server/src/routes/project-routes.ts`
- Modify: `packages/server/src/routes/task-routes.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `TaskMcpServerPage`。
- Produces: `TaskMcpServersHttpResource`。

**Behavior:**

- 删除 Project 级端点，新增 Task 级端点并将 `taskId` 传入 Provider；Client 使用相同资源路径。

**Stop Conditions:**

- 如果 Task 路由无法在现有 Project Context 中执行归属校验，则停止并调整 Provider 边界后再继续。

- [x] **Task Status:** completed

Run: `pnpm --filter @code-agent/server test -- app.test.ts && pnpm --filter @code-agent/client test -- http-client.test.ts`

Expected: Server 与 Client 的 Task 级资源测试通过，旧 Project 级路径不再被调用。

### Task 3: 将 Inspector MCP 查询绑定到当前 Task

**Files:**

- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `tests/e2e/app-shell-settings-navigation.spec.ts`

**Interfaces:**

- Consumes: `TaskMcpServersHttpResource`。
- Produces: `TaskScopedMcpInspectorState`。

**Behavior:**

- 仅在存在 `taskId` 时查询，查询键包含 Task ID；无 Task 时展示当前 Task 无可读 MCP 的空态。

**Stop Conditions:**

- 如果当前 Inspector 无法区分 Project 空状态与 Task 状态，则停止并先补充显式查询启用条件。

- [x] **Task Status:** completed

Run: `pnpm --filter @code-agent/web test -- project-queries.test.tsx workbench-inspector.test.tsx`

Expected: Task 切换使用独立 MCP 查询缓存，Inspector 状态测试通过。

### Task 4: 更新稳定规范并完成全量验证

**Files:**

- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `docs/architecture-design.md`

**Interfaces:**

- Consumes: `TaskScopedMcpInspectorState`。
- Produces: `TaskReadableMcpDocumentation`。

**Behavior:**

- 将 Project 配置展示约束更新为当前 Task 可读 MCP 约束，并运行项目门禁。

**Stop Conditions:**

- 如果 `pnpm check` 或相关 E2E 出现与本次改动相关的失败，则停止交付并修复。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm exec playwright test tests/e2e/app-shell-settings-navigation.spec.ts -g "renders task-readable MCP servers"`

Expected: 类型、Lint、单元测试、构建和 Task 可读 MCP 浏览器流程全部通过。
