# Feature Implementation Plan

**Goal:** 精简 Inspector 上下文中的 MCP、来源与未提交变更交互，并为长列表提供按需展开能力。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束项目命令、文件长度和验证门禁。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector 标签、共享 Tooltip、Button 和上下文模块视觉。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束前端行为测试与可访问性交互。

**Architecture:** 在 Workbench Inspector 功能目录新增轻量增量列表组件，由 MCP 与来源两个真实消费者复用；各行继续使用项目共享 Tooltip、Button 和现有控制面背景 Token，未提交变更通过既有 `onTabChange` 合约切换标签。

**Tech Stack:** TypeScript、React 19、Tailwind CSS 4、Radix Tooltip、Vitest。

## Global Constraints

- 保持生产代码单文件不超过 500 行，新增关键状态逻辑使用简短中文注释。
- 保留 MCP、Skill、附件和文件名称原文，不翻译运行时数据。
- 复用 `shared/components/core` 的 Button 与 Tooltip，不新增颜色、字体或自定义 Tooltip。
- 不启动开发服务器，完成后运行针对性测试和 `pnpm check`。

### Task 1: 实现上下文增量列表并接入 MCP

**Files:**

- Create: `apps/web/src/features/workbench/components/workbench-inspector-incremental-list.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-sections.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Test: `apps/web/src/features/workbench/components/workbench-inspector-sources.test.tsx`
- Test: `tests/e2e/app-shell-runtime-requests.spec.ts`

**Interfaces:**

- Consumes: `AgentMcpServer[]`、共享 `Button` 与 `Tooltip`。
- Produces: 初始最多展示 5 条、可展开剩余项、空数据隐藏模块且 Tooltip 显示 MCP 原始名称的 MCP 列表。

**Behavior:**

- 验证 MCP 初始只渲染前 5 条，剩余数据由低存在感“显示更多”按钮展开；无 MCP 数据时不渲染整个模块；每行具备终端一致的背景过渡，Tooltip 展示原始工具名。

**Stop Conditions:**

- MCP 协议未提供可用于 Tooltip 的稳定原始名称时停止。
- 共享 Button 或 Tooltip 无法满足现有可访问性合约时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-inspector-sources.test.tsx && pnpm exec playwright test tests/e2e/app-shell-runtime-requests.spec.ts`

Expected: MCP 可见数量、空模块、显示更多按钮、Tooltip 与 Hover 类断言通过。

### Task 2: 精简并分页展示上下文来源

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-inspector-sources.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-inspector-sources.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-inspector-tabs.test.tsx`
- Test: `tests/e2e/app-shell-settings-workbench.spec.ts`

**Interfaces:**

- Consumes: `AgentTurn[]`、`AgentSkill[]`、Task 附件打开行为与增量列表组件。
- Produces: 不含 Project 目录、空数据隐藏、初始最多 5 条且 Skill Tooltip 展示描述的来源列表。

**Behavior:**

- 仅收集历史消息中去重的 Skill 和附件；所有来源行复用终端一致的背景过渡，Skill 行通过 Tooltip 展示协议描述，超过 5 条时按需展开。

**Stop Conditions:**

- Skill 描述无法从当前 `AgentSkill` 数据稳定关联到历史引用时停止。
- 移除 Project 来源会破坏附件 URL 或 Task 归属时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-inspector-sources.test.tsx apps/web/src/features/workbench/components/workbench-inspector-tabs.test.tsx && pnpm exec playwright test tests/e2e/app-shell-settings-workbench.spec.ts`

Expected: Project 目录不再出现，空来源模块隐藏，Skill 描述 Tooltip、Hover 类和来源分页断言通过。

### Task 3: 让未提交变更摘要直接打开变更标签

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-inspector-git-changes.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-inspector-git-changes.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-inspector-tabs.test.tsx`
- Test: `tests/e2e/app-shell-settings-workbench.spec.ts`

**Interfaces:**

- Consumes: `WorkbenchInspectorTab` 与既有 `onTabChange` 回调。
- Produces: 带背景过渡且点击调用 `onTabChange("changes")` 的未提交变更摘要行。

**Behavior:**

- 将汇总统计行变为共享 Ghost Button，保持现有统计信息和独立提交入口，点击汇总只切换到“变更”标签。

**Stop Conditions:**

- 汇总按钮与提交按钮形成嵌套交互元素时停止。
- 当前 Project 不具备有效“变更”标签时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-inspector-git-changes.test.tsx apps/web/src/features/workbench/components/workbench-inspector-tabs.test.tsx && pnpm exec playwright test tests/e2e/app-shell-settings-workbench.spec.ts`

Expected: 未提交变更摘要包含 Hover 过渡、可点击语义，并通过既有标签可用性回归。
