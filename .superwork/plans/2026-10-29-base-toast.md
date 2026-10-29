# Feature Implementation Plan

**Goal:** 使用 shadcn Base UI Toast 完整替换双端旧提示渲染与生命周期。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 工程验证与中文注释。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 双端共享与主题边界。
- `.superwork/spec/ui/shared/index.md` — 共享 UI 和浏览器验证。
- `.superwork/spec/frontend-core/shared/index.md` — 移除旧通知实现。
- `.superwork/spec/desktop/frontend/index.md` — Chromium / WebKit 与 Legacy。
- `.superwork/spec/web/frontend/index.md` — 移动浏览器与 Web 构建。

**Architecture:** 复用现有 @base-ui/react/toast 依赖，单个全局 manager 配合 Provider、Portal、Viewport 和 Root。采用官方底部堆叠、展开、滑动和动画，保留业务语义调用作为 manager 的薄封装，移除旧 store 和 CSS。

**Tech Stack:** React、TypeScript、Base UI、CSS、pnpm、Vitest Browser、Playwright。

## Global Constraints

- Web（含移动浏览器）和桌面共用 packages/ui；不新增轮询、逐帧 React 状态或平台通信。
- 关键边界使用中文注释；中文文案继续由宿主注入；支持安全区域和减少动态效果。
- 不修改其他任务的业务实现；旧提交测试中顶部居中断言需随用户要求变更为官方底部布局。
- parallelTask: base-toast-20261029 / codex-toast-20261029。
- 官方参考：https://ui.shadcn.com/docs/components/base/toast 、https://base-ui.com/react/components/toast 。

### Task 1: 替换通知组件与验证交互

**Files:**

- Modify: `packages/ui/src/core/notifications.tsx`
- Modify: `packages/ui/src/core/toaster.tsx`
- Modify: `packages/ui/src/core/toaster.css`
- Delete: `packages/frontend-core/src/toast-store.ts`
- Delete: `packages/frontend-core/src/toast-store.test.ts`
- Modify: `desktop/src/features/notifications/toaster.browser.test.tsx`
- Modify: `desktop/vitest.browser.config.ts`
- Modify: `desktop/src/features/settings/components/tray-settings-field.browser.test.tsx`
- Modify: `desktop/src/features/settings/components/temporary-workspace-settings-field.browser.test.tsx`
- Modify: `desktop/src/features/settings/components/history-compression.browser.test.tsx`
- Modify: `desktop/src/features/settings/components/personalization-settings-panel.browser.test.tsx`
- Modify: `desktop/src/features/settings/components/global-settings-page.browser.test.tsx`
- Modify: `desktop/src/features/settings/components/claude-settings-panel.browser.test.tsx`
- Modify: `desktop/src/features/scheduled-tasks/scheduled-tasks.browser.test.tsx`
- Modify: `desktop/src/features/scheduled-tasks/scheduled-task-run.browser.test.tsx`

**Interfaces:**

- Consumes: 原有 toast.success/error/warning/info/dismiss 与双端 Toaster 翻译参数。
- Produces: Base UI manager add/update/close/promise 与原语管理的通知堆叠、焦点及计时。

**Behavior:**

- 底部堆叠、窄屏不溢出、悬停展开、关闭、同 ID 更新与操作按钮保留。
- 设置编辑失焦反馈、自动关闭和失败重试持续工作。

**Stop Conditions:**

- Base UI 已安装版本缺少所需生命周期或宿主翻译契约。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop exec vitest run --config vitest.browser.config.ts src/features/notifications/toaster.browser.test.tsx`

Expected: Chromium 和 WebKit 共享通知交互测试通过。

### Task 2: 验证 Web 集成与两端构建

**Files:**

- Create: `tests/e2e/app-shell-toast.spec.ts`
- Modify: `tests/e2e/app-shell-composer-commit.spec.ts`（仅 Toast 布局断言）
- Modify: `tests/e2e/app-shell-skeleton.spec.ts`（验证时修正数字插值 lint，不改变行为）
- Modify: `.superwork/spec/guides/code-reuse-thinking-guide.md`
- Modify: `.superwork/plans/2026-10-29-base-toast.md`

**Interfaces:**

- Consumes: Web provider 的单个 Toaster、真实操作通知与共享 CSS。
- Produces: 两端类型、布局、依赖边界和构建证据。

**Behavior:**

- Web 和桌面消费同一个 Base UI Toast，旧顶部 message 样式和自制 store 无引用。

**Stop Conditions:**

- 构建或回归发现与当前范围无关且不能安全修复的问题，记录真实证据。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-toast.spec.ts`

Expected: Web 三浏览器布局测试通过，两端类型检查和构建成功。

## 验证与交接

执行环境为 macOS、本地工作区；所有命令从仓库根目录运行，依赖与锁文件未变更。

- RED：`pnpm --dir desktop exec vitest run --config vitest.browser.config.ts src/features/notifications/toaster.browser.test.tsx`，旧组件缺少原生 Toast 的 data-slot，两个浏览器均观察到预期缺失。
- GREEN：同命令最终 Chromium / WebKit 共 8 项通过，覆盖底部堆叠、展开、320px、长文、同 ID 更新、关闭、设置保存及重试。最后一次执行在最终组件编辑之后。
- 扩展桌面浏览器回归：同命令增加本计划列出的设置与定时任务测试，共 18 个浏览器测试文件、94 项通过。后续仅给正文增加官方 swipe-ignore 属性，最终重新验证通知测试，并在 Web 中以真实触摸事件验证该属性。
- `pnpm --dir desktop test:run`：166 文件、673 项通过。
- `pnpm exec vitest run packages/ui/src packages/frontend-core/src apps/web/src/features/notifications apps/web/src/features/search/open-search-file.test.ts apps/web/src/features/workbench/open-project-path.test.ts`：79 文件、514 项通过，最终组件编辑后重新执行。
- `pnpm exec playwright test tests/e2e/app-shell-toast.spec.ts tests/e2e/app-shell-composer-commit.spec.ts tests/e2e/app-shell-skeleton.spec.ts --workers=3`：Toast 7 项、提交工作流 4 项与骨架 Chromium / WebKit 4 项通过；并行 Firefox 骨架初始化有两处 5 秒等待超时，停留在项目加载阶段。`pnpm exec playwright test tests/e2e/app-shell-skeleton.spec.ts --project=firefox --workers=1` 隔离复查两项通过，没有修改其行为或放宽断言。
- Web 回归覆盖 Chromium / Firefox / WebKit、明暗主题、减少动态效果、F6 / Tab 关闭及焦点恢复；Chromium CDP 触摸事件验证长文滚动不会关闭通知，图标区域向右滑动关闭。
- `pnpm typecheck`、`pnpm --dir desktop typecheck`、`pnpm lint`、`pnpm --dir desktop lint`、`pnpm lint:architecture`、`pnpm --dir desktop source:lines`、改动文件 Prettier 检查与 `git diff --check` 通过。根 lint 首轮指出既有 skeleton 用例数字模板插值，改为显式 String 后通过。
- `pnpm --filter @codexly/web build`、`pnpm --dir desktop build`、`pnpm --dir desktop build:legacy`：最终组件编辑后构建成功。
- `pnpm bundle:check`：首屏 350.62 / 360 KiB、工作台就绪 506.01 / 520 KiB，通过现有预算。`pnpm --dir desktop performance:budget`：现代桌面场景预算通过，未扩大预算。
- `pnpm test:performance`：9 文件、17 项通过；计时规则与流式逻辑未修改，此证据可复用。
- `pnpm --dir desktop test:legacy`：9 项通过。

Simplification: no-change。共享 manager 加薄语义入口已移除旧 store、订阅、计时和旧 CSS，无需额外抽象。

Spec: update。更新已有代码复用指南的共享 Toast 契约、手势、自然高度测量与测试定位规则；指南已由全局索引链接。分类器因测试配置建议创建 desktop/shared，但没有新增该层契约，故不创建多余规范。

复用证据：同一次执行中未受最终 Toast 局部编辑影响的依赖边界与性能套件保留；组件、类型、构建、Toast 浏览器与共享回归均在最终实现后验证。未执行 Rust、原生安装、完整后端测试或全部浏览器套件，因为本次未修改原生、服务端、协议或依赖，仅调整共享通知与对应回归。

共享影响：两端现有 Provider 无需改动，统一消费 Base UI Toast；旧 data-toast 标记仅用于宿主浮层主题及既有业务测试定位，旧 app-toast/app-toaster 类与自制 toast-store 均已删除。旧提交测试仅迁移 Toast 相关布局和悬停断言，未修改其他任务的业务实现。

## 后续修正：明暗主题的通知层次

用户反馈浅色和深色均难以区分背景。本次仅修改共享 toaster.css；登记为 toast-surface-20261029 / codex-toast-surface。

浏览器实测官方 shadow-lg 的两层阴影确为 10px/15px/-3px 与 4px/6px/-4px、均 10% 黑色，之前实现的阴影几何一致；视觉差异来自项目弱边框、深色同色背景及纯色工作台上的投影强度。修复保留官方两层几何，提高浅色透明度至 18%/16%、深色至 48%/32%；边框使用浅色 #dedede、深色 14% 白色，普通深色卡片底色 #262626，相对工作台 #181818 更易区分。有背景图时继续继承原浮层材质。

视觉 RED：真实 Web CSS 下浅色卡片与背景均为 #fff、边框 6%；深色卡片与背景均为 #181818、边框 7%，两端阴影均固定 10%。Ego Browser 截图与 computed style 确认复现。

视觉 GREEN：同一页面热更新后验证浅色边框为 rgb(222,222,222)、阴影 0.18/0.16；深色卡片 rgb(38,38,38)、阴影 0.48/0.32、边框 0.14，已检查前后截图。

最终验证（CSS 编辑之后）：

- `pnpm --filter @codexly/web build` 成功。
- `pnpm exec playwright test tests/e2e/app-shell-toast.spec.ts --workers=2`：三浏览器共 7 项通过，包括触控、明暗主题及焦点恢复。
- `pnpm --dir desktop exec vitest run --config vitest.browser.config.ts src/features/notifications/toaster.browser.test.tsx`：Chromium / WebKit 共 8 项通过。
- `pnpm --dir desktop test:legacy`：9 项通过。
- `pnpm --dir desktop build:legacy` 成功，验证新增 light-dark 样式可下转换。
- 共享 CSS 的 Prettier 检查与 `git diff --check` 通过。

Simplification: no-change；仅调整绘制参数，没有新增状态、组件、依赖或测试逻辑。Spec: no-update；本次只调整视觉参数，架构、交互与共享契约未变，修正证据保存在本计划。
