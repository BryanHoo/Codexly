# Feature Implementation Plan

**Goal:** 新聊天在正式 Task 创建前只占用中栏项目草稿状态，左栏只展示 Codex 已返回真实 `taskId` 的 Task。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/state-management.md` — 约束路由、服务端缓存与本地草稿状态边界
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Sidebar 与 Composer 的组件职责
- `.superwork/spec/frontend/quality-guidelines.md` — 约束关键项目切换和首条消息流程的浏览器验证
- `docs/web-design.md` — 定义 Project、Task 路由和项目级新聊天草稿行为

**Architecture:** 保留 `/p/:projectId` 作为未创建 Task 的项目级草稿路由；Sidebar 不再渲染临时 Task，项目名称和两个新建入口统一导航到该路由。Composer 在 `startTask` 返回真实 Task 后立即写入项目缓存并在 Sidebar 选中，同时保留 Project Composer；`startTurn` 成功后再写入首轮乐观运行态并导航到 Task 路由。

**Tech Stack:** TypeScript、React、TanStack Router、TanStack Query、Vitest、Playwright

## Global Constraints

- 新聊天草稿继续使用 `createComposerDraftScope(projectId)` 按 Project 隔离，不创建临时 Task ID。
- 左栏 Task 列表只能展示服务端已返回真实 `taskId` 的 `AgentTask`。
- 不新增旧交互兼容分支，移除临时 `NewTaskLink` 和项目名称展开/收起旧逻辑。

### Task 1: 统一项目与新建入口的草稿导航

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `/p/$projectId` 草稿路由、`createComposerDraftScope(projectId)` 项目草稿契约
- Produces: 不含临时“新聊天” Task 行的 Sidebar 与项目名称切换行为

**Behavior:**

- 顶部新建任务、Project 行 `+`、新增文件夹和点击项目名称都只导航到目标 Project 的空 Task 路由；左栏不插入或选中临时“新聊天”行，切回 Project 时恢复各自草稿。

**Stop Conditions:**

- 如果 `/p/:projectId` 不再表示未创建 Task 的项目草稿状态，则停止并重新确认路由契约。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "project new chats|project name|new-chat text"`

Expected: 新建、切换和草稿恢复用例通过，且左栏始终没有临时“新聊天”链接。

### Task 2: 在真实 taskId 返回后更新并选中 Task

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `CodexlyMutationClient.startTask`、`AgentTask`、`onTaskStarted`
- Produces: `startTask` 成功即写入 Query Cache 并在 Sidebar 选中、`startTurn` 成功后补齐首轮 `TaskLaunchState` 并导航

**Behavior:**

- 新聊天提交首条用户消息后，在 `startTask` 返回真实 `taskId` 时立即更新对应 Project 的 Sidebar 并选中，但保持 Project Composer；等待 `startTurn` 期间不重复创建 Task，成功后进入 Task 路由并展示乐观用户消息和运行态，失败时保留已创建 Task 与项目草稿供重试。

**Stop Conditions:**

- 如果 `startTask` 响应不包含完整 `AgentTask`，或导航会取消既有 `startTurn` 请求，则停止并调整交付契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-composer.test.tsx && pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "newly submitted task"`

Expected: 单元测试确认回调发生在 `startTurn` 前，浏览器用例确认真实 `taskId` 返回后立即出现并选中 Sidebar Task，随后首轮乐观状态正常。
