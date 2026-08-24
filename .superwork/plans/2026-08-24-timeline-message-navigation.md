# Feature Implementation Plan

**Goal:** 在桌面中栏内部右侧、避开滚动条并距右栏分割线至少 `14px` 提供基于用户消息的快捷导航，支持当前项反馈、悬浮预览和精确跳转，并在移动端或仅有一条用户消息时隐藏。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束工作台布局、Tooltip、时间线和可访问性交互。
- `.superwork/spec/frontend/state-management.md` — 约束虚拟时间线、稳定 Item Key 和实时 Store 订阅。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Vitest、Playwright、桌面/移动布局和用户可观察行为验证。
- `.superwork/spec/guides/index.md` — 约束项目命令、文件长度与最终门禁。

**Architecture:** 从归一化 Task Store 的 Turn/Item 顺序派生用户消息锚点；导航组件只消费稳定锚点视图模型。点击时由现有 `ConversationVirtualList` 先滚动到目标 Turn，待虚拟节点挂载后再按复合 Item Key 精确滚动到目标消息。会话滚动容器暴露平台实际 scrollbar 占位宽度和滚动位置，导航据此固定在中栏右侧、在滚动条内侧继续保留 `14px` 间距并标记当前阅读位置。

**Tech Stack:** React 19、TypeScript、Zustand、TanStack Virtual、Tailwind CSS v4、Radix Tooltip、Vitest、Playwright。

## Global Constraints

- 仅使用 `@codexly/protocol` 已校验的消息数据，不新增或修改网络协议。
- 用户消息正文、Skill 和附件名称保持原文；导航可访问文案通过 `zh-CN` 与 `en` 的 `conversation` 命名空间提供。
- 复用共享 Tooltip 与设计 Token，不在 Feature 中散落颜色、圆角或阴影字面值。
- 生产代码文件不得超过 500 行；快捷导航在所有工作台尺寸保持可点击，Hover 预览同时提供键盘焦点等价行为。

### Task 1: 建立用户消息导航视图与组件

**Files:**

- Create: `apps/web/src/features/workbench/components/task-timeline-navigation.tsx`
- Create: `apps/web/src/features/workbench/components/task-timeline-navigation.test.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store-items.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`

**Interfaces:**

- Consumes: `TaskStore`, `AgentItem`,稳定的 `turnId + itemId` 复合 Item Key。
- Produces: `TaskTimelineNavigationItem[]` 与 `TaskTimelineNavigation`，每项包含目标 Turn 索引、消息锚点和原文预览。

**Behavior:**

- 按 Turn 与 Item 原始顺序提取用户消息和 Review 请求；正文为空时使用 Skill 或附件名称形成可辨识预览。
- 仅当导航项超过一条时渲染目录；每项提供可访问按钮、悬浮/键盘焦点预览和稳定刻度尺寸。

**Stop Conditions:**

- 若用户消息无法从当前 Task Store 稳定识别或缺少唯一复合键，则停止并回到状态边界确认接口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline-navigation.test.tsx`

Expected: 导航提取、单条隐藏、顺序和预览文案测试全部通过。

### Task 2: 接入虚拟时间线精确跳转与浏览器回归

**Files:**

- Modify: `apps/web/src/shared/components/agent/conversation.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store-items.tsx`
- Modify: `apps/web/src/shared/styles/workbench.css`
- Modify: `tests/e2e/app-shell-inspector-sidebar.spec.ts`

**Interfaces:**

- Consumes: `ConversationVirtualList` 的 TanStack Virtual 实例、`data-conversation-anchor` DOM 锚点和中栏滚动容器。
- Produces: `navigateToItem(turnIndex, anchorId)` 行为，支持未挂载 Turn 的虚拟滚动后精确定位。

**Behavior:**

- 在桌面中栏内部右侧垂直居中显示导航；按实际 scrollbar 占位宽度避让，并在其内侧与中栏/右栏分割线保留至少 `14px` 间距，左右栏关闭时继续显示，进入移动覆盖布局或仅一条用户消息时隐藏。
- 刻度默认保持短、粗、圆润、紧密和淡色，当前阅读位置对应的刻度颜色更深；只有 Hover 或键盘聚焦时才放大并进一步提高对比度。
- Hover 或键盘聚焦显示对应用户消息预览；点击后滚动到准确用户消息，且不破坏现有自动跟随和“回到底部”行为。
- 浏览器测试覆盖多条显示、单条隐藏、Tooltip 原文、点击跳转，以及左栏隐藏和移动端隐藏。

**Stop Conditions:**

- 若目标 Turn 在有界渲染等待后仍无法挂载，则停止精确定位重试并保留已完成的 Turn 级滚动，禁止无限动画帧循环。

- [x] **Task Status:** completed

Run: `pnpm --filter @codexly/web build && pnpm exec playwright test tests/e2e/app-shell-inspector-sidebar.spec.ts --grep "用户消息快捷导航"`

Expected: 显示与交互、精确滚动、单条隐藏，以及左栏隐藏和移动端隐藏断言全部通过。
