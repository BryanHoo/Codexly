# Feature Implementation Plan

**Goal:** 让用户在设置“关于”中查看 Codexly 与 Codex 版本、发现并安装新版 Codexly，并在工作台左栏感知更新状态。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束发布包、验证命令与文档同步。
- `.superwork/spec/backend/directory-structure.md` — 约束 CLI、Server 路由与依赖归属。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex 进程版本和 Server 生命周期。
- `.superwork/spec/backend/quality-guidelines.md` — 约束外部进程、Schema、错误与测试。
- `.superwork/spec/frontend/component-guidelines.md` — 约束设置弹窗、左栏、i18n 与交互。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Vitest 与 Playwright 用户流程。
- `.superwork/spec/frontend/type-safety.md` — 约束 Web 仅消费 Protocol 契约。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Client、Server 与 Web 依赖方向。
- `.superwork/spec/shared/quality-guidelines.md` — 约束严格 Schema、Client 校验与消费者同步。

**Architecture:** 在 Protocol 定义应用信息和更新契约；CLI 注入当前 Codexly/Codex 版本及 npm 更新服务；Server 暴露只读信息与幂等更新端点；Client 和 React Query 统一读取；设置新增“关于”模块，左栏版本状态复用同一 Query，并直接打开“关于”。更新仅安装已由 registry `latest` 标签返回且通过严格 SemVer 校验的版本，使用参数数组和 `shell: false`，完成后明确要求重启当前进程。

**Tech Stack:** TypeScript、Fastify、TypeBox、React、TanStack Query、Vitest、Playwright、pnpm。

## Global Constraints

- 所有网络响应使用 `@codexly/protocol` 严格 Schema，Web 不重复声明协议类型。
- npm registry 请求和更新子进程必须有超时，不记录响应正文或用户环境 Secret。
- 更新命令固定使用参数数组执行 `npm install --global @bryanhu/codexly@<validated-version>`，不得经过 shell。
- 设置和左栏文案同时提供 `zh-CN` 与 `en` 资源，动态版本号保持原样。
- 不启动开发服务器；最终运行 `pnpm check` 和相关 `pnpm test:e2e`。

### Task 1: 建立应用信息与更新后端契约

**Files:**

- Create: `packages/protocol/src/app-update.ts`
- Create: `src/app-update.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/agent-actions.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/runtime-routes.ts`
- Modify: `packages/server/src/server-runtime.ts`
- Modify: `src/cli-command.ts`
- Modify: `src/cli-command.test.ts`
- Test: `packages/protocol/src/app-update.test.ts`
- Test: `packages/server/src/app.test.ts`
- Test: `src/app-update.test.ts`
- Test: `tests/realtime-path.test.ts`

**Interfaces:**

- Consumes: `packageManifest.version`、`CodexAppServerProcess.version`、npm registry `dist-tags.latest`
- Produces: `AppInfoResponse`、`InstallAppUpdateRequest`、`GET /v1/app-info`、`POST /v1/app-update`

**Behavior:**

- 返回当前 Codexly/Codex 版本、最新版本、检查状态与是否可更新；只安装经过验证且确实高于当前版本的 `latest` 版本，安装成功返回需要重启状态，检查或安装失败映射为稳定错误。

**Stop Conditions:**

- 如果当前运行时无法提供 Codex 版本，或 Server 无法通过依赖注入隔离 npm 网络与子进程副作用，则停止并重新划分接口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/app-update.test.ts src/app-update.test.ts packages/server/src/app.test.ts`

Expected: 应用信息 Schema、版本比较、registry 检查、受控安装和 Fastify 路由测试全部通过。

### Task 2: 接入 Client、Query 与设置“关于”模块

**Files:**

- Modify: `packages/client/src/http-client-transport.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/web/src/features/projects/project-query-options.ts`
- Modify: `apps/web/src/features/settings/components/global-settings-fields.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Create: `apps/web/src/features/settings/components/global-settings-about.tsx`
- Create: `apps/web/src/features/settings/components/global-settings-access.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-dialogs.tsx`
- Modify: `apps/web/src/app/routes/index-route.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/settings.ts`
- Modify: `apps/web/src/i18n/locales/en/settings.ts`

**Interfaces:**

- Consumes: `AppInfoResponse`、`InstallAppUpdateResponse`、`CodexlyClient.getAppInfo()`、`CodexlyClient.installAppUpdate()`
- Produces: `appInfoQueryOptions`、`appUpdateMutationOptions`、`SettingsSectionId = "about"`、可观察的版本与更新交互

**Behavior:**

- 设置新增“关于”模块，独立展示 Codexly 与 Codex 版本；发现新版时显示目标版本和更新按钮，执行中单飞，成功提示重启，失败可重试且不阻断其他设置内容。

**Stop Conditions:**

- 如果更新状态会被全局设置加载错误遮蔽，或“关于”页必须保存无关设置才能执行更新，则停止并拆分 Query/表单状态。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/client/src/http-client.test.ts apps/web/src/features/settings/components/global-settings-dialog.test.tsx`

Expected: Client 严格校验响应，“关于”模块在最新、可更新、执行中、成功和失败状态下均通过组件测试。

### Task 3: 在左栏展示版本更新状态并覆盖完整流程

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-sidebar-actions.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/app/routes/index-route.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `tests/e2e/app-shell-settings-navigation.spec.ts`
- Modify: `tests/e2e/lan-access.spec.ts`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `docs/architecture-design.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: `AppInfoResponse.updateAvailable`、`AppInfoResponse.appVersion`、`onOpenSettings("about")`
- Produces: 左栏版本/连接组合状态、直达设置“关于”的交互、端到端更新流程证据

**Behavior:**

- 左栏连接状态旁显示当前 Codexly 版本；有更新时使用区别明确的状态，点击设置行直接打开“关于”；E2E 覆盖版本展示、更新发现、更新请求和成功后重启提示。

**Stop Conditions:**

- 如果 `320px` 视口下版本和连接状态无法在稳定布局中完整表达，停止并调整为不改变现有侧栏宽度约束的紧凑布局。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-settings-navigation.spec.ts`

Expected: 工作台左栏和设置“关于”完整用户流程通过，并且现有设置导航流程无回归。
