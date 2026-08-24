# Codex Auth And Custom API Implementation Plan

**Goal:** 在 CodeAgent 内完成 ChatGPT 官方登录和单一 OpenAI-compatible 自定义 API 连接，并让连接模式驱动真实模型目录与现有 Task/Turn 设置。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、Secret、验证和命令规范。
- `.superwork/spec/backend/directory-structure.md` — 确认 Core、Codex Adapter、Server 路由与持久化边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 App Server 认证、配置、模型目录和长驻进程生命周期。
- `.superwork/spec/backend/quality-guidelines.md` — 约束外部输入、日志、Schema 与安全测试。
- `.superwork/spec/frontend/component-guidelines.md` — 约束设置对话框和连接组件职责。
- `.superwork/spec/frontend/hook-guidelines.md` — 约束登录轮询、Mutation 和清理。
- `.superwork/spec/frontend/state-management.md` — 约束 TanStack Query 与认证 Gate 状态。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束可访问性、响应式和交互测试。
- `.superwork/spec/frontend/type-safety.md` — 约束 Protocol Schema 作为浏览器边界真相。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol 与 Core 公开入口和依赖方向。
- `.superwork/spec/shared/quality-guidelines.md` — 约束联合类型、契约测试与运行时校验。

**Architecture:** 通过 Codex App Server `account/*` 和 `config/batchWrite` 管理认证与固定自定义 Provider；CodeAgent 仅持久化模式、Base URL 和已验证模型目录。Server 按模式提供 `/v1/models`，Web 在连接未就绪时显示实际连接 Gate，并在全局设置中复用连接面板。

**Tech Stack:** TypeScript、TypeBox、Codex App Server JSON-RPC、Fastify、SQLite Worker、React 19、TanStack Query、shadcn/Radix、Tailwind CSS v4、Vitest、Playwright、pnpm。

## Global Constraints

- 遵守 `AGENTS.md`：说明和注释使用简体中文，代码标识符保持原文，关键逻辑添加清晰短注释，Python 命令只用 `python3`，项目命令使用 pnpm。
- API key 只能存在于当前 HTTPS/本机 HTTP 请求 Body、Adapter 内存和 Codex 官方凭证写入调用中；禁止进入数据库、Codex `config.toml`、URL、日志、响应、Query Cache、localStorage、错误正文和快照。
- 自定义 Provider ID 固定为 `code_agent_custom`；只接受 `http:`/`https:` Base URL，拒绝 userinfo、query、fragment 和重定向，限制超时、响应大小和模型数量。
- 只支持 Responses API-compatible Provider；不增加旧实现兼容分支，不读取或编辑 `auth.json`，不提供原始 RPC/TOML 透传。
- 前端沿用现有 semantic tokens、字体和紧凑工作台风格。移动端先实现单列 44px 触控目标，`sm` 以上增强为双区布局；不新增营销 Hero、装饰渐变、嵌套 Card 或视口缩放字号。
- 独立异步读取并行启动；登录轮询必须可取消，组件卸载后不得继续更新状态。
- 每个代码行为切片按 `superwork-tdd` 执行 RED、GREEN、REFACTOR；不得自动提交。

### Task 1: 定义 Provider 连接协议与 Core 端口

**Files:**

- Create: `packages/protocol/src/provider-connection.ts`
- Create: `packages/protocol/src/provider-connection.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/project.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: 现有 `AgentModelPageSchema`、`AgentMutationErrorSchema`、`AgentRuntimeProvider` 和 Repository 公共入口。
- Produces: `AgentProviderConnectionStatusSchema`、官方登录/取消/退出/自定义配置请求响应 Schema、`AgentProviderConnectionRecord`、扩展后的 `AgentRuntimeProvider` 与 `AgentProviderConnectionRepository`。

**Behavior:**

- 定义可区分 `official | custom`、`disconnected | pending | connected | failed` 的无 Secret 连接契约；约束 URL、登录 ID、账号展示字段和模型页，并让 Core 只暴露 Provider 无关操作。

**Stop Conditions:**

- 如果协议必须暴露原始 Codex Account、API key 或 Provider TOML 才能表达行为，则停止并返回设计阶段。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/provider-connection.test.ts packages/core/src/agent-provider.test.ts`

Expected: 新 Schema 的合法/非法样例与 Core 契约测试全部通过。

### Task 2: 实现 Codex 认证、配置与自定义模型发现

**Files:**

- Create: `packages/provider-codex/src/provider-connection.ts`
- Create: `packages/provider-codex/src/provider-connection.test.ts`
- Modify: `packages/provider-codex/src/agent-provider-base.ts`
- Modify: `packages/provider-codex/src/runtime-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/index.ts`

**Interfaces:**

- Consumes: Task 1 的 `AgentRuntimeProvider` 连接方法、`CodexRpcClient`、`account/read`、`account/login/start`、`account/login/cancel`、`account/logout`、`config/batchWrite` 与注入式 `fetch`。
- Produces: `CodexProviderConnectionService`、官方登录状态映射、自定义 `/models` 有界发现与固定 Provider 配置。

**Behavior:**

- 启动 hosted ChatGPT 登录并追踪完成通知；支持取消和退出；自定义连接规范化 URL、在超时/字节/数量边界内读取去重模型，按有无 key 写入安全认证配置，并且所有失败路径都不泄漏 Secret。

**Stop Conditions:**

- 如果当前锁定 Codex Schema 不支持必需的 `account/*` 或 `config/batchWrite` 字段，则停止并报告准确 Schema 差异，不改用 Shell 或直接 TOML 编辑。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/provider-connection.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: RPC 顺序、通知、URL/模型校验、无 key、本地 HTTP、重定向、超时、超限和 Secret 安全测试通过。

### Task 3: 持久化非敏感 Provider 连接元数据

**Files:**

- Modify: `packages/server/src/sqlite-state-repository.ts`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/sqlite-state-repository.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `AgentProviderConnectionRepository` 和 `AgentProviderConnectionRecord`。
- Produces: SQLite migration v11、单行 `provider_connection` 读写操作和模型 JSON 运行时校验。

**Behavior:**

- 原子保存 `mode`、可空 Base URL、有界模型目录和更新时间；首次运行默认 official；数据库中不存在 Secret 列，损坏或超限 JSON 必须失败关闭。

**Stop Conditions:**

- 如果现有 Worker 消息协议无法在不复制 Repository 逻辑的情况下扩展，则停止并先修正边界设计。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/sqlite-state-repository.test.ts`

Expected: migration、默认值、读写、重开持久化、损坏数据和无 Secret Schema 测试通过。

### Task 4: 添加 Fastify 连接路由并按模式提供模型

**Files:**

- Create: `packages/server/src/routes/provider-connection-routes.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/runtime-routes.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `src/cli-command.ts`
- Modify: `src/cli-command.test.ts`

**Interfaces:**

- Consumes: Task 1/2/3 的 Runtime Provider 和 Repository 接口、现有 `runIdempotent`、`MutationHttpError`、`ModelCatalogCache` 与 Fastify Schema 路由模式。
- Produces: `/v1/provider-connection` 读取、官方登录、自定义连接、取消、退出路由，以及 official/custom 统一 `listModels`。

**Behavior:**

- 所有输入先经 JSON Schema 校验；Mutation 强制 Idempotency Key；成功模式切换清空缓存并持久化记录；自定义模式使用存储目录参与所有设置校验，失败不覆盖上一次连接。

**Stop Conditions:**

- 如果模式切换无法同时保持 Codex 配置和 CodeAgent 记录一致，则停止并增加明确补偿策略测试后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts src/cli-command.test.ts`

Expected: 新路由契约、幂等、错误映射、模式模型目录、缓存失效、CLI 装配和失败不覆盖测试通过。

### Task 5: 扩展浏览器 HTTP Client 与 Query 契约

**Files:**

- Modify: `packages/client/src/http-client-transport.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Create: `apps/web/src/features/provider-connection/provider-connection-queries.ts`
- Create: `apps/web/src/features/provider-connection/provider-connection-queries.test.ts`

**Interfaces:**

- Consumes: Task 1 的请求响应 Schema 和 Task 4 的固定 HTTP 路由。
- Produces: `CodeAgentClient` 连接方法、稳定 Query Keys、可取消状态轮询和成功后的相关缓存失效策略。

**Behavior:**

- Client 正确发送 Body、编码 login ID、附加 Idempotency Key 并运行时校验响应；Query 只在 pending 登录时轮询，成功后失效连接、模型、全局设置和 Project 默认值。

**Stop Conditions:**

- 如果 API key 会被 TanStack Query 作为 mutation key、cache data 或错误对象持有，则停止并调整 Mutation 边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/client/src/http-client.test.ts apps/web/src/features/provider-connection/provider-connection-queries.test.ts`

Expected: Client 请求契约、响应校验、轮询启停和缓存失效测试通过，断言中不出现 API key。

### Task 6: 构建登录 Gate 与设置中的 Provider 面板

**Files:**

- Create: `apps/web/src/features/provider-connection/components/provider-connection-panel.tsx`
- Create: `apps/web/src/features/provider-connection/components/provider-connection-panel.test.tsx`
- Create: `apps/web/src/features/provider-connection/components/provider-connection-gate.tsx`
- Modify: `apps/web/src/app/routes/index-route.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-fields.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-lazy.ts`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-dialogs.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/settings.ts`
- Modify: `apps/web/src/i18n/locales/en/settings.ts`

**Interfaces:**

- Consumes: Task 5 的 Query/Mutation options、现有 `Button`、`ButtonGroup`、`Input`、Dialog 和 semantic tokens。
- Produces: 可复用 `ProviderConnectionPanel`、根连接 Gate、全局设置 Provider 分类及官方/自定义完整交互状态。

**Behavior:**

- 未连接时根路由仅呈现实际连接操作；官方登录打开 `authUrl` 并显示 pending/cancel；自定义表单提供 Base URL 和不持久化的 password input；connected/failed 状态可切换或退出。布局从移动单列增强到桌面双区，键盘焦点、错误关联和禁用状态完整。

**Stop Conditions:**

- 如果必须把 API key 提升到 Query Cache、全局 Store 或 localStorage 才能完成交互，则停止并重构为组件本地瞬时状态。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/provider-connection/components/provider-connection-panel.test.tsx apps/web/src/features/settings/components/global-settings-dialog.test.tsx`

Expected: 模式切换、字段可访问性、pending/cancel、成功、失败、Secret 清空、Gate 和设置复用测试通过。

### Task 7: 更新端到端流程与工程规范

**Files:**

- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `tests/e2e/app-shell-runtime.spec.ts`
- Modify: `tests/e2e/app-shell-settings-navigation.spec.ts`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/backend/quality-guidelines.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**

- Consumes: Task 4 的 HTTP 契约、Task 6 的可访问标签和稳定交互状态。
- Produces: 官方登录 Gate、自定义连接、设置切换和模型选择的浏览器证据，以及替换“必须预先 CLI 登录”的持久工程说明。

**Behavior:**

- E2E fixture 默认提供已连接官方状态；专项用例覆盖未登录 Gate、自定义连接返回真实模型后进入工作台、设置中可查看连接；文档准确说明凭证归属、模式切换和 Responses API 限制。

**Stop Conditions:**

- 如果 E2E 只能依赖真实 OpenAI 账号或外部网络才能稳定运行，则停止并改用边界级受控 fixture，不跳过测试。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-runtime.spec.ts tests/e2e/app-shell-settings-navigation.spec.ts`

Expected: 两个浏览器规格在桌面和现有移动项目配置中通过，且未启动常驻开发服务器。

### Task 8: 执行全量质量门禁

**Files:**

- Modify: `.superwork/plans/2026-08-07-codex-auth-custom-api.md`

**Interfaces:**

- Consumes: Tasks 1-7 的实现、测试、Schema baseline、依赖边界和发布构建。
- Produces: 全量静态分析、单元/性能测试、构建、包校验和浏览器流程验证证据。

**Behavior:**

- 运行项目规定的完整检查，修复范围内所有失败；确认 `git diff` 不含 API key、生成源码映射、意外依赖或无关格式化变更。

**Stop Conditions:**

- 如果失败来自与本任务无关的既有工作树变化，保留用户改动并记录准确阻塞证据，不回滚。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 两个命令均以退出码 0 完成，计划所有 Task Status 为 completed。
