# Feature Implementation Plan

**Goal:** 在 Composer 斜杠命令中提供可取消的计划模式，并把所选模式准确传给 Codex `turn/start`。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 项目级验证与工程约束。
- `.superwork/spec/frontend/component-guidelines.md` — Composer、AI Elements、斜杠命令与可访问性约束。
- `.superwork/spec/frontend/state-management.md` — Composer 局部状态与提交边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 前端单元测试和 Playwright 验证要求。
- `.superwork/spec/frontend/type-safety.md` — Protocol 类型与运行时 Schema 同步规则。
- `.superwork/spec/shared/quality-guidelines.md` — 跨包契约的 Schema 与测试要求。
- `docs/web-design.md` — 工作台 Composer 的现有设计与 AI Elements 使用方式。
- `docs/architecture-design.md` — Web、Protocol、Core 与 Codex Provider 的依赖方向。

**Architecture:** 将计划模式建模为仅作用于 Turn 的可选 `AgentTurnOptions.collaborationMode`，由 Composer 斜杠命令切换局部状态并在提交时注入；Codex Provider 映射为 experimental `turn/start.collaborationMode`，Timeline 继续复用已有 AI Elements `Plan` 输出渲染。

**Tech Stack:** TypeScript、React、TypeBox、AI Elements、Tailwind CSS、Vitest、Playwright、Codex app-server protocol 0.146.0。

## Global Constraints

- 保持 `AgentTaskSettings` 持久化契约不包含计划模式，计划模式只属于当前 Composer 的 Turn 提交状态。
- 使用 Codex experimental schema 要求的 `{ mode: "plan", settings: { developer_instructions: null, model, reasoning_effort } }`，不自行编写计划提示词。
- 复用现有 AI Elements `PromptInputCommand*`、`PromptInputTools`、shadcn `Tooltip` 与 lucide 图标。
- 标签在工作区权限选择器之后出现，hover 或键盘聚焦时显示取消图标，点击后仅退出计划模式。
- 不启动新的开发服务器；验证使用现有 `http://127.0.0.1:3210/` 与项目既有测试命令。

### Task 1: 扩展 Turn 协议并映射 Codex 计划模式

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `AgentTaskSettings`, Codex experimental `TurnStartParams.collaborationMode`
- Produces: 可选的 `AgentTurnOptions.collaborationMode: "plan"` 与对应 Codex RPC 参数

**Behavior:**

- 允许 Turn 请求选择计划模式，但不改变 Task/Global 设置持久化 Schema；启用时 Provider 使用当前模型、当前思考量和 Codex 内置计划指令启动 Turn，未启用时省略该字段。

**Stop Conditions:**

- 如果本机 Codex experimental schema 不接受 `collaborationMode` 或字段结构与生成的 0.146.0 schema 不一致则停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: 协议 Schema 接受带/不带计划模式的 Turn options，Provider RPC 断言包含正确的 `collaborationMode`。

### Task 2: 添加计划命令与可取消模式标签

**Files:**

- Modify: `apps/web/src/features/workbench/components/prompt-command.ts`
- Modify: `apps/web/src/features/workbench/components/prompt-command.test.ts`
- Modify: `apps/web/src/features/workbench/components/prompt-skill-editor.tsx`
- Test: `apps/web/src/features/workbench/components/prompt-skill-editor.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Test: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`

**Interfaces:**

- Consumes: `PromptCommandItem`, `PromptInputCommand*`, `PromptInputTools`, `AgentTurnOptions.collaborationMode`
- Produces: `/plan` 命令、Composer 计划模式局部状态、可访问的计划模式标签与取消操作

**Behavior:**

- 在命令列表加入计划模式；选择后只移除当前 Slash 片段并保留其他草稿内容，工作区权限旁显示计划标签；标签 hover/focus 显示 `X`，点击取消；提交与排队消息时按实际启用状态携带计划模式。

**Stop Conditions:**

- 如果启用状态无法按 `projectId + taskId` 路由作用域隔离，或会被设置 Mutation 持久化，则停止并调整状态边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/prompt-command.test.ts apps/web/src/features/workbench/components/prompt-skill-editor.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`

Expected: 命令列表、启用/取消、草稿保留和 Turn options 断言全部通过。

### Task 3: 验证真实交互与计划输出适配

**Files:**

- Modify: `tests/e2e/app-shell-composer.spec.ts`

**Interfaces:**

- Consumes: Composer UI、`POST /v1/projects/:projectId/tasks/:taskId/turns`、已有 AI Elements `Plan` Timeline
- Produces: 计划标签几何与交互回归、Turn 请求体回归、真实运行输出核对结论

**Behavior:**

- Playwright 覆盖 `/plan` 选择、工作区权限后的标签位置、hover/focus 取消图标、取消与提交请求；在现有 `3210` 服务可交互时确认计划输出继续由现有 `Plan` 组件正确展示。

**Stop Conditions:**

- 如果现有 `3210` 页面无浏览器连接或运行产物未包含本次源码，则保留自动化验证结果并明确报告无法完成的手工核对项。

- [x] **Task Status:** completed

Run: `pnpm test:e2e -- tests/e2e/app-shell-composer.spec.ts`

Expected: Composer 计划模式 E2E 通过，且现有 Plan item 渲染无需新增输出适配；若浏览器连接不可用则明确记录该限制。

### Task 4: 完成项目门禁

**Files:**

- Modify: `.superwork/plans/2026-08-05-composer-plan-mode.md`

**Interfaces:**

- Consumes: 前三项实现与测试结果
- Produces: 已完成状态的计划和最终验证证据

**Behavior:**

- 运行完整静态检查和 E2E 门禁，核对工作树仅包含本功能相关改动，并更新计划状态。

**Stop Conditions:**

- 如果失败来自本次变更，停止交付并修复；如果是明确的既有环境问题，记录完整失败命令和影响。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 两个项目门禁均通过，或仅剩已明确记录且不由本次改动引起的环境阻塞。
