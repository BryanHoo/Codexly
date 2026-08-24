# Feature Implementation Plan

**Goal:** 将单页工作台收敛为统一路由加载边界，合并小型常用 UI，并用真实工作台就绪预算约束生产构建。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束项目命令、验证与规范同步要求
- `.superwork/spec/frontend/directory-structure.md` — 约束路由和工作台代码归属
- `.superwork/spec/frontend/component-guidelines.md` — 约束工作台 Dialog、Inspector、Diff 与 Git 交互
- `.superwork/spec/frontend/quality-guidelines.md` — 约束动态加载、构建预算与验证范围

**Architecture:** 保留认证外壳和一个共享 `WorkbenchShell` 动态入口；Project、Task 与临时路由静态声明并复用该入口。Inspector、设置、源码预览、Git 及轻量 Diff 外壳并入工作台闭包，Markdown、Patch Diff Viewer、Shiki Engine 与语言 Grammar 继续按内容动态加载。构建门禁同时统计 Vite 初始入口和工作台静态闭包。

**Tech Stack:** TypeScript、React 19、TanStack Router、Vite 8、Vitest、pnpm

## Global Constraints

- 保持 `PairingGate` 位于 Router 业务内容之外，未认证状态不得加载工作台实现。
- 保持 Markdown、Patch Diff Viewer、Shiki Engine、主题和语言 Grammar 的现有动态入口。
- 不提高现有 `240 KiB gzip` 首屏预算和 `200 KiB gzip` 单异步入口预算。
- 删除旧路由懒加载文件和冗余加载函数，不保留兼容导出。
- 所有 Python 命令使用 `python3`，所有项目命令使用 pnpm。

### Task 1: 收敛工作台加载边界

**Files:**

- Create: `apps/web/src/app/routes/workbench-route.tsx`
- Create: `apps/web/src/app/routes/workbench-route.test.tsx`
- Modify: `apps/web/src/app/router.test.ts`
- Modify: `apps/web/src/app/routes/project-route.tsx`
- Modify: `apps/web/src/app/routes/task-route.tsx`
- Modify: `apps/web/src/app/routes/temporary-route.tsx`
- Modify: `apps/web/src/app/routes/temporary-task-route.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-dialogs.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-launcher.tsx`
- Delete: `apps/web/src/app/routes/project-route.lazy.tsx`
- Delete: `apps/web/src/app/routes/task-route.lazy.tsx`
- Delete: `apps/web/src/app/routes/temporary-route.lazy.tsx`
- Delete: `apps/web/src/app/routes/temporary-task-route.lazy.tsx`
- Delete: `apps/web/src/features/workbench/components/workbench-shell-lazy.test.ts`

**Interfaces:**

- Consumes: `WorkbenchShellProps`
- Consumes: `projectRoute.useParams()`、`taskRoute.useParams()`、`temporaryTaskRoute.useParams()`
- Produces: `loadWorkbenchShell(): Promise<{ WorkbenchShell: typeof WorkbenchShell }>`
- Produces: `WorkbenchRoute` 共享路由级 Suspense 组件

**Behavior:**

- 四类工作台路由静态声明页面参数映射，只通过同一个 `loadWorkbenchShell()` 动态入口加载工作台。
- 工作台闭包静态包含 Inspector、设置、源码预览、Git 历史、提交控制器和轻量 Diff Dialog；打开这些界面不再经过空白 Suspense。
- `MessageResponse`、`PatchDiffViewer`、代码高亮器和语言 Grammar 继续保持动态加载。

**Stop Conditions:**

- 如果静态合并使任一重型 Markdown、Patch Diff Viewer 或 Shiki 实现进入工作台静态闭包，停止并恢复对应重型边界。
- 如果统一入口导致未认证 `PairingGate` 挂载工作台实现，停止并调整入口位置。

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/app/routes/workbench-route.test.tsx`

Expected: 共享工作台加载入口测试通过，旧路由懒加载模块不再参与装配。

### Task 2: 增加工作台就绪构建预算

**Files:**

- Modify: `tools/verify-web-bundle.mjs`
- Modify: `tests/web-bundle-budget.test.ts`

**Interfaces:**

- Consumes: `loadWorkbenchShell(): Promise<{ WorkbenchShell: typeof WorkbenchShell }>`
- Consumes: Vite `.vite/manifest.json`
- Produces: Bundle report schema version 2 with `workbenchReady`
- Produces: `workbenchReadyGzipBytes` 与 `workbenchReadyRequestCount` budgets

**Behavior:**

- 报告以 `src/features/workbench/components/workbench-shell.tsx` 为统一工作台入口，统计初始静态图与工作台静态图的去重并集。
- 门禁保留现有初始和异步 Gzip 预算，并新增工作台就绪 Gzip 与 JavaScript 请求数预算。
- 机器报告、控制台摘要、只读报告校验和超限错误均覆盖新增指标。

**Stop Conditions:**

- 如果 manifest 无法稳定识别统一工作台入口，停止并改用显式、可静态分析的入口契约。
- 如果新预算无法拒绝 Gzip 或请求数单独超限的测试夹具，停止并修正图统计。

- [x] **Task Status:** completed

Run: `pnpm vitest run tests/web-bundle-budget.test.ts`

Expected: 报告 Schema、工作台图统计以及 Gzip/请求数超限用例全部通过。

### Task 3: 更新稳定规范并完成全量验证

**Files:**

- Modify: `.superwork/spec/frontend/directory-structure.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/quality-guidelines.md`
- Modify: `.superwork/plans/2026-08-08-workbench-loading.md`

**Interfaces:**

- Consumes: Bundle report schema version 2 with `workbenchReady`
- Produces: 前端三级加载与工作台预算稳定规范
- Produces: 完成状态实施计划

**Behavior:**

- 规范明确单一工作台路由边界、小型常用 UI 静态归组和重型内容动态加载边界。
- `pnpm check`、`pnpm test:e2e` 与生产 Bundle 报告验证代码、行为、架构和预算一致。

**Stop Conditions:**

- 如果完整门禁或关键用户流程失败，停止完成声明并修复本次变更引入的问题。
- 如果生产 manifest 显示 Markdown、Patch Diff Viewer 或 Shiki Engine 静态进入工作台闭包，停止并修正拆包边界。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全量门禁和浏览器流程通过，Bundle 报告同时满足首屏、工作台就绪和异步入口预算。
