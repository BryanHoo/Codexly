# Codex 登录与自定义 API 设计

## Goal

在 CodeAgent 中提供可直接使用的 Codex 认证入口，支持 ChatGPT 官方登录与 OpenAI-compatible 自定义 API 两种模式；切换模式后，认证状态、模型目录、全局默认模型和新建 Task 使用同一份有效 Provider 配置。API key 不写入 CodeAgent 数据库、日志或 Codex `config.toml`。

## Suggested Spec Reads

- `.superwork/spec/guides/index.md`
- `.superwork/spec/backend/directory-structure.md`
- `.superwork/spec/backend/runtime-lifecycle.md`
- `.superwork/spec/backend/quality-guidelines.md`
- `.superwork/spec/frontend/directory-structure.md`
- `.superwork/spec/frontend/component-guidelines.md`
- `.superwork/spec/frontend/hook-guidelines.md`
- `.superwork/spec/frontend/state-management.md`
- `.superwork/spec/frontend/quality-guidelines.md`
- `.superwork/spec/frontend/type-safety.md`
- `.superwork/spec/shared/directory-structure.md`
- `.superwork/spec/shared/quality-guidelines.md`

## Existing Context

- 根 CLI 启动一个长驻 `codex app-server --listen stdio://`，`CodexRuntimeProvider` 复用同一 RPC Client。
- 当前项目要求用户预先在 Codex CLI 登录，尚未调用官方 `account/*` API。
- Provider 模型通过 `model/list` 读取，Server 使用有界 TTL 缓存向 `/v1/models` 提供目录。
- 全局设置、Project 默认值和 Task 设置依赖模型目录校验，Web 已有统一模型选择器。
- CodeAgent 状态位于 `$CODEX_HOME/code-agent/state.sqlite3`；Codex 认证由 `CODEX_HOME` 下的官方凭证存储管理。
- 官方文档规定 ChatGPT 登录使用 `account/login/start`，状态使用 `account/read`，退出使用 `account/logout`；自定义 Provider 使用用户级 `model_provider` 和 `model_providers.<id>` 配置。
- 官方文档建议自定义 Provider 的密钥使用认证或环境变量，不建议将 bearer token 直接写入配置。`requires_openai_auth = true` 可复用 Codex 管理的 ChatGPT/API key 认证。

## Considered Approaches

### 方案 A：复用 App Server 认证与配置，CodeAgent 保存非敏感目录（推荐）

- 官方登录完全委托 `account/*` RPC。
- 自定义 API key 通过 `account/login/start { type: "apiKey" }` 交给 Codex 管理。
- 自定义 Provider 通过 `config/batchWrite` 写入用户级配置，并固定使用 `requires_openai_auth = true`；无密钥的本地服务则关闭该字段。
- CodeAgent 仅保存模式、Base URL 和已验证的模型目录。

优点：符合官方接口和凭证边界，跨平台，不读取 `auth.json`，无需自建加密存储。缺点：官方登录与自定义 API key 共用当前 Codex 认证槽，切换密钥模式时需要重新登录。

### 方案 B：CodeAgent 自建密钥库并通过环境变量注入 App Server

优点：可同时保存多组连接。缺点：需要跨平台 Keychain/Credential Manager 实现和 App Server 重启机制，扩大安全与生命周期范围。

### 方案 C：执行 `codex login` 和直接编辑 TOML

优点：实现表面简单。缺点：难以可靠接收登录状态，容易破坏用户配置，且绕过 App Server 已提供的结构化 API。

## Recommended Approach

采用方案 A。固定自定义 Provider ID 为 `code_agent_custom`，避免接受任意 TOML key。官方模式将 `model_provider` 设置为 `openai`；自定义模式写入固定 Provider 的 `name`、`base_url`、`wire_api = "responses"` 和认证字段。保留未激活的自定义 Provider 定义，切换模式只改变 `model_provider`，不删除用户其他 Codex 配置。

## Component Responsibilities And Interfaces

### Protocol

新增 Provider 连接协议：

- `AgentProviderConnectionStatus`：当前模式、连接状态、脱敏账号信息、可选 pending login 和自定义 Base URL。
- `StartOfficialLoginResponse`：`loginId`、`authUrl` 与最新状态。
- `ConfigureCustomProviderRequest`：`baseUrl`、可选 `apiKey`。
- `ConfigureCustomProviderResponse`：最新状态和经验证的 `AgentModelPage`。
- `CancelProviderLoginRequest` 与标准空响应。

所有请求和响应使用 TypeBox Schema，禁止在任何响应中回传 API key。

### Core Port

扩展 `AgentRuntimeProvider`：读取认证状态、开始/取消官方登录、配置自定义 Provider、退出认证。接口保持 Provider 无关命名，Codex RPC 与 `/models` 兼容细节留在 Adapter。

新增 `AgentProviderConnectionRepository`，只读写非敏感记录：模式、Base URL、模型 JSON 与更新时间。

### Codex Adapter

- 使用 `account/read` 映射账号类型、邮箱和方案，不暴露原始 Codex 对象。
- 使用 `account/login/start` 启动 ChatGPT hosted browser flow；监听 `account/login/completed` 和 `account/updated`，为轮询状态保留有界 pending 结果。
- 使用 `account/login/cancel` 和 `account/logout` 完成取消与退出。
- 自定义 API 仅允许 `http:` 或 `https:`，拒绝 userinfo、query 和 fragment；规范化 Base URL 后请求同路径下的 `/models`。
- `/models` 请求不跟随重定向，设置明确超时、最大响应字节、Bearer Header 和 JSON 结构校验；模型 ID 去重、排序并映射为统一模型。
- 认证 API key 后使用一次 `config/batchWrite` 更新固定 Provider 和 `model_provider`。无 API key 时配置为无需认证。
- 切回官方模式仅将 `model_provider` 更新为 `openai`，然后启动 ChatGPT 登录。

### Server

新增固定路由：

- `GET /v1/provider-connection`
- `POST /v1/provider-connection/official-login`
- `POST /v1/provider-connection/custom`
- `DELETE /v1/provider-connection/login/:loginId`
- `DELETE /v1/provider-connection/session`

Mutation 使用 `Idempotency-Key`。自定义连接成功后再保存非敏感元数据；失败不覆盖当前记录。官方登录启动后立即保存官方模式。Provider 模式改变时清空模型缓存。

`GET /v1/models` 在官方模式继续读取 `model/list` 缓存；自定义模式返回 SQLite 中最近一次验证成功的模型目录。全局、Project 和 Task 设置继续用同一 `listModels` 校验，避免 UI 可选但 Turn 被拒绝。

### Persistence

新增单行 `provider_connection` 表：

- `mode`: `official | custom`
- `custom_base_url`: 可空
- `custom_models_json`: 可空且有长度上限
- `updated_at`

不保存 API key、Authorization Header、OAuth URL 或登录错误正文。

### Web

- 根路由在认证状态未满足时显示实际登录界面，不装配工作台请求，避免未登录时模型请求先失败。
- 登录界面使用分段模式选择：官方 ChatGPT 与自定义 API。
- 官方模式提供登录命令按钮；打开 `authUrl` 后轮询状态，成功后刷新连接、模型和全局设置 Query。
- 自定义模式提供 Base URL 和密码输入框；提交后由服务端验证并读取模型，成功后进入工作台。
- 全局设置新增“Provider”分类，复用同一连接面板用于查看账号、切换连接、取消登录和退出。
- 秘钥字段始终为空，不进入 Query Cache、localStorage 或错误文案。

## Data Flow

1. Web 读取 `/v1/provider-connection`。
2. 官方登录：Server 调用 `account/login/start`，Web 打开 URL 并轮询；Adapter 收到完成通知后，`account/read` 成为最终真相。
3. 自定义连接：Adapter 验证 URL 并读取 `/models`，可选地将 API key 交给 `account/login/start`，再原子写入 Provider 配置；Server 保存脱敏元数据和模型目录并清缓存。
4. Web 刷新 `/v1/models` 与设置；后续 Task 继续传统一模型 ID，Codex 从用户级 `model_provider` 选择实际 API。

## Error Handling

- 登录取消、弹窗关闭和 OAuth 失败保留当前可重试状态，不伪造已连接。
- 自定义 API 的 DNS、TLS、超时、重定向、HTTP 非 2xx、超限和无有效模型均映射为结构化 `PROVIDER_ERROR`；不包含 API key 或响应正文。
- Codex RPC 错误保留安全的官方 message；日志只记录操作、状态码、Provider 模式和 Base URL origin，不记录 Secret。
- 如果 Provider 配置写入失败，不保存新的 CodeAgent 连接记录。
- 已存自定义模型目录损坏时拒绝读取并要求重新连接，不回退到官方目录造成错配。

## Verification Strategy

- Protocol：Schema 接受合法联合类型并拒绝 Secret 泄漏字段、非法 URL 结构和畸形响应。
- Provider：覆盖现有登录、ChatGPT pending/success/error/cancel/logout、自定义有/无 key、配置 RPC、模型去重、重定向、超时、响应超限和敏感信息不进入错误。
- Server：覆盖路由契约、幂等、模式持久化、缓存失效、自定义目录驱动设置校验和失败不覆盖。
- Client：覆盖所有新 HTTP 方法、路径编码、Header 和响应运行时校验。
- Web：覆盖官方/自定义切换、密码字段、pending 轮询、错误、成功刷新、设置面板与未登录 Gate。
- 全量运行 `pnpm check` 和 `pnpm test:e2e`，不启动开发服务器。

## Non-Goals

- 不支持同时保存或管理多组自定义 API。
- 不实现 Azure、Bedrock、命令式 Token 或自定义 Header 编辑器。
- 不读取、复制或展示 Codex `auth.json`。
- 不代理模型推理流量，不改变现有 Turn/Task 协议。
- 不保证任意 Chat Completions-only 服务可用；自定义服务必须兼容 Codex 所需 Responses API。

## Success Criteria

- 未登录用户可在 CodeAgent 内完成 ChatGPT 官方登录并进入工作台。
- 用户可填写 OpenAI-compatible Base URL 和可选 API key，连接时读取真实 `/models` 列表。
- 自定义模型出现在所有既有模型选择器中，并可通过现有设置校验启动 Task/Turn。
- 切换官方与自定义模式后，模型目录和 Codex `model_provider` 同步生效。
- API key 不出现在 CodeAgent 数据库、Codex `config.toml`、响应、Query Cache、日志或测试快照中。
