# Feature Implementation Plan

**Goal:** 使用共享 shadcn `DropdownMenu` 替换 `ProjectActions` 与 `TaskLink` 手写的菜单定位、Portal、外部点击和 Escape 处理。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/directory-structure.md` — 约束 shadcn 基础组件统一放入 `src/shared/ui`。
- `.superwork/spec/frontend/component-guidelines.md` — 约束侧栏操作菜单的裁剪、对齐、键盘与外部点击行为。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束可访问性和用户行为测试。
- `docs/web-design.md` — 定义 Project 与 Task 操作菜单的产品行为。

**Architecture:** 在 `shared/ui` 封装 Radix Dropdown Menu，并由 Feature 组件组合 Trigger、Portal Content 和 Item；删除 Feature 内重复的坐标计算、Portal 和全局事件监听逻辑，由 Radix 负责碰撞检测、焦点恢复、Escape 与外部点击关闭。

**Tech Stack:** React 19、TypeScript、Radix UI、shadcn/ui、Tailwind CSS 4、Vitest

## Global Constraints

- 保留 Project 菜单“重命名、删除”和 Task 菜单“固定/取消固定、重命名、归档”的顺序、图标、禁用态与本地化文案。
- 菜单继续脱离侧栏滚动容器裁剪，左边缘与触发按钮对齐，并在视口边缘自动翻转或偏移。
- 删除旧的手写坐标常量、`createPortal`、`useLayoutEffect`、外部指针监听和 Escape 处理，不保留冗余兼容路径。
- 关键封装位置使用简短、清晰的中文注释，解释 SSR Portal 降级或非显然的 Radix 行为。

### Task 1: 添加共享 DropdownMenu 基础组件

**Files:**

- Create: `apps/web/src/shared/ui/dropdown-menu.tsx`
- Modify: `apps/web/src/shared/ui/ui-primitives.test.tsx`

**Interfaces:**

- Consumes: `radix-ui/dropdown-menu`、`cn`
- Produces: `DropdownMenu`、`DropdownMenuTrigger`、`DropdownMenuPortal`、`DropdownMenuContent`、`DropdownMenuItem`

**Behavior:**

- 提供符合现有设计 Token 的 shadcn Dropdown Menu 封装，Content 默认通过 Portal 渲染并配置安全碰撞边距，Trigger 的 `asChild` 不增加额外按钮 DOM，Item 保留业务传入的视觉类。
- SSR 测试环境可静态渲染打开的菜单内容，浏览器环境仍使用 Radix Portal 和完整菜单交互。

**Stop Conditions:**

- 若当前 `radix-ui` 版本不导出 Dropdown Menu primitive 或组件无法在 React SSR 下安全封装，则停止并报告依赖或渲染约束。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/ui/ui-primitives.test.tsx`

Expected: shadcn UI primitive 测试通过，并验证 Dropdown Menu Trigger 组合、Portal Content 与 Item 结构。

### Task 2: 替换侧栏 Project 与 Task 操作菜单

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`

**Interfaces:**

- Consumes: Task/Project action callbacks、共享 `DropdownMenu` 组件、本地化文案
- Produces: 由 Radix 管理定位、Portal、外部点击、Escape、焦点恢复和键盘导航的 Project/Task 操作菜单

**Behavior:**

- 将 `ProjectActions` 和 `TaskLink` 改为受控 `DropdownMenu`，保留现有 Trigger 位置、可访问名称、禁用态和菜单命令回调。
- 将 `ProjectActionMenu` 和 `TaskActionMenu` 改为基于 `DropdownMenuContent`、`DropdownMenuItem` 的菜单内容，保持 Project 菜单宽度和 Task 菜单左对齐契约。
- 删除所有手写坐标状态、尺寸常量、滚动/缩放监听、Portal、外部指针监听及 Escape 键处理。

**Stop Conditions:**

- 若 Radix 的 Trigger 组合会破坏 Task 行绝对定位、Project 拖拽事件或菜单项回调单飞约束，则停止并以最小复现说明冲突。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-sidebar.test.tsx`

Expected: 侧栏单元测试通过，并验证 Project/Task 菜单命令、顺序、Dropdown Menu slots 与禁用态。
