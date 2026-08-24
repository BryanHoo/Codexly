# Feature Implementation Plan

**Goal:** 为 ChatGPT 官方账号提供可持久化、可按 Turn 覆盖的 Codex 快速模式，并在其他连接模式下隐藏且阻止生效。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、验证和代码规模。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex Turn 设置、官方登录和 Provider 边界。
- `.superwork/spec/frontend/state-management.md` — 约束全局设置、查询缓存和 Composer 本地状态。
- `.superwork/spec/frontend/component-guidelines.md` — 约束设置 Dialog 与 Composer 控件职责。
- `.superwork/spec/shared/quality-guidelines.md` — 约束严格 Schema、类型与契约测试。

**Architecture:** 在统一协议中增加 `fastMode`，全局设置持久化默认值，Turn 选项只在启用时携带 `true`；Web 根据已连接的官方 ChatGPT 账号显示控件，Codex Runtime 在 Provider 边界再次校验连接身份，并将有效值映射为 `serviceTier: "fast"`，普通 Turn 显式发送 `null` 清除粘附状态。

**Tech Stack:** TypeScript、React、TanStack Query、Fastify、SQLite、Vitest、Codex App Server v2 RPC。

## Global Constraints

- 仅当连接状态为 `official + connected + account.type === "chatgpt"` 时显示并允许快速模式生效。
- 自定义 API、API Key 账号、未登录和登录中状态都不得向 Codex 发送 `serviceTier: "fast"`。
- 不启动开发服务器；生产代码文件不得超过 500 行。
- 新协议逻辑直接替换冗余旧路径，不添加兼容分支。

### Task 1: 扩展快速模式协议并映射 Codex Service Tier

**Files:**

- Modify: `packages/protocol/src/project-settings.ts`
- Test: `packages/protocol/src/project.test.ts`
- Modify: `packages/protocol/src/provider-connection.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/provider-connection.test.ts`
- Modify: `packages/provider-codex/src/agent-provider-turns.ts`
- Modify: `packages/provider-codex/src/runtime-provider.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `AgentProviderConnectionStatus`、Codex `turn/start` 与 `thread/settings/update`
- Produces: `AgentGlobalSettings.fastMode`、`AgentTurnOptions.fastMode?: true`、Codex `serviceTier`

**Behavior:**

- 严格校验快速模式协议，并仅为已连接的官方 ChatGPT 账号把 `fastMode: true` 映射为 `serviceTier: "fast"`；普通 Turn 显式发送 `serviceTier: null`。

**Stop Conditions:**

- Codex 锁定 Schema 不包含 `serviceTier`，或 Runtime 无法在 Turn 边界读取官方账号状态时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/protocol/src/provider-connection.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: 快速模式 Schema、官方账号映射和非官方降级测试通过。

### Task 2: 持久化全局快速模式默认值

**Files:**

- Modify: `packages/server/src/sqlite-state-repository.ts`
- Create: `packages/server/src/global-settings-persistence.ts`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/sqlite-state-repository.test.ts`
- Test: `packages/server/src/app.test.ts`
- Test: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `AgentGlobalSettings.fastMode`
- Produces: SQLite migration v12、完整 `GET/PUT /v1/settings` 响应

**Behavior:**

- 新安装和升级数据库都以 `false` 为缺省值保存并恢复 `fastMode`，Server 未持久化时返回同一默认值。

**Stop Conditions:**

- 现有迁移版本不是 11，或全局设置写入无法保持原子性时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/sqlite-state-repository.test.ts packages/server/src/app.test.ts packages/client/src/http-client.test.ts`

Expected: SQLite 往返、默认设置和 HTTP 严格响应测试通过。

### Task 3: 在全局设置与 Composer 暴露快速模式

**Files:**

- Modify: `apps/web/src/features/settings/components/global-settings-model.ts`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-fields.tsx`
- Test: `apps/web/src/features/settings/components/global-settings-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-dialogs.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-active-task.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-submission.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-toolbar.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/settings.ts`
- Modify: `apps/web/src/i18n/locales/en/settings.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`

**Interfaces:**

- Consumes: `providerConnectionQueryOptions`、`AgentGlobalSettings.fastMode`
- Produces: 官方账号可见的全局复选控件、Composer `Zap` 切换按钮和当前 Turn `fastMode`

**Behavior:**

- 官方 ChatGPT 登录时显示全局与 Composer 控件，Composer 默认继承全局值并允许按当前会话切换；其他连接状态完全不渲染控件且提交值为关闭。

**Stop Conditions:**

- 工作台无法复用现有 Provider 连接查询缓存，或控件会破坏窄屏工具栏稳定布局时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/settings/components/global-settings-dialog.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`

Expected: 官方账号显示、非官方隐藏、默认继承和 Turn 覆盖测试通过。

### Task 4: 更新工程规范并执行完整验收

**Files:**

- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 已实现的快速模式协议、Provider 映射和 UI 行为
- Produces: 可审计的跨层工程约束与完整验证结果

**Behavior:**

- 记录官方账号门禁、`serviceTier` 清除语义和全局/Turn 设置边界，并通过仓库全量质量门禁。

**Stop Conditions:**

- 任一目标测试或 `pnpm check` 失败且无法在本需求范围内修复时停止。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 格式、Lint、架构、测试、构建、Bundle 和发布检查全部通过。
