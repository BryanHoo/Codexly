# Feature Adjustment Plan

**Goal:** 放开临时 Task 的 Agent 能力，并将新建入口和右侧上下文体验统一为临时任务优先。

**Suggested Spec Reads:**

- `.superwork/spec/backend/runtime-lifecycle.md` — 约束临时 Task 的运行设置与隐藏 Project 边界。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Sidebar、Composer 和 Inspector 交互。
- `.superwork/spec/frontend/state-management.md` — 约束临时 Task 设置与查询状态。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Client、Server 和测试同步更新。

**Architecture:** 保留固定内部 temporary Project 和独立 `/v1/temporary/**` API，但移除 `read-only` 设置归一化与前端能力裁剪；临时工作台继续隐藏内部 Project 路径和 Project 工具，只提供完整 Agent 控制及仅上下文的 Inspector。

**Tech Stack:** TypeScript、Fastify、React、TanStack Router/Query、Vitest、Playwright、pnpm。

## Global Constraints

- 内部 temporary Project、真实路径和 Project 工具不得暴露给用户。
- 临时 Task 必须遵循普通 `AgentTaskSettings`，不得覆写审批或 Sandbox。
- 顶部“新建任务”和临时任务分组右侧加号都必须进入 `/temporary`。
- 临时任务 Inspector 只显示上下文内容，不显示 Tab。
- 保留工作区内任何与本功能无关的改动。

### Task 1: 放开临时 Task Server 能力

**Files:**

- Modify: `packages/server/src/temporary-task-routing.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/task-action-routes.ts`
- Modify: `packages/server/src/routes/turn-routes.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `/v1/temporary/**` 路由重写、`AgentTaskSettings`、Task 设置和 Turn 请求。
- Produces: 不改写 Agent 设置且支持 Skills 查询的 temporary API。

**Behavior:**

- 删除临时 Task 的 `sandboxMode = read-only` 强制归一化；设置写入和 Turn 启动完整保留请求值；temporary API 支持 Skills 查询。

**Stop Conditions:**

- 如果开放 Skills 必须暴露内部 Project 元数据，则停止并改为独立 temporary Skills handler。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts`

Expected: 临时 Task 保留审批与 Sandbox 设置，并可通过 temporary API 获取 Skills。

### Task 2: 调整 Sidebar、Composer 与上下文 Inspector

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-task-list.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-sections.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-session.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/components/prompt-command.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Test: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Test: `apps/web/src/features/workbench/components/prompt-command.test.ts`

**Interfaces:**

- Consumes: temporary 路由、Task 设置状态、Skills/MCP/Terminal 查询和 Inspector 数据。
- Produces: 临时任务优先的新建入口、完整 Agent 控制和无 Tab 上下文右栏。

**Behavior:**

- 顶部入口改名“新建任务”并默认进入临时草稿；临时任务分组右侧提供加号入口；临时 Composer 开放 Sandbox、审批、Skills 和完整命令；右栏直接显示上下文内容。

**Stop Conditions:**

- 如果 Agent 控制与 Project 文件/Git 工具无法独立启用，则停止并先拆分两类能力边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-sidebar.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx apps/web/src/features/workbench/prompt-command.test.ts`

Expected: 两个新建入口正确、临时设置可编辑、Inspector 无 Tab 且展示上下文。

### Task 3: 更新验收夹具与工程约束

**Files:**

- Modify: `tests/e2e/app-shell-temporary.spec.ts`
- Modify: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `docs/architecture-design.md`
- Modify: `docs/project-structure.md`
- Modify: `docs/web-design.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 完整临时任务用户流程、E2E Fake Server 和工程文档约束。
- Produces: 浏览器回归证据以及与实现一致的架构、组件和质量规范。

**Behavior:**

- 浏览器验收覆盖新建入口、可编辑 Agent 设置和无 Tab 上下文右栏；文档同步新的能力与隐藏边界。

**Stop Conditions:**

- 如果 E2E 夹具无法持久化临时 Task 设置，则先修复夹具状态模型，不降低断言范围。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-temporary.spec.ts tests/e2e/app-shell-inspector-layout.spec.ts`

Expected: 临时任务完整交互通过且内部 Project 信息仍不可见。

## Verification

- `pnpm check`：通过，包含 778 项单元测试、9 项性能测试、生产构建、Bundle 与发布包校验。
- `pnpm test:e2e`：通过，101 项 Chromium 浏览器测试全部执行。
