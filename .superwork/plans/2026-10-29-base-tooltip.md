# Feature Implementation Plan

**Goal:** 按 shadcn/ui Base UI 官方文档替换共享 Tooltip，统一 Web、移动浏览器和桌面的辅助提示行为。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 验证入口和中文注释要求。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 共享组件边界。
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 触屏、WebView 和性能要求。
- `.superwork/spec/ui/shared/index.md` — 两端共享交互与按需挂载。
- `.superwork/spec/desktop/frontend/index.md` — Chromium/WebKit 交互回归。
- `.superwork/spec/web/frontend/index.md` — 移动浏览器与构建预算。

**Architecture:** 共享 UI 使用 `@base-ui/react/tooltip` 的 Provider/Root/Trigger/Portal/Positioner/Popup/Arrow；平台入口继续复用。用薄适配保留现有 asChild、delayDuration 调用，新增原生 render 组合，不逐项迁移业务组件。

**Tech Stack:** React 19、TypeScript、Tailwind CSS、Base UI、pnpm、Vitest Browser、Playwright。

## Global Constraints

- 共享 UI 不反向导入两端应用，关键逻辑使用中文注释；桌面源码与测试文件不得超过 500 行。
- 两端复用同一实现，默认悬停延迟 350ms；仅键盘可见焦点触发，鼠标点击和关闭后的焦点恢复不得产生残留提示。
- Tooltip 只提供辅助标签，保留触发控件自身的可访问名称；触屏点击不打开 Tooltip，不拦截按钮操作。
- 使用 Portal 避免裁剪，Positioner 避让视口，长文本可换行，保留提示内容可悬停能力；动效尊重减少动态效果。
- 不变更原生协议、后端、窗口配置和发布元数据；不自动提交。
- 协作记录：`tooltip-base-20261029`，owner `codex-tooltip-20261029`，只操作该记录。

### Task 1: 替换共享 Tooltip 并验证两端行为

**Files:**

- Modify: `packages/ui/src/core/tooltip.tsx`
- Modify: `packages/ui/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `desktop/vitest.browser.config.ts`
- Modify: `tools/verify-web-bundle.mjs`
- Modify: `desktop/performance-budget.json`
- Test: `desktop/src/shared/components/core/tooltip.browser.test.tsx`
- Test: `apps/web/src/shared/components/core/ui-primitives.test.tsx`
- Test: `tests/e2e/app-shell-tooltip.spec.ts`

**Interfaces:**

- Consumes: 两端现有 Tooltip/TooltipProvider/TooltipTrigger/TooltipContent 导出与 asChild、delayDuration 调用。
- Produces: Base UI 实现，支持 render、键盘与鼠标交互、禁用按钮包装、菜单焦点恢复、可悬停内容和窄屏碰撞定位。

**Behavior:**

- 两端相同浏览器测试验证键盘打开、Escape/点击关闭、鼠标恢复焦点不误开、render/asChild 保留 DOM/ref/业务事件、禁用按钮包装可提示、视口内布局与长文本。
- 先观察旧实现无法通过键盘/可悬停内容证明，再安装 Base UI 固定版本并实现。

**Stop Conditions:**

- 若发现 Base UI 无法与现有 Radix 菜单组合或发生业务事件丢失，先修订适配方案再继续。

- 用户明确要求直接提高预算：首屏 gzip 上限从 320 KiB 调至 360 KiB，维持共享 Tooltip 的单一入口。
- 桌面完整静态依赖场景的三项超额预算各增加 100,000 字节：workspace 1,780,000、markdown 2,280,000、cppHighlight 2,850,000；其他预算按实测保留。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop exec vitest run --config vitest.browser.config.ts src/shared/components/core/tooltip.browser.test.tsx`

Expected: Chromium 与 WebKit 下两端入口所有 Tooltip 回归通过。

### Task 2: 完成验证并记录长期契约

**Files:**

- Modify: `.superwork/spec/guides/code-reuse-thinking-guide.md`
- Modify: `.superwork/plans/2026-10-29-base-tooltip.md`

**Interfaces:**

- Consumes: Task 1 的共享实现和测试证据。
- Produces: 实际验证记录和共享 Tooltip 长期复用规则。

**Behavior:**

- 验证类型、静态检查、相关单元测试、两端生产构建及构建预算；按变更范围执行浏览器工作流和性能回归，不运行无关 Rust/引擎协议测试。
- 简化审查、规范校验后释放本任务协作记录。

**Stop Conditions:**

- 相关验证出现失败时不得宣称通过；保留证据并修复本任务引入的问题。

- [x] **Task Status:** completed

Run: `pnpm typecheck && pnpm lint:architecture`

Expected: 类型检查和依赖边界均通过，计划记录额外实际执行的浏览器、构建与性能检查。

## 验证记录与交接

- 官方依据：`https://ui.shadcn.com/docs/components/base/tooltip`、其 Base Nova Tooltip 注册源码与 `https://base-ui.com/react/components/tooltip`。固定安装 `@base-ui/react@1.9.0`，保留项目 pnpm catalog 与锁文件；`pnpm install --frozen-lockfile` 通过供应链策略校验。
- RED：旧组件无法通过键盘可见焦点打开和内容悬停测试，证明了原本的焦点屏蔽与不可悬停行为。测试过程中发现新依赖中途预打包导致 React 重载，已添加明确的 optimizeDeps.include。
- GREEN：`pnpm --dir desktop exec vitest run --config vitest.browser.config.ts src/shared/components/core/tooltip.browser.test.tsx`，最终共享实现两端入口在 Chromium/WebKit 共 32 项通过；`pnpm exec playwright test tests/e2e/app-shell-tooltip.spec.ts --workers=3`，Chromium/Firefox/WebKit 的明暗主题、键盘、减少动态效果与真实触屏共 9 项通过。
- 相关浏览器集成：任务看板、图片预览与弹窗关闭共 28 项通过；文档工作区、项目按钮碰撞、消息目录与排队操作原有端到端场景共 40 项通过。Base UI 的键盘焦点行为与真实触屏验证分别执行，不把键盘 Escape 恢复焦点视为持续触屏模态。
- `pnpm test`：662 个文件、3,795 项通过，6 个文件/28 项按项目原配置跳过。`pnpm --dir desktop test:run`：166 个文件、673 项通过。最终实现的定向单元测试再次运行，14 个文件、90 项通过。
- 类型、静态与结构：根 `pnpm typecheck`、桌面构建中的 `tsc -b`、根和桌面 lint、`pnpm lint:architecture`、桌面 source:lines 均通过。根 format:check 及桌面改动文件的 Prettier 校验通过。
- 性能：`pnpm test:performance`，9 个文件、17 项通过。根 Web 与桌面 Modern/Legacy 生产构建通过。Web 实测首屏 gzip 334.20/360 KiB、工作台就绪 489.59/500 KiB、最大异步组 464.06/640 KiB。
- 桌面 Modern 实测 workspace 1,726,206/1,780,000 字节、markdown 2,215,983/2,280,000 字节、cppHighlight 2,789,446/2,850,000 字节；其他原预算通过，预算分析器 2 项测试通过。已按用户明确指示提高超额预算，未保留尝试的 Provider 拆分。
- 简化审查：no-change。共享实现保留单一入口，兼容层仅覆盖现有 asChild 与延迟参数；没有增加全局自定义事件监听、轮询、逐帧 React 状态或重复业务组件。
- 规范决策：update。长期 Tooltip 复用、辅助名称、输入模态、定位与预算规则已记录到 `.superwork/spec/guides/code-reuse-thinking-guide.md`，由全局 guides/index.md 现有链接可达。
- 证据复用：全量单元、集成及性能验证后，仅进行 Provider 原样回归单入口、非执行性格式整理、说明文档及用户授权预算调整；最终共享实现已重新执行 32 项组件浏览器测试、9 项页面测试、90 项定向单元、类型、静态检查及两端构建。未变更底层协议或后端，无需重跑 Rust/引擎协议测试。
- 尚未验证：Windows/Ubuntu 的原生 WebView 实机；本次在 macOS 通过 Chromium、Firefox、WebKit 验证共享浏览器交互，未修改原生代码。
