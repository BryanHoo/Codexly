# Feature Implementation Plan

**Goal:** 将两端 Codex / Claude 设置导航统一为 ACP Agent 双栏配置。

**Suggested Spec Reads:**

- `.superwork/spec/ui/shared/index.md` — 共享 UI、按需加载、浏览器验证。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 两端复用及依赖方向。
- `.superwork/spec/frontend-core/shared/index.md` — 共享设置导航。

**Architecture:** 共享 ACP 面板组合既有认证、供应商、动态默认值组件；平台注入准备边界和字段组件。保留旧 section 类型兼容调用，导航仅展示 ACP。

**Tech Stack:** React、TypeScript、TanStack Query、项目 shadcn Item、Vitest。

## Global Constraints

- Web、移动浏览器和桌面共用组件，不新增后台轮询或未选 Agent 探测。
- 配置值与顺序使用 Agent 返回的 configOptions；认证仅使用已公布方法。
- 使用现有保存保护，密钥不进入浏览器持久存储。
- 使用 pnpm；关键边界添加中文注释。

### Task 1: 统一设置入口并实现 Agent 配置面板

**Files:**

- Create: `packages/ui/src/core/acp-settings-panel.tsx`
- Modify: `packages/frontend-core/src/settings-navigation.ts`
- Test: `packages/frontend-core/src/settings-navigation.test.ts`
- Modify: `apps/web/src/features/settings/components/global-settings-fields.tsx`
- Modify: `desktop/src/features/settings/components/global-settings-fields.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-page.tsx`
- Modify: `desktop/src/features/settings/components/global-settings-page.tsx`
- Modify: `apps/web/src/features/settings/components/settings-page-frame.tsx`
- Modify: `desktop/src/features/settings/components/settings-page-frame.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/settings.ts`
- Modify: `apps/web/src/i18n/locales/en/settings.ts`
- Modify: `desktop/src/i18n/locales/zh-CN/settings.ts`
- Modify: `desktop/src/i18n/locales/en/settings.ts`
- Test: `desktop/tests/browser/acp-settings-panel.browser.test.tsx`
- Modify: `packages/ui/src/core/settings-save-status.tsx`
- Test: `apps/web/src/features/settings/components/global-settings-page.test.tsx`
- Test: `apps/web/src/features/settings/components/settings-page-frame.test.tsx`
- Test: `desktop/tests/browser/acp-auth-settings.browser.test.tsx`
- Test: `desktop/tests/browser/acp-engine-enable.browser.test.tsx`
- Test: `tests/e2e/app-shell-acp-auth.spec.ts`
- Test: `tests/e2e/app-shell-acp-enable.spec.ts`
- Modify: `.superwork/spec/ui/shared/index.md`

**Interfaces:**

- Consumes: AcpAuthClient、AcpDefaultsClient、EngineSettingsGate、SettingsField、SettingsSelect。
- Produces: AcpSettingsPanel、ACP 设置导航入口与旧入口重定向。

**Behavior:**

- 导航不再出现 Codex / Claude 子菜单，ACP 内可搜索和选择 Agent。
- 仅挂载选中 Agent 的配置；切换遵守保存保护。
- 认证、供应商与默认模型、模式等配置收束于右栏；未启用 Agent 先准备。
- 宽屏左右双栏、窄屏上下排列，沿用项目主题与 Item 组合。

**Stop Conditions:**

- 现有接口无法表达所需配置时只呈现已支持能力，不虚构安装或账号状态。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/frontend-core/src/settings-navigation.test.ts`

Expected: ACP 统一导航测试通过；另以两端类型检查、共享 UI 测试及浏览器交互验证布局和切换。

## 实现与验证记录

- 实现：共享 ACP Agent 双栏页面；两端懒加载，旧入口保留引擎归属后重定向；移除原菜单分组及页面分支。沿用项目 Item、Input、Button 与 Agent 图标，没有新增依赖。
- 协议：认证和供应商能力沿用实际握手；默认配置保持原始 configOptions，支持分组与布尔项；运行环境信息订阅既有公开查询缓存，不额外探测进程。指令、记忆与扩展说明明确原生配置边界。
- 交互：Agent 与分类切换共用保存屏障；等待当前保存，失败保留页面；窄屏上下排列，宽屏左右分栏。
- RED：`pnpm exec vitest run packages/frontend-core/src/settings-navigation.test.ts`，因导航缺少 ACP 入口失败。
- GREEN：同一命令通过 2 项；最终共享 UI / Web 设置定向回归 `pnpm exec vitest run packages/ui/src apps/web/src/features/settings packages/frontend-core/src/settings-navigation.test.ts` 通过 27 文件、148 项。
- 浏览器：Chromium / WebKit 的认证、准备、原生配置边界与新面板 30 项通过；新增保存失败切换回归后，新面板独立回归 8 项通过。390px / 1280px 截图已目视核对，布局断言验证无横向溢出。
- E2E：生产构建后 `pnpm exec playwright test tests/e2e/app-shell-acp-auth.spec.ts tests/e2e/app-shell-acp-enable.spec.ts --workers=2`，Chromium / Firefox / WebKit 共 12 项通过。
- 构建与静态：根 `pnpm build`、`pnpm lint`、`pnpm lint:architecture`、受影响文件 Prettier 检查通过；桌面 `pnpm --dir desktop build`、`pnpm --dir desktop lint` 通过。两端 TypeScript 均由构建覆盖。
- 性能与发布：`pnpm test:performance` 16 项通过；Web bundle / package 校验通过，Web 首屏 353.05 KiB（预算 360 KiB）；桌面 performance:budget 通过，首屏 464646 字节（预算 475000）。
- 首次全量并发：根 4426 通过、2 超时、17 跳过；桌面 832 通过、2 超时。失败文件均与本次 UI 无关；降低并发独立复测分别 23 项和 51 项全部通过。随后降低并发重新运行完整两端单元测试，以复核完整结果。
- 最终简化审查：no-change；组件、传输边界与查询复用符合计划。
- 规范：更新 `.superwork/spec/ui/shared/index.md`，记录 ACP 入口、按能力展示与保存屏障的长期契约；文档格式及计划 preflight 通过。
- 范围说明：未改动 Rust、协议和后端；未运行 Windows / Ubuntu 原生应用及无关的完整浏览器套件。

## 最终全量复核

- 根目录：`pnpm exec vitest run --passWithNoTests --maxWorkers=4`，退出码 0，790 文件通过、8 文件按既有配置跳过；4428 项通过、17 项跳过，耗时 159.99 秒。
- 桌面：`pnpm --dir desktop exec vitest run --maxWorkers=2`，退出码 0，183 文件、834 项全部通过，耗时 29.64 秒。
- 以上命令均在当前工作区根目录执行，依赖未变更；首次并发超时在完整复核中消失。所有产品代码验证之后仅补充测试及本计划、规范文档，定向测试与新增保存失败回归已再次通过。
- 最终产品代码对应的根 / 桌面构建、lint、依赖边界、包体预算与三浏览器 E2E 证据复用本次执行结果。未改动原生代码，故不运行 Rust 套件；浏览器验证限定受影响的 ACP 设置流程，无关全量 E2E / 浏览器套件未运行。
