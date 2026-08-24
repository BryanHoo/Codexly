# Project Task Navigation Implementation Plan

**Goal:** 将产品公开语义从 Workspace/Thread 收敛为 Project/Task，并把项目选择、固定任务和项目任务树整合进唯一工作台左栏。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 统一工程门禁与跨层修改要求。
- `.superwork/spec/guides/cross-layer-thinking-guide.md` — 约束 Web、Protocol、Core 与 Server 的契约同步。
- `.superwork/spec/frontend/component-guidelines.md` — 约束高密度侧栏、可访问性和响应式工作台。
- `.superwork/spec/frontend/state-management.md` — 约束项目选择与搜索状态留在最近功能边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 要求用 Playwright 验证关键导航和文件夹选择行为。
- `.superwork/spec/shared/quality-guidelines.md` — 要求公开 Project/Task 契约具备 Schema 和消费者一致性。
- `.superwork/spec/backend/quality-guidelines.md` — 要求 Project 路径始终由 Server 执行真实路径和权限校验。
- `docs/architecture-design.md` — 更新公开领域模型、API、持久化和安全边界。
- `docs/web-design.md` — 更新单工作台路由、左栏信息架构和状态归属。

**Architecture:** Web 只保留工作台主流程，使用 `/p/$projectId` 与 `/p/$projectId/t/$taskId` 表达当前项目和任务；Project Navigator 在应用级上下文中维护当前演示项目集合，文件夹选择通过浏览器目录选择器取得文件夹名并立即加入左栏，真实路径注册仍交给未来 Runtime。Protocol/Core 公开模型统一使用 Project/Task，Provider 适配层保留 Codex 原生 Thread 术语并通过映射隔离。

**Tech Stack:** TypeScript 6、React 19、TanStack Router、Tailwind CSS 4、Lucide React、Vitest、Playwright、pnpm Workspace。

## Global Constraints

- 删除独立 `/workspaces`、`/w/$workspaceId` 与 `/w/$workspaceId/t/$threadId` 产品路由，不保留旧实现兼容分支。
- 左栏从上到下固定为 `New agent`、`Search`、可选 `Pinned`、`Projects`；`Pinned` 没有任务时完全不渲染。
- Project 名称来自用户选择的文件夹名；浏览器不得自行声称已完成 Server 路径授权或持久化。
- 产品公开类型、路由、API 和文案使用 Project/Task；pnpm Workspace 与 Codex Provider 原生 Thread 术语保持原名。
- UI 延续现有纯色材质、低对比分隔和紧凑桌面工作台，不引入卡片堆叠或额外页面。
- 关键逻辑添加简短清晰的中文注释，代码标识符、命令和路径保持原文。
- 每个代码行为切片通过 `superwork-tdd` 执行，长时间命令设置明确超时。

### Task 1: 建立 Project/Task 公开契约与路由测试

- [x] **Task Status:** completed

**Files:**

- Create: `packages/protocol/src/project.ts`, `packages/protocol/src/project.test.ts`, `packages/core/src/project.ts`.
- Modify: `packages/protocol/src/index.ts`, `packages/core/src/index.ts`, `tests/e2e/app-shell.spec.ts`.

**Interfaces:**

- Consumes: `packagePublicEntrypoints`
- Produces: `projectProtocolContract`
- Produces: `projectRepositoryPorts`
- Produces: `projectRouteContract`

**Behavior Slice:**

- 公共契约只暴露 Project/Task；E2E 先断言根路径进入唯一工作台、新路由可访问、旧 Workspace 路由不再注册。

**Proof Intent:**

- 先添加失败的协议单元测试和导航 E2E 断言，再实现最小 Schema、类型与路由树契约。

**Verification:**

- Run: `pnpm test -- packages/protocol/src/project.test.ts` and `pnpm test:e2e --grep "project|route"`.
- Expected: Project/Task Schema 断言通过；新路由进入工作台，旧路由进入 404。

**Stop Conditions:**

- 公共 Project/Task 字段无法在不泄漏本地绝对路径的情况下定义。
- 现有 Provider 已有必须直接暴露给 Web 的 Thread 契约。
- 新路由无法保持 TanStack Router 的类型安全。

### Task 2: 重构唯一工作台与 Project Navigator 左栏

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/features/projects/project-context.tsx`, `apps/web/src/features/projects/project-data.ts`, `apps/web/src/features/projects/project-data.test.ts`, `apps/web/src/features/workbench/components/project-sidebar.tsx`, `apps/web/src/features/workbench/components/task-timeline.tsx`, `apps/web/src/app/routes/project-route.tsx`, `apps/web/src/app/routes/task-route.tsx`.
- Modify: `apps/web/src/app/providers.tsx`, `apps/web/src/app/router.tsx`, `apps/web/src/app/routes/index-route.tsx`, `apps/web/src/app/routes/root-route.tsx`, `apps/web/src/app/routes/settings-route.tsx`, `apps/web/src/app/routes/not-found.tsx`, `apps/web/src/features/workbench/components/workbench-shell.tsx`, `apps/web/src/features/workbench/components/workbench-composer.tsx`, `apps/web/src/features/workbench/components/workbench-inspector.tsx`, `apps/web/src/shared/styles/globals.css`, `tests/e2e/app-shell.spec.ts`.
- Delete: `apps/web/src/app/routes/workspaces-route.tsx`, `apps/web/src/app/routes/workspace-route.tsx`, `apps/web/src/app/routes/thread-route.tsx`, `apps/web/src/features/workbench/components/thread-sidebar.tsx`, `apps/web/src/features/workbench/components/thread-timeline.tsx`.

**Interfaces:**

- Consumes: `projectProtocolContract`
- Consumes: `projectRouteContract`
- Produces: `projectNavigationState`
- Produces: `directoryPickerAdapter`
- Produces: `projectSidebarBehavior`

**Behavior Slice:**

- 用户在唯一工作台左栏创建新 Agent、搜索任务、打开固定任务、展开项目任务，并通过目录选择器添加文件夹名项目后立即切换到该项目；空固定列表不占据布局。

**Proof Intent:**

- 先用 Playwright 模拟目录选择器并断言项目新增、路由切换、搜索过滤、Pinned 条件渲染与移动抽屉，再实现上下文和组件。

**Verification:**

- Run: `pnpm test:e2e --grep "sidebar|project|folder|search|pinned|narrow"`.
- Expected: 所有左栏关键流程、键盘可访问名称、窄窗口覆盖模式和无横向溢出断言通过。

**Stop Conditions:**

- 浏览器目录选择器无法在当前 Chromium 测试环境中安全模拟。
- 项目状态需要提前实现 Server 持久化才能满足本切片的可观察行为。
- 左栏内容在 320px 宽度发生文字、按钮或面板重叠。

### Task 3: 统一架构文档、工程规范与最终质量证据

- [x] **Task Status:** completed

**Files:**

- Modify: `docs/architecture-design.md`, `docs/web-design.md`, `SECURITY.md`, `.superwork/spec/backend/directory-structure.md`, `.superwork/spec/backend/quality-guidelines.md`, `.superwork/spec/frontend/component-guidelines.md`, `.superwork/spec/frontend/state-management.md`, `.superwork/spec/frontend/type-safety.md`, `.superwork/spec/shared/quality-guidelines.md`.
- Modify: Task 1-2 files only as required by formatting, lint, type, build or browser findings.
- Modify: `.superwork/plans/2026-07-22-project-task-navigation.md` task status markers.

**Interfaces:**

- Consumes: `projectProtocolContract`
- Consumes: `projectRepositoryPorts`
- Consumes: `projectRouteContract`
- Produces: documented `GET /v1/projects`, Project-scoped Task API, Project path security boundary and Provider Thread mapping.
- Produces: `verificationEvidence: pnpm check, pnpm test:e2e, browser screenshots and console inspection`.

**Behavior Slice:**

- 工程规范与架构文档不再把 Workspace/Thread 作为产品公开概念，同时保留 pnpm Workspace 和 Codex 原生 Thread 的准确边界；最终页面在桌面和移动视口均稳定可用。

**Proof Intent:**

- 用语义搜索检查遗留公开术语，运行统一门禁和完整 E2E，并通过本地浏览器检查像素、溢出、重叠、目录选择模拟和控制台错误。

**Verification:**

- Run: `pnpm check` and `pnpm test:e2e`.
- Expected: 两条命令退出码均为 `0`；桌面与移动工作台无重叠、无横向溢出、无控制台错误，左栏顺序与交互符合计划。

**Stop Conditions:**

- 统一门禁暴露与本计划无关的既有失败。
- 文档语义迁移会错误改写 pnpm Workspace 或 Codex Provider Thread 原生术语。
- 浏览器视觉验证需要当前环境无法提供的能力。
