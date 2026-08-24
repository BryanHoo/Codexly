# Feature Implementation Plan

**Goal:** 将 Web 工作台统一为指定 Codex 浅色/深色主题，并减少面板分割与多余留白，形成纯净紧凑的原生应用视觉。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 定义全仓验证要求。
- `.superwork/spec/frontend/component-guidelines.md` — 约束语义 token、主题切换和工作台分层方式。
- `.superwork/spec/frontend/quality-guidelines.md` — 定义浏览器视觉与行为验证范围。
- `docs/web-design.md` — 定义三栏工作台、Composer 和响应式面板结构。

**Architecture:** 保留现有 React 组件边界和 `light-dark()` 主题机制，在 `globals.css` 中重建唯一语义 token 系统；组件只调整语义类名与紧凑布局，Playwright 通过主题 computed style、边框和多视口布局验证用户可见结果。

**Tech Stack:** React 19、TypeScript、Tailwind CSS 4、Vite、Playwright、Vitest。

## Global Constraints

- 浅色主题使用 `surface: #ffffff`、`ink: #171717`、`accent: #006aff`、`diffAdded: #28a948`、`diffRemoved: #eb001d`、`skill: #a100f8`。
- 深色主题使用 `surface: #181818`、`ink: #ffffff`、`accent: #339cff`、`diffAdded: #40c977`、`diffRemoved: #fa423e`、`skill: #ad7bf9`。
- 浅色大面积背景不得使用浅灰色；面板层级优先使用透明度、留白和局部淡阴影，不使用贯穿工作台的明显分割线。
- 视觉字面值只进入 `apps/web/src/shared/styles/globals.css`，组件继续消费语义 Tailwind token。
- 保持现有键盘、窄屏覆盖面板与可访问名称行为。

### Task 1: 锁定主题颜色与分层契约

- [x] **Task Status:** completed

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `apps/web/src/shared/styles/globals.css`

**Interfaces:**

- Consumes: `ThemeSelector: [data-theme="light" | "dark"]`
- Produces: `ThemeTokens: --ui-color-* and --ui-shadow-* CSS custom properties`

**Behavior Slice:**

浅色和深色主题分别解析为指定 surface、ink、accent 与语义颜色；浅色窗口、内容、侧栏和面板均保持纯白基底，固定栏分隔使用低对比单像素阴影。

**Proof Intent:**

先让 Playwright 对精确主题 token、两套主题切换和零面板边框建立失败断言，再更新 token 使断言通过。

**Verification:**

Run `pnpm --filter @code-agent/web build` and then `pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "theme|material"`.
Expected: all selected tests pass with no console errors.

**Stop Conditions:**

若浏览器不支持 `light-dark()` 或 computed style 无法稳定解析主题值，停止并修订为可测试的语义契约；若现有测试依赖旧绿色强调色，先确认属于过期视觉契约再更新。

### Task 2: 收紧工作台空间并弱化明显分割

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/shared/styles/globals.css`
- Modify: `apps/web/src/app/routes/login-route.tsx`
- Modify: `apps/web/src/app/routes/settings-route.tsx`
- Modify: `apps/web/src/app/routes/workspaces-route.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/thread-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/thread-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/shared/ai-elements/conversation.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `ThemeTokens: --ui-color-* and --ui-shadow-* CSS custom properties`
- Produces: `CompactWorkbench: semantic classes for shell, sidebar, timeline, composer, and inspector`

**Behavior Slice:**

缩减工具栏和面板内边距、消息间距及 Composer 底部留白，将侧栏、检查器和工具栏的高对比阴影替换为低对比单像素分隔，让选中态和浮动输入框承担主要层级提示，同时保持桌面三栏和移动抽屉无重叠。

**Proof Intent:**

先扩展 Playwright 对桌面/移动零实体边框、浅分隔阴影、关键区域间距上限、溢出和面板开关的失败断言，再调整组件语义类名直至通过。

**Verification:**

Run `pnpm --filter @code-agent/web build` and then `pnpm exec playwright test tests/e2e/app-shell.spec.ts`.
Expected: all tests pass at configured desktop and mobile viewports.

**Stop Conditions:**

若收紧间距导致按钮触控尺寸、文字截断、Composer 遮挡或响应式面板重叠，停止当前切片并修订布局约束；不得通过隐藏必要内容规避溢出。

### Task 3: 完成全仓与视觉验收

- [x] **Task Status:** completed

**Files:**

- Modify: `.superwork/plans/2026-07-22-clean-theme-palette.md`
- Verify: all files changed by Tasks 1-2

**Interfaces:**

- Consumes: `CompactWorkbench: semantic classes for shell, sidebar, timeline, composer, and inspector`
- Produces: `VerificationEvidence: full checks and light/dark viewport screenshots`

**Behavior Slice:**

验证格式、类型、单测、构建、发布检查及关键视口实际渲染，确认无浅灰大底、无明显贯穿分割线、无文字或控件重叠。

**Proof Intent:**

使用全仓门禁和实际浏览器截图证伪主题回退、控制台错误、空白渲染与响应式重叠。

**Verification:**

Run `pnpm check` and `pnpm test:e2e`.
Expected: both commands exit 0, then `1440x900` and `390x844` screenshots pass visual inspection in light and dark themes.

**Stop Conditions:**

任一门禁失败、控制台报错、截图空白、主题颜色不匹配或布局重叠时不得完成计划，必须返回对应任务修复。
