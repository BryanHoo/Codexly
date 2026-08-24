# Feature Implementation Plan

**Goal:** 将 Web 工作台重塑为依靠背景材质、柔和阴影和空间层级区分区域的 macOS 原生风格，并让所有页面复用统一的全局设计 tokens。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束统一门禁、依赖方向和长命令执行方式。
- `.superwork/spec/frontend/index.md` — 提供 Web 分层与质量规范入口。
- `.superwork/spec/frontend/component-guidelines.md` — 约束紧凑工作台、组件职责和可访问性。
- `.superwork/spec/frontend/quality-guidelines.md` — 定义 Vitest、Playwright 和布局稳定性要求。
- `.superwork/spec/frontend/directory-structure.md` — 确认全局样式与功能组件归属。

**Architecture:** 在 `globals.css` 建立语义化 CSS tokens，并通过 Tailwind CSS 4 `@theme inline` 暴露颜色、字体、字号、间距、圆角、阴影、动效和布局尺寸；组件只消费这些全局语义 tokens。视觉上以冷灰窗口底色、半透明侧栏材质、抬升内容面和极淡分隔阴影替代强边框，同时保留现有高密度三栏结构与响应式行为。

**Tech Stack:** TypeScript 6、React 19、Tailwind CSS 4、Lucide React、Vitest、Playwright、pnpm Workspace。

## Global Constraints

- 保持现有路由、交互语义、可访问名称和响应式面板行为不变。
- 所有新增颜色、字号、间距、圆角、阴影、动效和固定布局尺寸必须来自 `globals.css` 的全局设计 tokens。
- 使用背景、透明材质、淡阴影和留白建立层级，不使用贯穿主区域的高对比度边框。
- 保持 macOS 系统字体栈和紧凑桌面工作台密度，不引入外部字体或新增依赖。
- 同时支持显式浅色、显式深色和系统深色偏好；确保焦点与状态颜色保持可辨识。
- 关键实现逻辑使用简短中文注释，标识符、命令、路径和日志保持原文。
- 每个代码行为切片通过 `superwork-tdd` 执行，所有测试命令设置明确超时。

### Task 1: 建立完整的全局设计 tokens

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/shared/styles/globals.css`.
- Modify: `tests/e2e/app-shell.spec.ts`.

**Interfaces:**

- Consumes: `TailwindTheme: @theme inline CSS contract`.
- Produces: `DesignTokens: global semantic CSS custom properties and Tailwind utilities`.

**Behavior Slice:**

- 页面根节点提供统一的颜色材质、排版层级、空间尺度、圆角、阴影、动效和布局尺寸 tokens；浅色、深色与系统主题共享同一语义命名，组件无需感知具体色值。

**Proof Intent:**

- 先在 Playwright 中断言关键 tokens 的 computed style 存在且浅色与深色主题值不同，再扩展全局主题；构建产物不得出现无效 Tailwind utility。

**Verification:**

- Run: `pnpm test:e2e --grep "design tokens"`.
- Expected: command exits `0`; browser can resolve semantic background, typography, spacing, radius and shadow tokens in light and dark themes.

**Stop Conditions:**

- Tailwind CSS 4 无法从当前 `@theme inline` 映射所需 token 类型。
- 新 token 命名与现有公开 utility 产生不可消解的冲突。
- 测试需要改变主题运行时行为或引入新的状态管理。

### Task 2: 用材质层级重塑工作台与共享 AI Elements

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`.
- Modify: `apps/web/src/features/workbench/components/thread-sidebar.tsx`.
- Modify: `apps/web/src/features/workbench/components/thread-timeline.tsx`.
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`.
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`.
- Modify: `apps/web/src/shared/ui/icon-button.tsx`.
- Modify: `apps/web/src/shared/ai-elements/conversation.tsx`.
- Modify: `apps/web/src/shared/ai-elements/message.tsx`.
- Modify: `apps/web/src/shared/ai-elements/prompt-input.tsx`.
- Modify: `apps/web/src/shared/ai-elements/reasoning.tsx`.
- Modify: `apps/web/src/shared/ai-elements/tool.tsx`.
- Modify: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`.
- Modify: `tests/e2e/app-shell.spec.ts`.

**Interfaces:**

- Consumes: `DesignTokens: global semantic CSS custom properties and Tailwind utilities`.
- Produces: `WorkbenchMaterials: token-driven sidebar, content, inspector, toolbar and composer presentation`.

**Behavior Slice:**

- 桌面三栏通过不同材质背景、内侧淡阴影和抬升 Composer 区分，移除面板与时间线中的强边框；共享 AI Elements 统一使用 tokens 控制字号、间距、圆角、阴影和状态反馈，窄屏抽屉继续正确覆盖与关闭。

**Proof Intent:**

- 先补充组件标记和浏览器断言，证明主面板不再依赖左右边框、Composer 具有抬升阴影、窄屏无水平溢出；再替换工作台与共享组件样式，并保留现有交互测试。

**Verification:**

- Run: `pnpm test -- apps/web/src/shared/ai-elements/ai-elements.test.tsx` and `pnpm test:e2e --grep "workbench|narrow"`.
- Expected: both commands exit `0`; workbench landmarks remain accessible, panel dismissal works, computed border widths are zero, and narrow layout has no overlap or overflow.

**Stop Conditions:**

- token 替换要求改变组件 Props、路由或数据模型。
- 材质背景在浅色或深色主题下无法保持内容对比度。
- 响应式抽屉必须依赖新增运行时库才能维持现有行为。

### Task 3: 统一所有路由并完成视觉与工程校验

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`.
- Modify: `apps/web/src/app/routes/root-route.tsx`.
- Modify: `apps/web/src/app/routes/login-route.tsx`.
- Modify: `apps/web/src/app/routes/workspaces-route.tsx`.
- Modify: `apps/web/src/app/routes/settings-route.tsx`.
- Modify: `apps/web/src/app/routes/not-found.tsx`.
- Modify: `tests/e2e/app-shell.spec.ts`.
- Modify: `.superwork/plans/2026-07-22-macos-design-tokens.md`.

**Interfaces:**

- Consumes: `DesignTokens: global semantic CSS custom properties and Tailwind utilities`.
- Consumes: `WorkbenchMaterials: token-driven sidebar, content, inspector, toolbar and composer presentation`.
- Produces: `UnifiedWebTheme: token-driven presentation across every registered route`.

**Behavior Slice:**

- 登录、Workspace、设置、错误与 404 页面使用相同的窗口背景、标题层级、控制样式和抬升表面，不再保留独立的硬边框视觉；所有注册路由在桌面与移动视口保持可读、无重叠且键盘焦点清晰，桌面窗口缩窄后自动关闭转为覆盖层的面板。

**Proof Intent:**

- 先扩展 E2E 覆盖所有路由的 token 应用与主表面边界，再完成页面替换；最后运行统一门禁、完整浏览器流程，并检查桌面与移动截图、控制台错误和像素内容。

**Verification:**

- Run: `pnpm check` and `pnpm test:e2e`.
- Expected: both commands exit `0`; all registered routes use the shared theme, desktop and mobile screenshots contain rendered content without overlap, and browser console has no errors.

**Stop Conditions:**

- 统一门禁出现与本计划无关且无法安全绕过的既有失败。
- 浏览器校验发现需要改变产品信息架构或运行时契约。
- 完成视觉一致性需要新增依赖、外部资源或扩大到 Web 之外的包。
