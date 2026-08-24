# Feature Implementation Plan

**Goal:** 移除中栏右上角的更多操作按钮，并让桌面端左右栏可在明确宽度边界内拖拽调整。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束工作台面板、可访问交互和视觉 Token。
- `.superwork/spec/frontend/quality-guidelines.md` — 要求页面行为通过 Playwright 和基础门禁验证。
- `docs/web-design.md` — 定义三栏工作台与窄屏覆盖模式。

**Architecture:** 在 Workbench 功能内增加独立分隔线组件，由 `WorkbenchShell` 持有左右栏宽度状态并通过 CSS 自定义属性驱动 Grid；窄屏覆盖模式沿用现有固定宽度且不展示分隔线。

**Tech Stack:** React 19、TypeScript、Tailwind CSS 4、Playwright

## Global Constraints

- 使用语义化 `separator` 和可访问名称，支持指针拖拽与方向键调整。
- 左栏宽度限制为 `220px` 至 `400px`，右栏宽度限制为 `260px` 至 `480px`。
- 保留现有面板开关、窄屏遮罩和响应式关闭行为，不启动开发服务器。

### Task 1: 实现工作台面板宽度调整

**Files:**

- Create: `apps/web/src/features/workbench/components/workbench-panel-resizer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/shared/styles/globals.css`
- Test: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `WorkbenchShell` 的面板开关状态、现有 Grid CSS 自定义属性和 Pointer Event。
- Produces: `WorkbenchPanelResizer`、受限的左右栏宽度状态及可观察的桌面拖拽行为。

**Behavior:**

- 删除中栏标题栏的“更多操作”按钮；打开的左右栏分别显示分隔线，拖拽和方向键只能在各自最小、最大宽度之间调整，窄屏布局继续占满主时间线且不产生横向溢出。

**Stop Conditions:**

- 如果现有三栏 DOM 顺序无法在不破坏窄屏覆盖模式的情况下放置分隔线，则停止并重新确定布局边界。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "resizes desktop workbench panels within bounds|keeps the narrow workbench layout stable"`

Expected: 指定 Playwright 用例通过，拖拽宽度被限制且窄屏主时间线保持稳定。
