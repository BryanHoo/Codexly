# Feature Implementation Plan

**Goal:** 将任务 fork 统一呈现为“复制”，并在最新一条已完成的 AI 回复操作栏提供复制任务入口。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 React 组件职责、交互状态与复用边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束可访问性、组件测试与浏览器流程验证。
- `.superwork/spec/frontend/state-management.md` — 约束 mutation 后的任务缓存与导航更新。
- `docs/web-design.md` — 约束任务时间线、Composer 和 Client API 的职责边界。
- `docs/architecture-design.md` — 确认 Codex `thread/fork` 通过现有 Provider/Server/Client 链路调用。

**Architecture:** 保留现有 `client.forkTask` 到 Codex `thread/fork` 的稳定链路，在 Workbench Shell 中为消息入口封装同一 mutation 与导航回调；时间线只向最新 Turn 中最后一组已完成 AI 回复传入该动作，历史回复和运行中回复不展示。Composer 命令仅更新面向用户的名称和搜索词。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Playwright、pnpm、Codex App Server `thread/fork`。

## Global Constraints

- Web 只能通过 `@code-agent/client` 调用 fork，不得直接依赖 Server 或 Provider。
- 复用现有 `forkTask(projectId, taskId, { idempotencyKey })`，不得新增兼容协议或重复后端实现。
- 消息复制任务按钮只出现在最新一条已完成且包含 AI 文本的回复旁，并与复制消息按钮并列。
- 所有图标按钮必须具备明确的中文可访问名称和 tooltip。

### Task 1: 更新任务复制命令文案

**Files:**

- Modify: `apps/web/src/features/workbench/components/prompt-command.ts`
- Test: `apps/web/src/features/workbench/components/prompt-command.test.ts`
- Test: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `PromptCommandItem`
- Produces: 面向用户的“复制”命令与可搜索关键词

**Behavior:**

- 将 fork 命令标签从“在新任务中继续”改为“复制”，保留 fork 语义并更新相关测试选择器。

**Stop Conditions:**

- 如果“复制”与现有命令产生不可消除的名称冲突，则停止并报告冲突。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/prompt-command.test.ts`

Expected: 命令列表测试通过且 fork 命令标签为“复制”。

### Task 2: 在最新 AI 回复旁提供复制任务动作

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Test: `apps/web/src/features/workbench/components/task-timeline.test.tsx`

**Interfaces:**

- Consumes: `CodeAgentWorkbenchClient.forkTask`、`TaskTimeline` 最新 Turn 状态、`onTaskStarted`
- Produces: 最新已完成 AI 回复的 `onForkTask(idempotencyKey)` 操作与新任务导航

**Behavior:**

- 在最新 Turn 的最后一组已完成 AI 文本回复操作栏中，将 GitFork 图标按钮放在复制消息按钮旁；点击后使用稳定幂等键调用现有 fork mutation，并通过 `onTaskStarted` 更新缓存和导航。历史回复、无 AI 文本回复、运行中回复、能力不可用或未连接状态不展示该动作。

**Stop Conditions:**

- 如果时间线无法可靠识别最新完成的 AI 回复，或现有 Client fork 契约无法返回新任务，则停止并报告接口缺口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx`

Expected: 时间线测试证明仅最新已完成 AI 回复同时展示复制消息和复制任务按钮。

### Task 3: 验证浏览器复制任务流程

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: 最新 AI 回复的“复制任务”按钮、`POST /v1/projects/:projectId/tasks/:taskId/fork`
- Produces: 从消息操作栏复制并导航到新任务的浏览器回归证据

**Behavior:**

- 覆盖按钮可见性、fork 请求路径和成功后跳转到新任务 URL；同时更新 Slash 命令断言为“复制”。

**Stop Conditions:**

- 如果 Playwright fixture 不包含已完成 AI 回复或 fork 响应，则先补齐同一测试 fixture；不得绕过真实点击链路。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "复制任务"`

Expected: 浏览器测试通过，并观察到 fork mutation 与新任务导航。
