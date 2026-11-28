# 移除扩展中心

**Goal:** 移除 Web、移动浏览器和桌面扩展中心以及专用管理代码。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` 提供统一验证规则。
- `.superwork/spec/ui/shared/index.md` 记录共享侧栏导航。
- `.superwork/spec/web/frontend/index.md` 和 `.superwork/spec/desktop/frontend/index.md` 约束双端组合。
- `.superwork/spec/server/backend/index.md` 和 `.superwork/spec/client/shared/index.md` 约束 HTTP 边界。

**Architecture:** 拆除专用路由、管理界面与管理业务边界，沿用工作台通用路由和会话级 ACP 接口。

**Tech Stack:** React、TanStack Router、Fastify、Tauri、Vitest、Playwright。

## Global Constraints

- 同时考虑 Web、移动浏览器和桌面。
- 双端共用的定时任务导航行为由 UI 包实现。
- 保留通过 ACP 提供的会话能力与用户本地配置。

### Task 1: 移除双端页面和导航

**Files:**

- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/routes/skills-market-route.test.ts`
- Delete: `apps/web/src/app/routes/skills-market-route.tsx`
- Modify: `apps/web/src/app/routes/workbench-route.test.tsx`
- Modify: `apps/web/src/app/routes/workbench-route.tsx`
- Delete: `apps/web/src/features/skills-market/skills-market-container.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/sidebar-scheduled-tasks-link.tsx`
- Delete: `apps/web/src/features/workbench/components/sidebar-skills-market-link.tsx`
- Delete: `apps/web/src/features/workbench/components/skills-market-view.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-header.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-header.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Delete: `apps/web/src/i18n/locales/en/skills-market.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Delete: `apps/web/src/i18n/locales/zh-CN/skills-market.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Delete: `apps/web/src/shared/styles/official-plugins.css`
- Delete: `apps/web/src/shared/styles/skills-market.css`
- Modify: `desktop/src/app/router.tsx`
- Delete: `desktop/src/app/routes/extensions-route.tsx`
- Modify: `desktop/src/app/routes/skills-market-route.test.ts`
- Modify: `desktop/src/app/routes/workbench-route.tsx`
- Delete: `desktop/src/features/skills-market/skills-market-container.tsx`
- Modify: `desktop/src/features/workbench/components/project-sidebar-navigation-order.test.ts`
- Modify: `desktop/src/features/workbench/components/project-sidebar.tsx`
- Delete: `desktop/src/features/workbench/components/sidebar-extension-center-link.tsx`
- Modify: `desktop/src/features/workbench/components/sidebar-footer.browser.test.tsx`
- Modify: `desktop/src/features/workbench/components/sidebar-scheduled-tasks-link.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-shell.tsx`
- Delete: `desktop/src/i18n/locales/en/skills-market.ts`
- Modify: `desktop/src/i18n/locales/en/workbench.ts`
- Delete: `desktop/src/i18n/locales/zh-CN/skills-market.ts`
- Modify: `desktop/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `desktop/src/shared/components/core/workbench-panel-order.browser.test.tsx`
- Modify: `desktop/src/shared/components/core/workbench-panel-order.fixture.tsx`
- Delete: `desktop/src/shared/styles/skills-market.css`
- Modify: `desktop/tests/browser/acp-managed-settings.browser.test.tsx`
- Modify: `desktop/tests/browser/chat-quick-open.browser.test.tsx`
- Modify: `desktop/tests/browser/sidebar-page-toggle.browser.test.tsx`
- Modify: `packages/ui/package.json`
- Delete: `packages/ui/src/core/acp-extension-notice.tsx`
- Delete: `packages/ui/src/core/claude-extensions-pane.tsx`
- Delete: `packages/ui/src/core/codex-official-plugins-pane.tsx`
- Delete: `packages/ui/src/core/codex-resources-pane.tsx`
- Delete: `packages/ui/src/core/extension-catalog.tsx`
- Delete: `packages/ui/src/core/extension-center-types.ts`
- Delete: `packages/ui/src/core/extension-center.css`
- Delete: `packages/ui/src/core/extension-list.tsx`
- Delete: `packages/ui/src/core/extension-operation.tsx`
- Delete: `packages/ui/src/core/extension-project-scope.tsx`
- Modify: `packages/ui/src/core/sidebar-page-toggle.tsx`
- Modify: `tests/e2e/app-shell-inspector-sidebar.spec.ts`
- Modify: `tests/e2e/app-shell-skills-market.spec.ts`
- Delete: `tests/extension-tooltip-contract.test.ts`

**Interfaces:**

- Consumes: 工作台路由和共享侧栏
- Produces: 旧链接沿用工作区回退，定时任务返回原位置

**Behavior:**

- 旧链接沿用工作区回退，定时任务返回原位置。

**Stop Conditions:**

- 现有的独立工作流受影响时，核对其调用链后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-skills-market.spec.ts`

Expected: 旧链接沿用工作区回退，定时任务返回原位置。

### Task 2: 移除专用传输与服务

**Files:**

- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `desktop/src-tauri/permissions/window-command-sets.toml`
- Modify: `desktop/src-tauri/src/application/acp_host.rs`
- Modify: `desktop/src/features/projects/project-query-contracts.ts`
- Modify: `desktop/src/platform/tauri/acp-global-boundary-client.test.ts`
- Modify: `desktop/src/platform/tauri/catalog-client.ts`
- Modify: `desktop/src/platform/tauri/global-command-boundary.ts`
- Modify: `desktop/src/platform/tauri/runtime-client.test.ts`
- Modify: `desktop/src/platform/tauri/runtime-client.ts`
- Delete: `desktop/src/platform/tauri/skills-market-client.test.ts`
- Modify: `desktop/src/protocol/index.ts`
- Delete: `desktop/src/protocol/skill-market.ts`
- Delete: `packages/client/src/http-client-claude-extensions.test.ts`
- Modify: `packages/client/src/http-client-engines.ts`
- Delete: `packages/client/src/http-client-plugin-reconcile.test.ts`
- Delete: `packages/client/src/http-client-skill-market.test.ts`
- Delete: `packages/client/src/http-client-skill-market.ts`
- Modify: `packages/client/src/http-client-task-worktrees.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Delete: `packages/frontend-core/src/claude-extension-cache.test.ts`
- Delete: `packages/frontend-core/src/claude-extension-cache.ts`
- Delete: `packages/frontend-core/src/plugin-reconcile.test.ts`
- Delete: `packages/frontend-core/src/plugin-reconcile.ts`
- Delete: `packages/protocol/src/claude-extensions.ts`
- Delete: `packages/protocol/src/plugin-reconcile.ts`
- Delete: `packages/protocol/src/skill-market.ts`
- Modify: `packages/provider-acp/src/application-runtime.ts`
- Modify: `packages/server/src/app-engines.test.ts`
- Modify: `packages/server/src/app-options.test-support.ts`
- Delete: `packages/server/src/app-plugin-reconcile.test.ts`
- Modify: `packages/server/src/app-skill-market.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/engine-routes.ts`
- Delete: `packages/server/src/routes/skill-market-routes.ts`
- Modify: `packages/server/src/server-options.ts`
- Delete: `packages/server/src/skill-market-service.test.ts`
- Delete: `packages/server/src/skill-market-service.ts`
- Modify: `src/cli-command.test-support.ts`

**Interfaces:**

- Consumes: Web HTTP、桌面 IPC 和共享 ACP 适配器
- Produces: 旧 HTTP 路径不再注册，会话级 ACP 接口仍可用

**Behavior:**

- 旧 HTTP 路径不再注册，会话级 ACP 接口仍可用。

**Stop Conditions:**

- 现有的独立工作流受影响时，核对其调用链后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app-skill-market.test.ts`

Expected: 旧 HTTP 路径不再注册，会话级 ACP 接口仍可用。

### Task 3: 同步使用说明和规范

**Files:**

- Modify: `.superwork/spec/ui/shared/index.md`
- Modify: `docs/usage.en.md`
- Modify: `docs/usage.md`

**Interfaces:**

- Consumes: 侧栏用法和导航契约
- Produces: 双语说明和共享规范与实际导航一致

**Behavior:**

- 双语说明和共享规范与实际导航一致。

**Stop Conditions:**

- 现有的独立工作流受影响时，核对其调用链后再继续。

- [x] **Task Status:** completed

Run: `git diff --check`

Expected: 双语说明和共享规范与实际导航一致。

## 验证记录

- 修改前，Web 路由测试命中旧扩展页面，HTTP 测试列出 12 个仍在注册的管理接口。修改后，双端路由测试和 HTTP 注销回归均通过。
- Web 浏览器检查覆盖 Chromium、Firefox 和 WebKit，验证项目和临时工作区中的旧扩展地址。侧栏浏览器测试验证定时任务入口、面板布局和浏览器历史。
- 根类型检查、Web 与 Node 构建、桌面前端构建、双端静态检查、Web 打包和双端包体预算通过。
- macOS 上的 Rust 编译检查、Rust 格式检查和 Tauri 权限约束测试通过。
- 桌面全量单测降低并发后通过 824 项。根定向复测通过 58 项，根全量以四个 worker 重跑后通过 3,689 项，跳过 24 项。
