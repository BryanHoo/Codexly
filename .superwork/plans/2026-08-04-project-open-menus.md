# Feature Implementation Plan

**Goal:** 使用 shadcn `ContextMenu`、`DropdownMenu` 和 `ButtonGroup` 替换 Project 打开控件中的手写菜单与分段按钮实现。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/directory-structure.md` — 约束 shadcn 基础组件统一放入 `src/shared/ui`。
- `.superwork/spec/frontend/component-guidelines.md` — 定义 Project 打开菜单和文件树右键菜单行为。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束键盘、焦点、可访问名称和 E2E 验证。
- `docs/web-design.md` — 定义 Project 文件树与宿主应用打开流程。

**Architecture:** 在 `shared/ui` 增加 Context Menu 与 Button Group primitive，并扩展现有 Dropdown Menu 的选择项能力；Project 顶栏使用 Dropdown Menu 与 Button Group 组合，文件树节点通过 Context Menu Trigger 直接提供右键菜单，使 Radix 接管指针定位、Portal、焦点、Escape 与外部点击。

**Tech Stack:** React 19、TypeScript、Radix UI、shadcn/ui、Tailwind CSS 4、Vitest、Playwright

## Global Constraints

- 保留现有设计 Token、尺寸、响应式标签、应用图标、选中态、错误状态和 Mutation 单飞行为。
- 文件目标继续包含 `system-default`，目录目标继续排除该能力；右键打开不得修改 Project 默认应用偏好。
- 删除手写坐标计算、`createPortal`、全局 pointer/keydown 监听和重复焦点管理，不保留旧逻辑。
- Project 顶栏下拉菜单继续支持 ArrowDown、Escape、外部点击、焦点恢复和视口碰撞处理。
- 关键非显然逻辑使用简短清晰的中文注释。

### Task 1: 补齐共享菜单与按钮组 primitives

**Files:**

- Create: `apps/web/src/shared/ui/context-menu.tsx`
- Create: `apps/web/src/shared/ui/button-group.tsx`
- Modify: `apps/web/src/shared/ui/dropdown-menu.tsx`
- Modify: `apps/web/src/shared/ui/ui-primitives.test.tsx`

**Interfaces:**

- Consumes: `radix-ui/context-menu`、`radix-ui/dropdown-menu`、`cn`
- Produces: `ContextMenu*`、`ButtonGroup`、`DropdownMenuRadioGroup`、`DropdownMenuRadioItem`

**Behavior:**

- 提供适配现有 Token 的 Context Menu Portal、Content、Trigger、Label、Separator、Item，以及用于分段操作的 Button Group。
- Dropdown Menu 提供带 `menuitemradio` 语义的 Radio Group 与 Radio Item；SSR 测试可静态验证组件 slots，浏览器继续使用 Radix Portal。

**Stop Conditions:**

- 若现有 `radix-ui` 版本不提供 Context Menu 或 Dropdown Menu radio primitives，则停止并报告依赖约束。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/ui/ui-primitives.test.tsx`

Expected: primitive 测试通过，并验证 Context Menu、Dropdown Menu radio 与 Button Group slots。

### Task 2: 使用 DropdownMenu 和 ButtonGroup 重构 ProjectOpenMenu

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-open-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.test.tsx`

**Interfaces:**

- Consumes: `ButtonGroup`、`DropdownMenu*`、Project 打开应用目录和偏好存储
- Produces: shadcn 分段打开控件和应用选择 Dropdown Menu

**Behavior:**

- 使用 Button Group 组合主打开按钮和 Dropdown Menu Trigger，保持现有尺寸、边界与响应式文案。
- 使用 Dropdown Menu Radio Group 表达当前应用选择，由 Radix 管理 Portal、键盘导航、Escape、外部点击和焦点恢复；选择后继续保存 Project 偏好。

**Stop Conditions:**

- 若 Dropdown Menu Trigger 组合破坏主按钮 Mutation 单飞、响应式布局或偏好写入，则停止并提供最小复现。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-open-menu.test.tsx`

Expected: Project 打开菜单测试通过，并验证 Button Group、Dropdown Menu Content 和 radio items。

### Task 3: 使用 ContextMenu 重构 ProjectOpenContextMenu

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-open-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

**Interfaces:**

- Consumes: `ContextMenu*`、Project 文件树节点、目标应用过滤规则
- Produces: 直接绑定文件与目录节点的 Project 打开 Context Menu

**Behavior:**

- 每个可操作文件树节点通过 Context Menu Trigger 绑定目标路径和类型，右键打开时同步选中节点。
- Context Menu 使用 Label、Separator 和 Item 呈现目标路径及应用命令，由 Radix 负责指针坐标、Portal、首项焦点、Escape、外部点击和视口碰撞。
- 删除 Inspector 中的全局 Context Menu target 状态和旧坐标字段、计算函数及事件监听。

**Stop Conditions:**

- 若 Context Menu Trigger 无法与 FileTree 的 `treeitem` 根节点组合，或右键会触发普通文件打开/目录展开，则停止并说明事件冲突。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-open-menu.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: 两组测试通过，并验证文件树 Context Menu slots、目标应用过滤与菜单命令结构。
