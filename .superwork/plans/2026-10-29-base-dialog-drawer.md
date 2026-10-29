# Feature Implementation Plan

**Goal:** 将两端所有模态弹窗底层替换为 shadcn Base UI Dialog，侧边抽屉使用官方 Base UI Drawer。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 验证与中文注释。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 共享 UI 与应用适配边界。
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 移动触控、桌面及性能。
- `.superwork/spec/ui/shared/index.md` — 关闭按钮、提交锁、焦点恢复。
- `.superwork/spec/web/frontend/index.md` — Web 消费者。
- `.superwork/spec/desktop/frontend/index.md` — 桌面消费者。

**Architecture:** 在共享 UI 维护 Dialog 和 Drawer，重型浮层分别在首次打开时动态加载；既有 asChild 与焦点事件在边界映射到官方 render、initialFocus、finalFocus。关闭拦截映射 Root 的 eventDetails.cancel。Drawer 使用 Portal/Viewport/Popup/Content，调用者明确 swipeDirection。保留 Sheet 导出别名供旧调用兼容，不保留旧实现。

**Tech Stack:** React、TypeScript、Base UI 1.9.0、Tailwind、pnpm、Vitest Chromium/WebKit。

## Global Constraints

- Web、移动浏览器、桌面共用实现，不反向导入应用。
- 保留翻译后的关闭入口、提交锁及未保存保护；根据用户追加的视觉纠正，关闭入口改为独立 32px 方形按钮、16px 图标，替代旧的标题等高布局。
- 关闭时卸载 DOM；只用 transform/opacity 动效并遵循减少动态效果设置，不新增轮询。
- 不修改其他任务声明的共享 UI 索引或依赖版本；不提交 Git。
- parallelTask: base-dialog-drawer-20261029 / codex-dialog-drawer。

### Task 1: 迁移普通弹窗

**Files:**

- Modify: `packages/ui/src/core/dialog.tsx`
- Create: `packages/ui/src/core/dialog-focus.tsx`
- Modify: `apps/web/src/shared/components/core/ui-primitives.test.tsx`
- Test: `desktop/src/shared/components/core/dialog-close.browser.test.tsx`
- Modify: `desktop/vitest.browser.config.ts`

**Interfaces:**

- Consumes: Base UI Dialog.Root/Popup/Backdrop/Portal。
- Produces: 现有 Dialog 公共接口以及原生 render、initialFocus、finalFocus。

**Behavior:**

- 单按钮组合、嵌套 Escape、关闭后焦点恢复、提交锁与原有自定义焦点钩子有效。

**Stop Conditions:**

- 未保存草稿或提交保护丢失时停止扩展，先修复公共边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/components/core/ui-primitives.test.tsx`

Expected: Dialog 组合与 SSR 布局测试通过，浏览器回归覆盖实际交互。

### Task 2: 迁移侧边抽屉并完成验证

**Files:**

- Create: `packages/ui/src/core/drawer.tsx`
- Modify: `packages/ui/src/core/sheet.tsx`
- Modify: `packages/ui/src/core/sidebar-shortcut-group.tsx`
- Modify: `apps/web/src/shared/styles/workbench.css`
- Modify: `desktop/src/shared/styles/workbench.css`
- Modify: `apps/web/src/shared/styles/workbench-background-surfaces.test.ts`
- Modify: `apps/web/src/features/skills-market/official-plugin-sheet.tsx`
- Modify: `desktop/src/features/skills-market/official-plugin-sheet.tsx`
- Modify: `desktop/src/features/workbench/components/plugin-install-suggestion-card.tsx`
- Create: `apps/web/src/shared/components/core/drawer.tsx`
- Create: `desktop/src/shared/components/core/drawer.tsx`
- Create: `desktop/src/shared/components/core/drawer.browser.test.tsx`

**Interfaces:**

- Consumes: Base UI Drawer.Root/Viewport/Popup/Content 与 swipeDirection。
- Produces: 共享 Drawer 系列组件，Sheet 兼容导出。

**Behavior:**

- 左右侧抽屉保留布局、焦点和关闭保护，支持滑动关闭与滚动正文。

**Stop Conditions:**

- 抽屉影响表单编辑、滚动或嵌套焦点时先修复再验收。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/core/drawer.browser.test.tsx`

Expected: Chromium/WebKit 的方向、嵌套、键盘和移动尺寸测试通过；两端类型、构建及相关回归通过。

### Task 3: 按用户指令提高包体预算

**Files:**

- Modify: `tools/verify-web-bundle.mjs`
- Modify: `tests/web-bundle-budget.test.ts`
- Modify: `desktop/performance-budget.json`
- Modify: `.superwork/spec/guides/code-reuse-thinking-guide.md`

**Interfaces:**

- Consumes: 用户“直接提高预算”的明确指令及生产闭包测量结果。
- Produces: Web 工作台 520 KiB gzip 与桌面场景适度扩展的门禁；共享组件长期规范。

**Behavior:**

- Web 工作台实际约 510 KiB 可通过门禁；超过新预算仍拒绝。同步修复先前首屏预算已为 360 KiB 而测试仍为 320 KiB 的漂移。
- 桌面 workspace 1,820,000、markdown 2,320,000、cppHighlight 2,900,000、textEditor 2,150,000 字节。

**Stop Conditions:**

- 实测仍超预算或验证失败时先定位，不直接扩大其他阈值。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/web-bundle-budget.test.ts && pnpm bundle:check && pnpm --dir desktop performance:budget`

Expected: 边界测试与两端真实闭包门禁通过。

## 实施与证据

- 官方依据：https://ui.shadcn.com/docs/components/base/dialog 、https://ui.shadcn.com/docs/components/base/drawer ，同时读取官方注册表源码与 Base UI 文档/已安装 1.9.0 类型实现。
- 普通弹窗全量经两端导出汇聚共享 Dialog；侧栏、插件详情及安装建议改用 Drawer，Sheet 仅保留兼容别名，无 Radix Dialog 实现残留。
- RED：原始 Dialog 不支持 render（aria-label 丢失）；原始 Sheet 缺少 drawer-viewport；生产包体 509.53 KiB 超过原工作台 500 KiB 门禁。
- GREEN：原生 render 组合、SSR 正文、已关闭时不输出正文；两端回调映射 Base UI 焦点/取消机制；独立拖动手柄保留正文的鼠标文本选择。
- 首次滑动证明使用单步拖动，没有形成完整手势；最终使用 20 个真实插值鼠标事件，Chromium/WebKit 均确认 reason=swipe、卸载与焦点恢复。
- 简化评审：no-change。焦点适配为现有编辑器/分屏契约服务，SSR 外壳保留现有静态渲染测试，不导入 Base UI 私有上下文；不再维护独立 Sheet 实现。
- 规范分类脚本建议 create，但现有全局可达的代码复用指南已覆盖这类共享组件，选择 update；避免机械新建无关层索引。共享 UI 索引由其他任务声明持有，本任务未修改。
- 验证环境：本地 macOS、pnpm 11、Node 24；Rust、原生系统文件选择器及协议未修改。

### Task 4: 将 Dialog 和 Drawer 的浮层拆为按需加载

**Files:**

- Modify: `packages/ui/src/core/dialog.tsx`
- Modify: `packages/ui/src/core/drawer.tsx`
- Create: `packages/ui/src/core/dialog-surface.tsx`
- Create: `packages/ui/src/core/drawer-surface.tsx`
- Create: `packages/ui/src/core/modal-surface-styles.tsx`
- Create: `packages/ui/src/core/use-modal-lazy-load.tsx`
- Modify: `desktop/src/features/workbench/components/subagent-output-dialog.browser.test.tsx`
- Create: `tests/e2e/app-shell-modal-lazy.spec.ts`

**Interfaces:**

- Consumes: 用户追加的 Dialog、Drawer 均按需加载指令；现有触发器与焦点/关闭契约。
- Produces: 两个独立动态入口，关闭状态不请求浮层，首次打开后复用加载结果和原生退出生命周期。

**Behavior:**

- 轻量 Root/Trigger/Title 保持同步，重型 Portal、Popup、Viewport 与手势/焦点渲染层在首次打开时加载。受控与非受控开关均有效，SSR 继续输出语义正文。
- 生产 manifest 两个 surface 均为动态入口，首屏和工作台静态闭包不包含它们。

**Stop Conditions:**

- 动态拆分未实际形成独立闭包，或首次打开、再次打开与关闭动画回归时先修复。

- [x] **Task Status:** completed

Run: `pnpm --filter @codexly/web build && pnpm bundle:check`

Expected: 两个 surface 为独立动态入口，静态闭包不含手势/Popup 渲染层；浏览器首次/再次打开与焦点回归通过。

- Task 4 RED：生产 manifest 尚无 dialog-surface / drawer-surface 动态入口，检查命令退出 1。
- Task 4 GREEN：两个 surface 均为动态入口，未进入首屏或工作台静态依赖图。实测首屏 341.91 KiB、工作台就绪 497.41 KiB；拆分前分别为 354.21 / 509.74 KiB。
- 子代理测试改为等待首次异步加载的弹窗可见后读取真实布局；保留原有输出跟随、暂停与焦点断言。

## 最终验证记录

以下命令均从仓库根目录执行，退出码为 0；按需拆分后的代码验证完成后只更新本计划和长期规范。

- `pnpm exec vitest run apps/web packages/ui tests/web-bundle-budget.test.ts --maxWorkers=4`：258 文件、1,371 用例通过。
- `pnpm --dir desktop test:run`：166 文件、673 用例通过。
- `pnpm --dir desktop test:browser` 限定 Dialog、Drawer、全局搜索、新建项目、子代理输出、归档、附件及提示词的八个浏览器文件：Chromium/WebKit 共 70 用例通过，含首次和再次打开、左右抽屉、窄屏、实际滑动、关闭保护和焦点恢复。
- `pnpm exec playwright test` 限定新建项目、提示词、侧栏时间线及快捷键四个文件：三浏览器 23 用例通过。
- `pnpm exec playwright test tests/e2e/app-shell-modal-lazy.spec.ts --workers=2`：三浏览器 3 用例通过，验证真实生产请求首次加载与重开缓存复用。
- `pnpm test:performance`：9 文件、17 用例通过。
- `pnpm lint`、`pnpm lint:architecture`、`pnpm typecheck`、`pnpm --dir desktop lint`、`pnpm --dir desktop typecheck` 均通过；架构检查覆盖 1,929 模块、6,239 依赖。
- Web 构建、桌面标准构建与 `pnpm --dir desktop build:legacy` 通过；`pnpm bundle:check`、桌面标准产物预算及 `pnpm package:check` 通过（924 个发布文件）。
- 修改文件 Prettier、`git diff --check`、桌面 500 行限制、计划 preflight 及规范索引/链接检查通过。复用拆分前已通过的预算边界与全量后端基线，不将其冒充拆分后的全量结果；拆分前根完整套件为 3,796 通过、28 跳过。
- 未执行 Rust/原生 WebView 全量门禁及 Windows/Ubuntu 实机验证；本次无 Rust、IPC 或系统文件窗口变更。原生系统选择器继续由平台实现负责。

### Task 5: 修正未落实的弹窗视觉

**Files:**

- Modify: `packages/ui/src/core/dialog.tsx`
- Modify: `packages/ui/src/core/drawer.tsx`
- Modify: `packages/ui/src/core/modal-surface-styles.tsx`
- Modify: `packages/ui/src/agent/agent-ui.css`
- Modify: `desktop/src/shared/components/core/dialog-close.browser.test.tsx`
- Modify: `.superwork/spec/guides/code-reuse-thinking-guide.md`

**Interfaces:**

- Consumes: 用户截图与“压缩关闭按钮仍然存在”的反馈；已有共享浮层与按需加载契约。
- Produces: 标准独立方形关闭入口、长标题避让及统一 Dialog / Drawer 视觉。

**Behavior:**

- 关闭按钮从 DialogTitle 移到 Content，固定 32×32px、图标 16px；删除旧的标题等高容器，标题保留正常行高并预留关闭空间。
- Dialog 使用边框、24px 默认内边距与标准圆角；Drawer 同步关闭按钮、标题间距、边角及页脚。保留原有主题、按需加载、关闭保护和焦点恢复。

**Stop Conditions:**

- 按钮尺寸随长标题变化或出现文字重叠时继续修复；视觉未经真实渲染检查不得声称完成。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/core/dialog-close.browser.test.tsx src/shared/components/core/drawer.browser.test.tsx src/features/workbench/components/subagent-output-dialog.browser.test.tsx --maxWorkers=1`

Expected: Chromium / WebKit 共 38 用例通过，并提供与用户截图相同长命令标题的实际渲染截图。

- 根因：上一轮只迁移底层，保留 `w-[1em]`、`size="embedded"` 和标题等高规则，未落实用户要求的整体视觉。RED 实测宽度 16px，目标 32px。
- GREEN：38 浏览器用例通过；29 个相关 Web 单元用例通过；Ego 实际测量 Dialog / Drawer 均为 32×32px，图标 16px，长命令标题宽屏与移动视口截图已核对。
- 简化：删除整个标题关闭容器，关闭按钮样式由两类浮层共用；没有重复维护旧的等高实现。截图保存于 `.artifacts/modal-review/`，验收页临时使用真实共享组件及桌面全局 CSS。
- 最终验证：38 项 Chromium/WebKit 浏览器测试、29 项相关单元测试、9 项三浏览器新建项目/按需加载 E2E 全部通过；类型、两端 lint、架构、两端标准构建、桌面 Legacy 构建、Web/桌面包体门禁及修改文件格式检查通过。此次样式不涉及 Rust/IPC；未做已安装桌面二进制替换。
- Web 最终首屏 341.90 KiB、工作台就绪 497.40 KiB。截图原图与裁剪图保存于 `.artifacts/modal-review/`，临时验收服务和页面已清理。标准浏览器验证降低并发后完成，避免验收页依赖预打包与 WebKit 用例争用资源。
- 本次纠正登记：`modal-visual-fix-20261029` / `codex-modal-visual`；旧任务验证记录作为历史保留，Task 5 的视觉尺寸规则取代旧标题等高规则。
