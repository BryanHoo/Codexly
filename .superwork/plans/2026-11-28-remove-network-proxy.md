# 移除应用网络代理

**Goal:** 移除 Web 和桌面的代理管理与转发功能。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md`
- `.superwork/spec/client/shared/index.md`
- `.superwork/spec/core/shared/index.md`
- `.superwork/spec/desktop/backend/index.md`
- `.superwork/spec/desktop/frontend/index.md`
- `.superwork/spec/frontend-core/shared/index.md`
- `.superwork/spec/protocol/shared/index.md`
- `.superwork/spec/root/backend/index.md`
- `.superwork/spec/server/backend/index.md`
- `.superwork/spec/ui/shared/index.md`
- `.superwork/spec/web/frontend/index.md`

**Architecture:** 删除双端设置入口及协议，撤销启动时注入的代理和自建转发。应用持有的请求走直连，独立工具继续管理自身网络环境。

**Tech Stack:** TypeScript、Fastify、React、Tauri、Rust、Vitest、pnpm

## Global Constraints

- 两端共享设置导航与 ACP 适配器。保持有界 HTTP 请求及连接复用。
- 旧代理文件可能含凭据，运行时不读取或迁移该文件。
- 0.52.0、0.53.0 发布已有标签与提交，崩溃诊断已提交。公共文件仅改动代理相关行。

### Task 1: 移除设置、API 与启动配置

**Files:**

- Modify: `apps/web/src/features/settings/components/global-settings-fields.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-page.tsx`
- Delete: `apps/web/src/features/settings/components/network-proxy-settings.tsx`
- Modify: `apps/web/src/i18n/locales/en/settings.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/settings.ts`
- Modify: `desktop/src/features/settings/components/global-settings-fields.tsx`
- Modify: `desktop/src/features/settings/components/global-settings-page.tsx`
- Delete: `desktop/src/features/settings/components/network-proxy-settings.tsx`
- Modify: `desktop/src/features/settings/components/settings-section-loaders.ts`
- Modify: `desktop/src/i18n/locales/en/settings.ts`
- Modify: `desktop/src/i18n/locales/zh-CN/settings.ts`
- Modify: `desktop/src-tauri/build.rs`
- Modify: `desktop/src-tauri/permissions/window-command-sets.toml`
- Modify: `desktop/src-tauri/src/application/acp_host.rs`
- Modify: `desktop/src-tauri/src/application/mod.rs`
- Delete: `desktop/src-tauri/src/application/network_proxy_commands.rs`
- Modify: `desktop/src-tauri/src/application/app_update.rs`
- Modify: `desktop/src-tauri/src/application/pet_commands.rs`
- Modify: `desktop/src-tauri/src/infrastructure/bing_wallpaper.rs`
- Modify: `desktop/src-tauri/src/infrastructure/mod.rs`
- Delete: `desktop/src-tauri/src/infrastructure/network_proxy.rs`
- Modify: `desktop/src-tauri/src/infrastructure/workspace/git_process.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Delete: `desktop/tests/browser/network-proxy.browser.test.tsx`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/frontend-core/src/settings-navigation.ts`
- Test: `packages/frontend-core/src/settings-navigation.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Delete: `packages/protocol/src/network-proxy.ts`
- Delete: `packages/provider-acp/src/agent-proxy.ts`
- Delete: `packages/provider-acp/src/agent-proxy.test.ts`
- Delete: `packages/provider-acp/src/network-proxy.ts`
- Modify: `packages/server/src/app.ts`
- Delete: `packages/server/src/network-proxy-routes.ts`
- Delete: `packages/server/src/network-proxy-routes.test.ts`
- Modify: `packages/server/src/server-options.ts`
- Delete: `packages/ui/src/core/network-proxy-settings.tsx`
- Modify: `src/cli-command.ts`
- Test: `src/cli-command-start.test.ts`
- Modify: `src/cli-server-input.ts`
- Delete: `tools/acp-proxy-compiled.test.mjs`
- Modify: `tools/test-acp-host.mjs`
- Modify: `packages/provider-acp/package.json`
- Modify: `tsconfig.node.json`
- Modify: `tsup.config.ts`
- Modify: `vitest.config.ts`

**Interfaces:**

- Consumes: 设置导航、HTTP 路由、Tauri IPC、CLI 与 ACP 启动环境
- Produces: 两端应用设置没有网络项，旧代理文件对启动无影响

**Behavior:**

- 两端应用设置没有网络项，旧代理文件对启动无影响。

**Stop Conditions:**

- 相关契约无法验证时记录实际阻塞。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/frontend-core/src/settings-navigation.test.ts src/cli-command-start.test.ts`

Expected: 两端应用设置没有网络项，旧代理文件对启动无影响。

### Task 2: 启用应用 HTTP 直连并清理代理依赖

**Files:**

- Modify: `desktop/src-tauri/Cargo.toml`
- Modify: `desktop/src-tauri/Cargo.lock`
- Modify: `packages/core/package.json`
- Create: `packages/core/src/direct-fetch.ts`
- Create: `packages/core/src/direct-fetch.test.ts`
- Modify: `packages/core/src/npm-registry.ts`
- Modify: `packages/provider-acp/src/agent-installer.ts`
- Modify: `packages/provider-acp/src/agent-registry-update.ts`
- Modify: `packages/provider-acp/src/codefree-server.ts`
- Modify: `packages/server/src/bing-wallpaper.ts`
- Modify: `packages/server/src/bing-wallpaper-catalog.ts`
- Modify: `packages/server/src/workbench-pets.ts`
- Modify: `src/app-update.ts`
- Modify: `tsconfig.node.json`
- Modify: `tsup.config.ts`
- Modify: `vitest.config.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: Node、Bun、reqwest 和 Tauri 更新器的 HTTP 请求
- Produces: 应用请求使用直连，移除专用于代理功能的依赖

**Behavior:**

- 应用请求使用直连，移除专用于代理功能的依赖。

**Stop Conditions:**

- 相关契约无法验证时记录实际阻塞。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/core/src/direct-fetch.test.ts`

Expected: 应用请求使用直连，移除专用于代理功能的依赖。

### Task 3: 清理应用说明与发布文件清单

**Files:**

- Modify: `.superwork/spec/guides/index.md`
- Delete: `.superwork/spec/guides/network-proxy.md`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `desktop/README.md`
- Modify: `desktop/README.en.md`
- Modify: `docs/README.md`
- Delete: `docs/network-proxy.md`
- Modify: `docs/usage.md`
- Modify: `docs/usage.en.md`
- Modify: `package.json`
- Modify: `packages/provider-acp/README.md`

**Interfaces:**

- Consumes: 用户文档、长期规范和 npm 发布清单
- Produces: 现行说明和发布清单删除旧代理功能，保留外部组件部署说明

**Behavior:**

- 现行说明和发布清单删除旧代理功能，保留外部组件部署说明。

**Stop Conditions:**

- 相关契约无法验证时记录实际阻塞。

- [x] **Task Status:** completed

Run: `git diff --check`

Expected: 现行说明和发布清单删除旧代理功能，保留外部组件部署说明。

## 验证结果

- 旧配置损坏时，Web 启动和 CLI 诊断通过。双端共享导航回归通过。对构建产物注入请求，确认旧代理管理接口返回 404，首页返回 200。
- Node 的直连测试及 Bun 的本地模拟验证证明应用请求绕过环境代理。涉及 CLI、Server、Provider、Core 与 Web 设置的 3649 项测试通过，24 项跳过。
- 桌面单元 824 项、设置浏览器测试 24 项、Web Chromium 9 项、macOS Rust 520 项及编译后的 ACP 宿主 10 项通过。
- 根类型、Lint、架构检查、Web 与桌面前端构建、Node 构建、包体和发布清单校验均通过。改动文件通过格式校验。
- 首轮全量测试有一项 ACP 续聊断言失败，单独重跑和限定并发复验通过。全仓格式检查仍报既有的 `skills/system/run-workflow/SKILL.md`。本次验证运行于 macOS。
- 旧代理配置文件保留在用户目录中，应用启动不读取该文件。外部程序按各自网络设置运行。
