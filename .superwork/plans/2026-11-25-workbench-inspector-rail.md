# Feature Implementation Plan

**Goal:** Web 和桌面共用默认收起的会话右栏。收起时以竖排按钮直接打开标签，常规设置可指定默认开启。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 跨端和验证规则
- `.superwork/spec/frontend-core/shared/index.md` — 偏好存储及分屏约束
- `.superwork/spec/ui/shared/index.md` — 共享控件与验证
- `.superwork/spec/web/frontend/index.md` — Web 和移动浏览器
- `.superwork/spec/desktop/frontend/index.md` — 桌面前端

**Architecture:** 保存到两端已有的会话显示偏好，共用开关状态和右栏按钮。活动分屏沿用现有外层右栏 Portal。

**Tech Stack:** TypeScript、React、pnpm、Vitest、Playwright

## Global Constraints

- 关键逻辑和执行边界使用清晰的中文注释。
- Web 和桌面共用组件及状态逻辑，沿用各自的存储适配器。
- 收起时按现有标签可用性提供入口，延迟挂载右栏内容。

### Task 1: 右栏的默认状态和显示入口

**Files:**

- Modify: `.superwork/spec/ui/shared/index.md`
- Modify: `.superwork/spec/web/frontend/index.md`
- Test: `apps/web/src/features/conversation/runtime/task-store-timing.test.ts`
- Modify: `apps/web/src/features/settings/components/general-settings-panel.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-inspector-tabs.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-tabs.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-panel-layout.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-controller.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-shell-header.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-header.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/hooks/use-close-mobile-sidebar.ts`
- Modify: `apps/web/src/i18n/locales/en/settings-general.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/settings-general.ts`
- Modify: `apps/web/src/shared/styles/workbench.css`
- Test: `desktop/src/features/settings/components/conversation-display-preferences.browser.test.tsx`
- Modify: `desktop/src/features/settings/components/general-settings-panel.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-inspector-tabs.tsx`
- Delete: `desktop/src/features/workbench/components/workbench-inspector-toggle.tsx`
- Test: `desktop/src/features/workbench/components/workbench-panel-layout.browser.test.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-panel-layout.ts`
- Modify: `desktop/src/features/workbench/components/workbench-shell-controller.tsx`
- Test: `desktop/src/features/workbench/components/workbench-shell-header.test.ts`
- Modify: `desktop/src/features/workbench/components/workbench-shell-header.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-shell-inspector.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `desktop/src/i18n/locales/en/settings-general.ts`
- Modify: `desktop/src/i18n/locales/zh-CN/settings-general.ts`
- Modify: `desktop/src/shared/styles/workbench.css`
- Test: `desktop/tests/browser/turn-processing-alignment.browser.test.tsx`
- Test: `packages/frontend-core/src/conversation-display-preferences.test.ts`
- Modify: `packages/frontend-core/src/conversation-display-preferences.ts`
- Modify: `packages/frontend-core/src/settings-navigation.ts`
- Modify: `packages/frontend-core/src/turn-output-rate.ts`
- Modify: `packages/ui/src/core/split-inspector.tsx`
- Modify: `packages/ui/src/core/split-workspace.css`
- Test: `tests/e2e/app-shell-background-terminal.spec.ts`
- Test: `tests/e2e/app-shell-commit-mutation.spec.ts`
- Test: `tests/e2e/app-shell-composer-actions.spec.ts`
- Test: `tests/e2e/app-shell-composer-commit.spec.ts`
- Test: `tests/e2e/app-shell-composer-drafts.spec.ts`
- Test: `tests/e2e/app-shell-composer-file-tree.spec.ts`
- Test: `tests/e2e/app-shell-composer-git.spec.ts`
- Test: `tests/e2e/app-shell-composer-goals.spec.ts`
- Test: `tests/e2e/app-shell-composer-review.spec.ts`
- Test: `tests/e2e/app-shell-document-task-navigation.spec.ts`
- Test: `tests/e2e/app-shell-document-workspace.spec.ts`
- Test: `tests/e2e/app-shell-file-creation.spec.ts`
- Test: `tests/e2e/app-shell-inspector-desktop.spec.ts`
- Test: `tests/e2e/app-shell-inspector-mobile.spec.ts`
- Test: `tests/e2e/app-shell-inspector-projects.spec.ts`
- Test: `tests/e2e/app-shell-inspector-sidebar.spec.ts`
- Test: `tests/e2e/app-shell-pdf-preview.spec.ts`
- Test: `tests/e2e/app-shell-runtime-requests.spec.ts`
- Test: `tests/e2e/app-shell-settings-connection.spec.ts`
- Test: `tests/e2e/app-shell-settings-projects.spec.ts`
- Test: `tests/e2e/app-shell-settings-workbench.spec.ts`
- Create: `packages/frontend-core/src/workbench-panel-breakpoints.ts`
- Create: `packages/ui/src/core/workbench-inspector-rail.tsx`

**Interfaces:**

- Consumes: `getAvailableWorkbenchInspectorTabs`、`SplitInspectorProvider`、`ConversationDisplaySwitch`
- Produces: `inspectorInitiallyOpen` 偏好、`WorkbenchInspectorRail` 和直接打开指定标签的操作

**Behavior:**

- 无偏好时默认收起。设置开启后应用默认展开。
- 收起后将面板开关和可用标签放在右侧，点击标签直接打开对应内容。

**Stop Conditions:**

- 如果当前分屏容器无法承载共享右栏，检查实际 Portal 归属再调整布局。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/frontend-core/src/conversation-display-preferences.test.ts`

Expected: 旧数据默认收起，保存的默认展开设置可以恢复。

## 验证结果

- 偏好用例先确认旧实现缺少默认展开字段。最终共享及相关 Web 单元测试 618 项通过。
- Web 右栏、移动、分屏与文件导航回归 42 项通过。提取屏幕断点后复跑右栏、移动和分屏专项。
- 桌面前端检查通过，包括 841 项单元测试、构建及包体限制。桌面偏好与工作台布局浏览器专项 6 项通过。
- Web 首屏 gzip 为 358.97 KiB，工作台就绪为 505.84 KiB，均在预算内。
- 扩展回归仍有失败，包括设置暂停与 ACP 用例。桌面全量浏览器运行中 1682 项通过，18 项失败。保留协作登记以记录全量验收状态。

- 右栏位置补充验证覆盖开关和标题栏垂直居中，以及首个标签紧跟标题栏。旧样式实测偏低 44px。修复后 9 项 Web 浏览器专项和 6 项桌面浏览器专项通过，Web 首屏 gzip 为 358.96 KiB。

- 视图入口改为共用的轻量圆角分组，标题栏开关单独对齐。用实际工作台检查浅色和深色，9 项 Web 浏览器专项和 6 项桌面浏览器专项通过，两端类型检查通过，Web 首屏 gzip 为 358.96 KiB。

- 右栏快捷按钮取消独立网格列和彩色分组，改为透明浮动、等大等距。窄屏消息内边距用于避开按钮。实际检查 1240px 和 390px 的工作台。两端类型检查通过，Web 10 项和桌面 16 项浏览器专项通过，Web 首屏 gzip 为 358.99 KiB。
