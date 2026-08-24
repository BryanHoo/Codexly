# Feature Implementation Plan

**Goal:** 在 Task 完成、不可恢复中断或错误、等待审批或用户输入时发送浏览器系统通知，并在用户启动任务时安全申请通知权限。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/hook-guidelines.md` — 约束浏览器副作用、订阅与清理边界
- `.superwork/spec/frontend/state-management.md` — 约束实时事件与 Task 状态归一化
- `.superwork/spec/frontend/quality-guidelines.md` — 规定 Vitest 与页面行为验证范围
- `docs/web-design.md` — 说明 Project Runtime 与实时事件数据路径

**Architecture:** 新增独立浏览器通知适配器，将统一 `AgentEvent` 映射为通知内容并处理权限、去重与点击回到 Task；`ProjectRuntimeManager` 在共享 Project 事件入口调用该适配器，并向 Composer 暴露用户手势内的权限申请动作。

**Tech Stack:** TypeScript、React 19、Browser Notification API、Vitest、pnpm

## Global Constraints

- 保持 Web 只依赖 `@code-agent/client` 与 `@code-agent/protocol`。
- 只对 `turn.completed` 终态、不可重试 `provider.error` 和待处理 `pending_request.created` 发送通知。
- 避免不可重试错误与随后失败 Turn 终态产生重复通知。
- 浏览器不支持通知、权限拒绝或通知构造失败时静默降级，不影响实时事件链路。
- 不启动开发服务器。

### Task 1: 实现浏览器 Task 通知适配器

**Files:**

- Create: `apps/web/src/features/notifications/browser-task-notifier.ts`
- Test: `apps/web/src/features/notifications/browser-task-notifier.test.ts`

**Interfaces:**

- Consumes: `AgentEvent`、Browser `Notification` API
- Produces: `TaskNotifier`、`createBrowserTaskNotifier`

**Behavior:**

- 将完成、中断、失败、不可重试 Provider 错误、审批和用户输入事件映射为中文系统通知；按 Turn 或 Request 去重，并支持点击通知聚焦页面及进入对应 Task。

**Stop Conditions:**

- 浏览器通知 API 无法通过可注入边界进行无 DOM 单测时停止并调整适配器接口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/notifications/browser-task-notifier.test.ts`

Expected: 通知映射、权限降级、重复失败抑制和点击导航测试全部通过。

### Task 2: 接入 Project Runtime 与权限申请动作

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/project-runtime.ts`
- Test: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`
- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`

**Interfaces:**

- Consumes: `TaskNotifier`、`ProjectRuntimeManager` Project 事件订阅、Composer Task 启动用户手势
- Produces: `ProjectRuntimeManager.requestNotificationPermission`、`WorkbenchComposer.onRequestNotificationPermission`

**Behavior:**

- 每个实时关键事件只经过共享 Project 连接触发一次通知；正常 Prompt、Review 与 Compact 启动前在用户手势内请求权限，且权限请求失败不阻断 Task 操作。

**Stop Conditions:**

- 若权限申请必须引入新的持久化设置或协议字段才能可靠执行，则停止并回到需求确认。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/project-runtime.test.ts apps/web/src/features/workbench/components/workbench-composer.test.tsx`

Expected: Project 事件只调用一次通知适配器，权限申请动作不改变现有提交行为，相关回归测试通过。

### Task 3: 固化规范并完成全量验证

**Files:**

- Modify: `.superwork/spec/frontend/hook-guidelines.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: 已实现的浏览器通知行为与项目验证命令
- Produces: 稳定前端通知约束、完整验证证据

**Behavior:**

- 记录通知权限、关键事件、去重和静默降级约束，并通过项目基础门禁与浏览器流程测试证明功能未破坏现有页面行为。

**Stop Conditions:**

- `pnpm check` 或 `pnpm test:e2e` 出现与本次改动无关且无法安全修复的既有失败时停止并报告证据。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 基础门禁与完整 Playwright 浏览器流程全部通过。
