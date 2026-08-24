# Feature Implementation Plan

**Goal:** 使用 Headless Tree 和现有 TanStack Virtual 替换右栏项目文件树，在保留全部现有行为的同时限制大型目录的 DOM 挂载规模。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束包管理、文件长度和验证命令。
- `.superwork/spec/frontend/component-guidelines.md` — 约束组件职责、可访问性和渲染边界。
- `.superwork/spec/frontend/state-management.md` — 约束 TanStack Query、瞬时状态和缓存边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束性能、Bundle、Vitest 和 E2E 验证。
- `.superwork/spec/frontend/type-safety.md` — 约束 Protocol 类型和严格 TypeScript 边界。

**Architecture:** 在 Workbench 功能内建立 Headless Tree 数据适配器和专用虚拟树组件；使用现有 `ProjectFileTree` API 与 TanStack Query 缓存，Headless Tree 管理扁平树语义，TanStack Virtual 只挂载可见行。保留通用 `FileTree` 给其他真实消费者，删除右栏旧递归查询与渲染路径。

**Tech Stack:** TypeScript、React 19、Headless Tree、TanStack Query、TanStack Virtual、Vitest、Playwright、pnpm。

## Global Constraints

- 保留现有右栏视觉、文案、菜单、文件打开分流、Project 作用域展开状态、加载/错误/空状态和刷新语义。
- 不启用搜索、重命名、拖拽、创建、删除或多选等右栏当前不存在的能力。
- 生产 TypeScript 文件不得超过 500 行；关键异步和状态边界添加简短中文注释。
- Headless Tree 异步数据加载器不得向库内部传播 rejected Promise，错误必须转换为可重试状态节点。
- 不保留右栏旧实现或功能开关；共享 `FileTree` 仅因其他真实消费者继续保留。

### Task 1: 建立 Headless Tree 数据适配器

**Files:**

- Modify: `pnpm-workspace.yaml`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/features/workbench/components/project-file-tree-model.ts`
- Create: `apps/web/src/features/workbench/components/project-file-tree-model.test.ts`

**Interfaces:**

- Consumes: `ProjectFileTree`、`ProjectFileTreeEntry`、`projectFileTreeQueryOptions`、`QueryClient`
- Produces: 合成根节点、路径节点、状态节点和 `getChildrenWithData` 数据适配器

**Behavior:**

- 使用一次目录请求返回全部直接子项；缓存复用现有 Query Key；加载失败生成可重试错误节点；根 ID 不泄漏宿主绝对路径；路径与状态 ID 无冲突。

**Stop Conditions:**

- Headless Tree 1.7 类型接口与 React 19 或现有 Query Client 无法兼容时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-file-tree-model.test.ts`

Expected: 数据适配器的正常、空目录、错误、缓存和 ID 测试通过。

### Task 2: 实现高性能虚拟文件树

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-inspector-file-tree.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-project-file-tree.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-project-file-tree.test.tsx`

**Interfaces:**

- Consumes: Task 1 数据适配器、`ProjectOpenContextMenu`、`ProjectOpenDropdownMenu`、`ProjectFileTreeRootActions`
- Produces: `WorkbenchProjectFileTree` 受控组件和目录刷新接口

**Behavior:**

- 使用 `asyncDataLoaderFeature`、`hotkeysCoreFeature`、`selectionFeature`、`propMemoizationFeature`、`buildProxiedInstance` 和 `useVirtualizer` 渲染固定行高扁平树；保留箭头、行单击、菜单、引用、加载、错误、空目录和文件打开行为；支持 roving focus 与完整方向键导航。

**Stop Conditions:**

- 虚拟行无法同时满足 Headless Tree ref、Radix 菜单锚点或 WAI-ARIA Tree 语义时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-project-file-tree.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: 文件树行为、状态、菜单、键盘和虚拟挂载测试通过。

### Task 3: 接入 Workbench 并删除旧右栏路径

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `tests/e2e/app-shell-composer.spec.ts`

**Interfaces:**

- Consumes: `WorkbenchProjectFileTree`、现有 Inspector 回调、Project Git 状态与打开能力
- Produces: 不再暴露 `fileTreeDirectories`、`fileTreeDirectoryPaths`、`fileTreeQueries` 的 Workbench 装配

**Behavior:**

- 右栏直接使用新树；Project 切换隔离展开状态，Task 切换保留同 Project 展开路径；根刷新同时刷新 Git 与已展开目录；折叠清除后代；现有文件打开、右键、省略号、复制、宿主打开和 `@` 引用 E2E 全部保持。

**Stop Conditions:**

- 任何现有右栏用户动作无法映射到新组件接口或需要修改后端协议时停止。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-composer.spec.ts --grep "project file tree"`

Expected: 所有项目文件树 E2E 场景通过，且不再存在右栏旧查询编排。

### Task 4: 固化性能预算并完成验证

**Files:**

- Create: `apps/web/src/features/workbench/components/project-file-tree.performance.test.ts`
- Modify: `tests/performance-budgets.json`
- Modify: `tests/web-bundle-budget.test.ts`
- Modify: `tools/verify-web-bundle.mjs`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/quality-guidelines.md`
- Modify: `.superwork/plans/2026-08-18-headless-project-file-tree.md`

**Interfaces:**

- Consumes: `WorkbenchProjectFileTree`、现有性能预算与 Bundle 门禁
- Produces: 10,000 节点虚拟挂载、树构建耗时和 Heap 生命周期证据

**Behavior:**

- 600px 视口只挂载可见行与有界 overscan；大型目录展开和键盘导航保持响应；工作台静态闭包不突破现有 Bundle 预算。

**Stop Conditions:**

- 需要提高现有 Bundle 或性能预算才能通过时停止并报告实测数据。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 完整质量、性能、Bundle、打包和浏览器流程全部通过。
