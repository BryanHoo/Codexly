# Feature Implementation Plan

**Goal:** 将 Inspector 顶部改成截图式胶囊标签，新建 Task 只显示项目，已有 Task 才显示上下文，并恢复 `288px` 默认宽度。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector 标签显示、切换和右栏尺寸。
- `.superwork/spec/frontend/state-management.md` — 约束 Inspector 瞬时标签状态及 Task 路由边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束响应式、可访问性和浏览器验证。

**Architecture:** 保留集中式面板布局 Hook 和动态 50% 最大宽度，只恢复默认宽度；Inspector 根据 `taskId` 派生可用标签，Runtime 用当前 Task 路由作用域保存用户选择，不再根据计划自动切换；标签视觉复用共享 Button 变体和 Lucide 图标。

**Tech Stack:** React 19、TypeScript、Tailwind CSS v4、Vitest、Playwright。

## Global Constraints

- 右栏默认宽度恢复为 `288px`，动态最大宽度继续等于左栏之外剩余空间的一半。
- 新建 Task 路由只显示项目标签；存在 `taskId` 后才显示上下文标签。
- 新 Task 首次进入已有 Task 路由时默认保持项目选中，上下文只由用户点击打开。
- 标签栏使用截图式无边框胶囊选中态和语义图标，不添加无业务动作的 `+` 按钮。
- 生产 TypeScript 文件不得超过 500 行。

### Task 1: 恢复 Inspector 默认宽度

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-panel-layout.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-panel-layout.test.ts`
- Modify: `apps/web/src/shared/styles/globals.css`

**Interfaces:**

- Consumes: `inspectorWidthLimits`、`getInspectorMaximumWidth` 和 Inspector 覆盖模式 CSS。
- Produces: 所有桌面视口统一 `288px` 默认宽度及保留的动态最大宽度。

**Behavior:**

- Inspector 在大屏和笔记本上均以 `288px` 打开，拖拽上限仍按剩余空间的一半计算，窄屏覆盖宽度恢复原尺寸。

**Stop Conditions:**

- 动态最大宽度必须回退为固定值才能恢复默认宽度时停止并报告冲突。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-panel-layout.test.ts`

Expected: 默认宽度与动态最大宽度测试通过。

### Task 2: 按 Task 路由控制胶囊标签

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

**Interfaces:**

- Consumes: `taskId`、`WorkbenchInspectorTab`、`onTabChange` 和共享 `Button` 变体。
- Produces: 新建 Task 单项目标签、已有 Task 项目/上下文标签及路由作用域内的用户选择。

**Behavior:**

- 删除计划出现时自动切换上下文的旧逻辑；标签栏以带图标的截图式胶囊呈现，项目始终可见，上下文仅在 `taskId` 存在时可见且默认不选中。

**Stop Conditions:**

- 临时 Task 的纯上下文视图或移动端关闭操作发生回归时停止并修正。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: 组件测试覆盖新建 Task、已有 Task、标签视觉和临时 Task 行为并全部通过。

### Task 3: 更新浏览器回归与规范

**Files:**

- Modify: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Modify: `tests/e2e/app-shell-settings-navigation.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/state-management.md`

**Interfaces:**

- Consumes: 工作台路由、Inspector 标签 ARIA 语义、浏览器实际宽度和前端规范索引。
- Produces: 新建/已有 Task 标签时机、默认宽度和用户点击上下文的持久回归证据。

**Behavior:**

- 浏览器验证新建 Task 仅有项目、已有 Task 默认项目且可切换上下文、`1440px` 与 `1280px` 默认宽度均为 `288px`；规范同步替换旧固定标签与自动计划切换规则。

**Stop Conditions:**

- E2E fixture 无法稳定区分新建 Task 与已有 Task 路由时停止并报告阻塞。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-inspector-layout.spec.ts tests/e2e/app-shell-settings-navigation.spec.ts --project=chromium`

Expected: 两组 Chromium E2E 全部通过，规范格式和索引可达性保持有效。
