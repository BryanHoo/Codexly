# Feature Implementation Plan

**Goal:** 将左栏设置入口改为全局默认设置弹窗，并让未显式配置的 Project/Task 按全局默认值运行且不覆盖已有局部设置。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束验证命令和跨包边界
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束设置持久化、模型校验和 Task 启动行为
- `.superwork/spec/frontend/component-guidelines.md` — 约束工作台弹窗、AI Elements 和可访问性
- `.superwork/spec/frontend/state-management.md` — 约束 Query、Mutation 与设置优先级
- `.superwork/spec/frontend/type-safety.md` — 约束 Protocol 类型与 Client 边界校验
- `docs/web-design.md` — 约束工作台视觉、路由和设置控件

**Architecture:** 在 Protocol 定义完整的 `AgentGlobalSettings`，通过 Client 和 Server 的 `/v1/settings` 原子读写接口持久化到 SQLite 单例记录；Server 动态解析 `Task > Project > Global`，且读取不再写入推导值。Web 在工作台内通过原生 `dialog` 展示设置，选择控件复用 AI Elements `PromptInputSelect`，Project 打开菜单仅在没有本地 Project 偏好时使用全局默认应用。

**Tech Stack:** TypeScript、React 19、TanStack Query、Fastify、TypeBox、SQLite Worker、AI Elements、Vitest、Playwright

## Global Constraints

- 所有外部设置数据必须通过 `@codexly/protocol` 严格 Schema 校验。
- 全局设置只作为回退，不得更新已有 `project_defaults` 或 `task_settings` 记录。
- 设置 Mutation 必须提交完整对象、串行执行并使用 Idempotency Key。
- 弹窗必须保持原工作台路由，支持 Escape、backdrop、焦点圈定和窄屏滚动。
- 不保留旧 `/settings` 页面逻辑。

### Task 1: 添加全局设置契约与持久化优先级

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/core/src/project.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `packages/server/src/sqlite-state-repository.ts`
- Modify: `packages/server/src/sqlite-state-repository.test.ts`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `AgentModelPage`
- Consumes: `AgentProjectDefaults`
- Consumes: `AgentTaskSettings`
- Consumes: `ProjectOpenAppId`
- Produces: `AgentGlobalSettings`
- Produces: `AgentGlobalSettingsResponse`
- Produces: `GET /v1/settings`
- Produces: `PUT /v1/settings`
- Produces: `AgentSettingsRepository.readGlobalSettings`
- Produces: `AgentSettingsRepository.writeGlobalSettings`

**Behavior:**

- 严格校验并持久化审批、工作区、模型、思考量和默认打开应用；读取 Project/Task 时按显式局部设置优先解析，读取推导值不产生隐式局部记录，新 Task 创建时固化当时的有效设置。

**Stop Conditions:**

- 如果模型目录无法提供默认模型，停止并明确返回 Runtime 配置错误。
- 如果迁移无法在现有 SQLite 版本上无损添加单例表，停止并报告迁移冲突。

- [x] **Task Status:** completed

Run: `pnpm vitest run packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts packages/server/src/sqlite-state-repository.test.ts packages/server/src/app.test.ts`

Expected: 全局设置 Schema、Client、SQLite 和 Server 优先级测试全部通过。

### Task 2: 实现工作台全局设置弹窗

**Files:**

- Create: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Create: `apps/web/src/features/settings/components/global-settings-dialog.test.tsx`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.test.tsx`
- Modify: `apps/web/src/features/workbench/project-open-preferences.ts`
- Modify: `apps/web/src/features/workbench/project-open-preferences.test.ts`
- Modify: `apps/web/src/app/router.tsx`
- Delete: `apps/web/src/app/routes/settings-route.tsx`

**Interfaces:**

- Consumes: `AgentGlobalSettings`
- Consumes: `AgentModel[]`
- Consumes: `ProjectOpenApp[]`
- Consumes: `PromptInputSelect`
- Consumes: `CodexlyClient`
- Produces: `GlobalSettingsDialog`
- Produces: `globalSettingsQueryOptions`
- Produces: `globalSettingsMutationOptions`
- Produces: `ProjectSidebar.onOpenSettings`
- Produces: `GlobalOpenAppFallback`

**Behavior:**

- 点击左栏设置按钮在当前工作台上打开可访问弹窗；用户可编辑五类全局默认并原子保存，模型切换会校准思考量；关闭或失败不会改写服务器值；Project 本地打开偏好优先于全局默认。

**Stop Conditions:**

- 如果当前 Runtime 无法读取模型目录或打开能力，弹窗必须显示可重试错误而不能提交无效值。
- 如果 AI Elements 现有选择控件无法满足原生表单与可访问名称，停止并在共享组件内做最小适配后继续。

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/features/settings/components/global-settings-dialog.test.tsx apps/web/src/features/workbench/components/project-sidebar.test.tsx apps/web/src/features/workbench/components/project-open-menu.test.tsx apps/web/src/features/workbench/project-open-preferences.test.ts`

Expected: 弹窗交互、设置提交、路由保持和打开应用优先级测试全部通过。

### Task 3: 更新规范并验证完整用户流程

**Files:**

- Modify: `docs/web-design.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `GlobalSettingsDialog`
- Consumes: `GET /v1/settings`
- Consumes: `PUT /v1/settings`
- Consumes: `ProjectSidebar.onOpenSettings`
- Produces: `GlobalSettingsSpecification`
- Produces: `GlobalSettingsPlaywrightEvidence`

**Behavior:**

- 文档明确设置弹窗和 `Task > Project > Global` 优先级；E2E 验证点击设置不改变 URL、可保存并恢复全局默认、已有 Task 设置保持不变，且桌面和窄屏弹窗无溢出。

**Stop Conditions:**

- 如果 E2E Fixture 无法表达局部设置与全局设置并存，先扩展 Fixture，不能弱化断言。
- 如果视觉检查发现文本溢出、焦点泄漏或控制重叠，修复后再完成任务。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全量门禁和浏览器关键流程通过，设置弹窗在桌面与窄屏均可操作且无控制台错误。
