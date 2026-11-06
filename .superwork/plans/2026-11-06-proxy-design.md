# Feature Implementation Plan

**Goal:** 将代理重设计为应用分组下独立网络设置，并复用项目设置布局和控件。

**Suggested Spec Reads:**

- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 共享组件与平台注入
- `.superwork/spec/ui/shared/index.md` — 设置与交互

**Architecture:** 新增共享 network 分类、两端按需面板；既有 SettingsGroup/Field/Select 由平台注入，共享 Input/Checkbox/Button。沿用字体、表面、分隔线令牌。

**Tech Stack:** React、TypeScript、Vitest、Vite。

## Global Constraints

- 两端同步、窄屏可用、无新增后端请求及轮询，保留密码不回传语义。
- 参考 JetBrains HTTP Proxy 与 Visual Studio Proxy Configuration 的独立应用设置与按需配置，采用本项目视觉语言。

### Task 1: 网络设置重设计

**Files:**

- Modify: `packages/ui/src/core/network-proxy-settings.tsx`
- Modify: `packages/frontend-core/src/settings-navigation.ts`
- Modify: 两端 settings 组件、lazy loader、中英文导航文案
- Test: `packages/frontend-core/src/settings-navigation.test.ts`
- Test: `desktop/tests/browser/network-proxy.browser.test.tsx`

**Interfaces:**

- Consumes: SettingsGroup、SettingsField、SettingsSelect、Input、Checkbox、Button
- Produces: network 分类与独立网络页面

**Behavior:**

- 常规无代理块；应用分组中提供可搜索的网络入口，自定义时展开配置；公共控件与既有设置一致，明确保存/测试忙碌反馈。

**Stop Conditions:**

- 平台设置传输不兼容时修订计划。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop exec vitest run --config vitest.browser.config.ts tests/browser/network-proxy.browser.test.tsx`

Expected: Chromium/WebKit 交互、明暗与窄屏通过。

## 验证与交接

- RED：共享导航测试因应用分组不含 network 明确失败；新增入口与搜索后通过。
- GREEN：设置相关单测 57 项、两端真实设置框架及共享表单 Chromium/WebKit 22 项通过；覆盖应用分类、搜索、系统/自定义/直连切换、公共控件标记、明暗主题及390/1280px。
- 两端类型、lint、根 architecture、格式检查通过。桌面 check:web 前半部分697单测及约束检查通过；现代构建、性能预算、Legacy 构建分别重新验证。原有预算不提高，按需加载网络面板；精简冗余搜索元数据与无必要样式，保留既有特殊字段布局。
- Web 生产构建和 bundle 检查通过；新增分类仍在设置按需加载边界内。
- Ego Lite 使用实际 SettingsPageFrame/公共控件、模拟传输查看完整页面；明暗截图在 .local/proxy-redesign-light.png、.local/proxy-redesign-dark.png；390px正文与视口同宽，截图 .local/proxy-redesign-mobile.png。
- Simplification: changed。用宿主注入的 SettingsGroup/Field/Select 及共享 Input/Checkbox/LoadingSkeleton 替代独立表单外观；两端只保留传输与文案选择。
- 参考：https://www.jetbrains.com/help/idea/settings-http-proxy.html 、https://learn.microsoft.com/en-us/visualstudio/ide/reference/proxy-settings?view=visualstudio 。采用独立应用设置与渐进展开方式，视觉沿用项目。
- 规范更新：.superwork/spec/guides/network-proxy.md；使用说明入口改为“应用 → 网络”。
- 本次只修改设置前端，不改代理传输后端；未重复原生后端及全量 E2E。
