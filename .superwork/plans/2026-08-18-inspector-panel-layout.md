# Feature Implementation Plan

**Goal:** 增大右栏默认宽度、允许其与中栏平分左栏之外的空间，并把顶部标题区改为固定标签栏。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector 页签行为、共享 Button 和紧凑工作台视觉。
- `.superwork/spec/frontend/state-management.md` — 约束 Inspector 页签只由用户切换及瞬时布局状态归属。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束响应式、可访问性和页面行为验证。

**Architecture:** 将面板断点、默认宽度和动态上限集中到工作台布局模块；Runtime 持有容器宽度与面板状态，Layout 只消费计算结果；Inspector 顶部直接渲染固定项目/上下文标签与窄屏关闭操作。

**Tech Stack:** React 19、TypeScript、Tailwind CSS v4、Vitest、Playwright。

## Global Constraints

- 大屏右栏默认使用现有最大宽度 `480px`，笔记本宽度使用较小默认值。
- 右栏最大宽度必须等于左栏之外剩余空间的一半，且不低于可操作最小宽度。
- 项目和上下文标签始终固定且不可删除，当前任务不增加不存在的其他标签。
- 保留现有移动覆盖模式、键盘分隔器语义和用户主动切换页签行为。
- 生产 TypeScript 文件不得超过 500 行。

### Task 1: 定义响应式右栏宽度契约

**Files:**

- Create: `apps/web/src/features/workbench/components/workbench-panel-layout.ts`
- Create: `apps/web/src/features/workbench/components/workbench-panel-layout.test.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/shared/styles/globals.css`

**Interfaces:**

- Consumes: 工作台容器宽度、左栏打开状态与宽度、浏览器媒体查询。
- Produces: 大屏/笔记本默认右栏宽度、动态最大宽度和收缩后的右栏状态。

**Behavior:**

- 大屏默认右栏为 `480px`，笔记本默认适当收缩；拖拽上限始终使右栏不超过左栏之外剩余空间的一半，容器收窄时同步收缩现有宽度。

**Stop Conditions:**

- 容器宽度无法在支持的浏览器矩阵内可靠观测时停止并重新评估实现。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-panel-layout.test.ts`

Expected: 宽度默认值、动态平分上限和边界收缩测试通过。

### Task 2: 将 Inspector 顶部改为固定标签栏

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

**Interfaces:**

- Consumes: `WorkbenchInspectorTab`、`onTabChange`、`contextOnly` 和 `onClose`。
- Produces: 无“运行环境”可见标题、直接置顶的项目/上下文标签和保留的窄屏关闭入口。

**Behavior:**

- 普通 Project Inspector 顶部始终显示两个独立标签样式的页签；移除标题栏目，保持 ARIA Tab 语义与用户点击切换。

**Stop Conditions:**

- 标签栏无法同时容纳窄屏关闭操作且不产生横向页面溢出时停止并调整布局。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: Inspector 组件测试确认标题栏目消失、固定标签存在且内容切换不回归。

### Task 3: 覆盖桌面平分与笔记本默认宽度

**Files:**

- Modify: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Modify: `tests/e2e/app-shell-settings-navigation.spec.ts`

**Interfaces:**

- Consumes: 工作台三栏渲染尺寸、Inspector 分隔器 ARIA 数值与标签栏可见状态。
- Produces: 桌面动态最大宽度和笔记本默认宽度的浏览器回归证据。

**Behavior:**

- `1440px` 桌面拖拽到上限后右栏与中栏平分左栏外空间；笔记本视口默认使用较小右栏宽度；顶部不再渲染运行环境标题。

**Stop Conditions:**

- 现有 E2E fixture 无法稳定提供所需工作台路由或视口尺寸时停止并报告阻塞。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-inspector-layout.spec.ts --project=chromium`

Expected: Inspector/Layout Chromium 场景全部通过且无横向溢出。
