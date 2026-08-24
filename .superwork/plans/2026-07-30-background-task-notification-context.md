# Feature Implementation Plan

**Goal:** 系统通知展示 Task 名称，并且只在 CodeAgent 页面隐藏或浏览器窗口失焦时发送。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 定义系统通知的用户可观察行为
- `.superwork/spec/frontend/hook-guidelines.md` — 约束 Browser Notification 副作用边界
- `.superwork/spec/frontend/state-management.md` — 约束 Project Runtime 与 Task 元数据来源
- `docs/web-design.md` — 说明 Project Runtime 事件扇出与 Task 标题更新路径

**Architecture:** 通知适配器通过可注入的页面前台判定过滤通知，并使用 Runtime 提供的 Task 名称构造标题；`ProjectRuntimeManager` 从 Snapshot 与 Project Task Query 维护有界生命周期内的 Task 名称映射。

**Tech Stack:** TypeScript、React 19、Browser Notification API、Vitest、pnpm

## Global Constraints

- 页面前台定义为 `document.visibilityState === "visible"` 且 `document.hasFocus()`；任一条件不满足才允许发送系统通知。
- 通知必须展示 Task 名称，不向用户显示原生 Task ID。
- Task 名称复用现有 Protocol Snapshot 与 Project Task Query，不新增协议或持久化字段。
- 保持通知权限、错误去重、点击回到 Task 和静默降级行为不变。
- 不启动开发服务器。

### Task 1: 按页面前台状态过滤并展示 Task 名称

**Files:**

- Modify: `apps/web/src/features/notifications/browser-task-notifier.ts`
- Test: `apps/web/src/features/notifications/browser-task-notifier.test.ts`

**Interfaces:**

- Consumes: `TaskNotifier.notify`、Browser Page Visibility/Focus、Task title
- Produces: 带 Task 名称且仅后台发送的系统通知

**Behavior:**

- 页面可见且聚焦时不调用 Browser Notification；页面隐藏或失焦时以 `CodeAgent · <Task title>` 为通知标题，并保留现有状态正文、权限、去重和点击导航行为。

**Stop Conditions:**

- 若浏览器前台状态无法通过同步 Page Visibility 与 Focus API 稳定判断，则停止并回到设计确认。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/notifications/browser-task-notifier.test.ts`

Expected: 前台抑制、后台通知、Task 名称和既有通知行为测试全部通过。

### Task 2: 向通知链路提供最新 Task 名称

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/project-runtime.ts`
- Test: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`
- Modify: `apps/web/src/features/projects/project-context.tsx`

**Interfaces:**

- Consumes: `AgentTaskSnapshot.title`、Project Task Query 中的 `AgentTask.title`
- Produces: `ProjectRuntimeManager.rememberTaskTitles`、扩展后的 `TaskNotifier.notify`

**Behavior:**

- Runtime 从 Snapshot 记录 Task 名称，Project 查询和乐观标题更新可覆盖旧名称；事件通知读取当前名称，归档 Task 时同步清理名称。

**Stop Conditions:**

- 若 Task 名称只能通过新增 Server 请求或协议字段获得，则停止并回到需求确认。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/project-runtime.test.ts apps/web/src/features/notifications/browser-task-notifier.test.ts`

Expected: Runtime 将 Snapshot 或查询中的最新 Task 名称传给通知端口，归档清理和现有事件分发测试通过。

### Task 3: 更新通知规范并完成验证

**Files:**

- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/hook-guidelines.md`

**Interfaces:**

- Consumes: 最终后台通知行为与项目验证命令
- Produces: 页面前台过滤和 Task 名称展示的稳定规范

**Behavior:**

- 固化页面前台判定、Task 名称来源与通知展示要求，并验证完整项目和浏览器流程。

**Stop Conditions:**

- `pnpm check` 或 `pnpm test:e2e` 出现无法在本次范围内安全解决的失败时停止并报告证据。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 基础门禁与全部 Playwright 浏览器流程通过。
