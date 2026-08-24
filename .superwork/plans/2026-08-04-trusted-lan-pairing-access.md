# Feature Implementation Plan

**Goal:** 为 Codexly 增加用户显式启用的可信局域网 HTTP 访问模式，通过启动期配对码和服务端进程内 Session 提供基础访问控制，同时保持默认 Loopback 模式不对局域网开放。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束项目命名、包管理器、验证命令和发布检查。
- `.superwork/spec/backend/directory-structure.md` — 确认 CLI 装配、Server 交付层和公开入口的职责边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 CLI 启停、进程内资源和关闭顺序。
- `.superwork/spec/backend/quality-guidelines.md` — 约束网络监听、日志脱敏、Origin、Schema 和外部输入校验。
- `.superwork/spec/frontend/component-guidelines.md` — 约束配对门禁、表单状态、可访问性和设计 Token。
- `.superwork/spec/frontend/state-management.md` — 约束 Session 状态、Query Cache 和实时连接的清理边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Vitest、Playwright 和完整浏览器流程验证。
- `.superwork/spec/frontend/type-safety.md` — 约束 Web 只消费 Client 和 Protocol 的已验证契约。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Client、Server 与 Web 的依赖方向。
- `.superwork/spec/shared/quality-guidelines.md` — 约束新 HTTP 契约、错误边界和跨包消费者同步。

**Architecture:** 默认 `codexly start` 继续监听 `127.0.0.1:3210` 且不要求配对；显式 `codexly start --lan [--session-ttl <duration>]` 生成仅驻留当前进程的启动期配对码，监听 `0.0.0.0:3210`，并把配对码和绝对 Session 有效期以内存参数传给 Fastify。Server 公开静态 SPA、健康检查和最小 Access API，通过根级 Hook 统一保护其余 `/v1/*` HTTP 与 WebSocket Upgrade；配对成功后签发 `HttpOnly; SameSite=Strict; Path=/` 的 opaque Session Cookie，并以签发时间加启动参数确定唯一绝对过期时间，后续请求不续期。Web 在 Project、Query 和 Event Runtime 挂载前读取 Access 状态，未配对时只展示配对门禁；注销或收到 `401` 时卸载业务 Runtime 并清空敏感 Query Cache。该模式明确面向可信局域网 HTTP，不实现 TLS、账号体系、持久密码或远程身份提供方。

**Tech Stack:** TypeScript、Node.js 24、Fastify 5、`@fastify/cookie`、TypeBox、React 19、TanStack Query、WebSocket、Vitest、Playwright、pnpm、Markdown。

## Global Constraints

- 默认启动必须继续只监听 `127.0.0.1:3210`；只有显式 `--lan` 才监听 `0.0.0.0:3210` 并启用配对认证。
- LAN 模式属于可信局域网 HTTP 便利能力；不实现 HTTPS、证书、HSTS、OAuth/OIDC、用户注册、RBAC、JWT、Refresh Token、持久密码或数据库迁移。
- 启动期配对码由 `node:crypto` 生成至少 128 bit 熵，只通过当前终端显示并以内存对象传给 Server；不得进入 URL、环境变量、浏览器存储、结构化日志或 SQLite。
- 同一启动期配对码允许当前进程中的多个可信浏览器建立独立 Session；Server 重启后配对码和全部 Session 必须失效。
- Session ID 使用至少 256 bit 随机值，只保存在进程内有界 Store 和 `HttpOnly; SameSite=Strict; Path=/` Cookie 中；由于目标是 HTTP，不设置会导致 Cookie 无法发送的 `Secure` 属性，并在文档中明确明文传输边界。
- Session 只使用绝对有效期，不实现空闲过期或请求续期；默认 `24h`，用户可在 LAN 启动时通过 `--session-ttl <duration>` 自定义。
- `--session-ttl` 只接受正整数加 `m`、`h`、`d` 单位，例如 `30m`、`12h`、`7d`；换算结果限制为 `1m` 至 `30d`，只能与 `--lan` 同时使用。
- 配对失败按远端 IP 使用有界内存窗口限流：每分钟最多 5 次失败，返回通用错误，不泄漏配对码、Session 或匹配细节。
- 静态 SPA、`GET /v1/health`、`GET /v1/access` 和 `POST /v1/access/pair` 可匿名访问；其余 `/v1/*`、附件、源码、指标、Mutation 和 WebSocket Upgrade 必须统一认证。
- Cookie 认证下的浏览器写请求和 WebSocket Upgrade 必须执行严格的 `Origin` 与 `Host` 同源校验；建立统一 Hook 后删除 `event-routes.ts` 中重复的旧校验逻辑。
- 所有 `/v1/*` 响应使用 `Cache-Control: no-store`；应用响应补充 CSP、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer` 和受限 `Permissions-Policy`，不为 HTTP 设置 HSTS。
- 不启用 CORS，不支持跨 Origin Client，不使用 IP 白名单替代认证，不把前端路由守卫当作安全边界。
- 使用项目现有 `pnpm` 工具链；Python 命令只能使用 `python3`；不启动开发服务器。
- 关键认证、限流、Session 清理和监听分支添加简短、明确的中文注释；按新逻辑删除重复旧路径，不保留双轨实现。

### Task 1: 定义 Access 协议与浏览器 Client 边界

**Files:**

- Create: `packages/protocol/src/access.ts`
- Create: `packages/protocol/src/access.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `packages/client/src/index.ts`

**Interfaces:**

- Consumes: `CodexlyClient` 的同 Origin Fetch、Schema 校验、超时和 `CodexlyHttpError` 边界。
- Produces: `AccessMode = "local" | "lan"`。
- Produces: `AccessStatusResponse = { authenticated: boolean; mode: AccessMode; version: 1 }`
- Produces: `PairAccessRequest = { code: string }`、`PairAccessResponse = AccessStatusResponse` 和严格 TypeBox Schema。
- Produces: `LogoutAccessResponse = AccessStatusResponse` 和严格 TypeBox Schema。
- Produces: `CodexlyClient.getAccessStatus()`、`CodexlyClient.pairAccess(code)`、`CodexlyClient.logoutAccess()`。
- Produces: `CodexlyClient.subscribeUnauthorized(listener)`
- Produces: `AgentMutationErrorCode` 新增 `ACCESS_DENIED`、`PAIRING_FAILED`、`PAIRING_RATE_LIMITED`。

**Behavior:**

- 建立独立于 Codex 账号登录的 Codexly 网络 Access 契约；Client 对成功响应执行运行时 Schema 校验，所有 Fetch 显式使用 `credentials: "same-origin"`，配对码只进入 `POST /v1/access/pair` JSON Body。`401` 通知不吞掉现有错误，也不改变非认证错误语义。

**Stop Conditions:**

- 如果 Access 契约需要依赖 Core 或 Provider 类型，停止并重新收敛为只属于 Protocol 的网络契约。
- 如果 `401` 通知要求组件直接依赖 Fetch 或 WebSocket 实现细节，停止并保持通知能力在 `@codexly/client` 公共边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/access.test.ts packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts`

Expected: Access Schema 严格拒绝额外字段和无效模式，Client 配对、注销、同 Origin Cookie 与 `401` 通知测试全部通过。

### Task 2: 实现 Fastify 统一认证、Session 与安全响应边界

**Files:**

- Create: `packages/server/src/access-control.ts`
- Create: `packages/server/src/access-control.test.ts`
- Create: `packages/server/src/routes/access-routes.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/server/src/routes/event-routes.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `AccessStatusResponse = { authenticated: boolean; mode: AccessMode; version: 1 }`
- Consumes: Fastify 根级 `onRequest`、`onSend`、`onClose` Hook 和 `@fastify/websocket` Upgrade 生命周期。
- Produces: `CodexlyAccessOptions = { pairingCode: string; sessionTtlMs: number }`
- Produces: `CreateCodexlyServerOptions.access`
- Produces: `AccessSessionService`，负责常量时间配对校验、有界失败窗口、Session 签发、验证、绝对过期、注销和关闭清理。
- Produces: `GET /v1/access`、`POST /v1/access/pair`、`POST /v1/access/logout`。
- Produces: 根级认证与同源 Hook，统一保护 HTTP 和 WebSocket，并返回符合 Protocol 的 `401`、`403`、`429` 响应。

**Behavior:**

- 注册 `@fastify/cookie` 后，在任何业务路由和 WebSocket 建立前执行统一 Access 检查。Local 模式返回已认证状态且保持业务路由可用；LAN 模式只有健康检查、Access API 和静态 SPA 匿名可用。正确配对签发独立 Session Cookie，Server 以签发时间加 `sessionTtlMs` 固定 `expiresAt`，Cookie `Max-Age` 使用相同绝对时长，后续认证请求不得刷新或延长有效期。错误配对使用通用消息并受限流约束；注销清除 Cookie 和服务端 Session。Session Store、失败窗口和过期清理全部有界，`app.close()` 清空敏感内存。统一安全响应头和 `/v1/*` 的 `no-store` 不改变带内容哈希静态资产的现有缓存策略。

**Stop Conditions:**

- 如果 Fastify Hook 注册顺序不能同时覆盖已注册静态路由、后续 Plugin 路由和 WebSocket Upgrade，停止并先用最小 `app.inject()`/`injectWS()` 测试确认封装范围。
- 如果 Cookie、配对码或 `Set-Cookie` 出现在 Pino 输出，立即停止后续任务并修复脱敏与测试。
- 如果新增依赖与 Fastify 5 不兼容或无法进入严格 catalog，停止并报告包解析错误，不手写 Cookie 解析器。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/access-control.test.ts packages/server/src/app.test.ts`

Expected: Local 模式无回归；LAN 模式的匿名 HTTP/WS 拒绝、正确配对、Cookie 属性、多浏览器 Session、固定绝对过期且请求不续期、限流、注销、Origin、日志脱敏和关闭清理测试全部通过。

### Task 3: 增加显式 LAN CLI 启动流程

**Files:**

- Create: `src/lan-access.ts`
- Create: `src/lan-access.test.ts`
- Modify: `src/cli-command.ts`
- Modify: `src/cli-command.test.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: `CodexlyAccessOptions = { pairingCode: string; sessionTtlMs: number }`
- Consumes: `CreateCodexlyServerOptions.access`
- Consumes: Node.js `node:crypto.randomBytes()` 与 `node:os.networkInterfaces()`。
- Produces: `codexly start --lan [--session-ttl <duration>]` CLI 选项。
- Produces: `parseSessionTtl(value)`，将 `m`、`h`、`d` 时长转换为 `1m` 至 `30d` 范围内的安全整数毫秒值。
- Produces: `generateLanPairingCode()`，返回至少 128 bit 熵的 URL-safe 启动期配对码。
- Produces: `listLanAccessUrls(port)`，只列出有效、非内部的 IPv4 地址并稳定排序。
- Produces: CLI LAN 启动摘要，包含可信 LAN HTTP 警告、可访问 URL、配对码和进程重启失效说明。

**Behavior:**

- 重构当前只支持键值对的参数解析，使 `--lan`、`--session-ttl <duration>` 可与 `--codex-bin`、`--codex-home` 任意合法组合且重复或未知选项被拒绝。`--session-ttl` 未提供时使用 `24h`，未同时提供 `--lan`、格式错误、低于 `1m`、高于 `30d` 或换算溢出时在启动任何 Runtime 前失败。默认启动继续向 Server 传递无 Access 配置并监听 `127.0.0.1:3210`；LAN 启动生成一次配对码，把解析后的 `sessionTtlMs` 与配对码一并传入内存 Access 配置并监听 `0.0.0.0:3210`，自动打开浏览器时仍使用 `http://127.0.0.1:3210`，终端另外列出真实 LAN 地址和本次绝对 Session 有效期。没有可枚举 LAN 地址时继续运行并给出明确警告，不输出 `http://0.0.0.0:3210` 作为用户访问地址。

**Stop Conditions:**

- 如果参数解析会接受悬空值、静默覆盖重复选项、允许 Local 模式单独使用 `--session-ttl` 或改变 `doctor` 语义，停止并先固定解析测试矩阵。
- 如果配对码只能通过环境变量、命令行参数或 URL 传给 Server，停止该路径并保持进程内函数参数传递。
- 如果 LAN 模式会自动打开 LAN URL 并在浏览器历史中携带配对码，停止并修正为无凭据的 Loopback URL。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run src/lan-access.test.ts src/cli-command.test.ts`

Expected: 默认与 LAN 监听分支、`--session-ttl` 默认值/单位/边界/非法组合、随机码格式、网卡地址过滤、终端提示、浏览器 URL 和资源关闭顺序测试全部通过。

### Task 4: 实现 Web 配对门禁与 Session 生命周期

**Files:**

- Create: `apps/web/src/features/access/access-context.tsx`
- Create: `apps/web/src/features/access/access-context.test.tsx`
- Create: `apps/web/src/features/access/pairing-gate.tsx`
- Create: `apps/web/src/features/access/pairing-gate.test.tsx`
- Modify: `apps/web/src/app/providers.tsx`
- Modify: `apps/web/src/app/providers.test.tsx`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/common.ts`
- Modify: `apps/web/src/i18n/locales/en/common.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/settings.ts`
- Modify: `apps/web/src/i18n/locales/en/settings.ts`
- Modify: `apps/web/src/i18n/resources.test.ts`
- Modify: `apps/web/src/shared/styles/globals.css`

**Interfaces:**

- Consumes: `CodexlyClient.getAccessStatus()`、`CodexlyClient.pairAccess(code)`、`CodexlyClient.logoutAccess()`。
- Consumes: `CodexlyClient.subscribeUnauthorized(listener)`
- Produces: `AccessProvider`
- Produces: `useAccess()`
- Produces: `PairingGate`
- Produces: 只有 `authenticated === true` 时才挂载 `ProjectProvider`、`ComposerDraftProvider`、Router 子树和 Project Event Runtime 的顶层装配。

**Behavior:**

- App 首先读取 Access 状态；Local 模式直接进入现有工作台，LAN 未认证模式只显示 Codexly 品牌、配对码输入、提交和错误/重试状态，不发起 Project、Model、Settings 或 WebSocket 请求。配对成功后在原深链 URL 挂载工作台，不把配对码保存到 React Query、`localStorage`、URL 或 Toast。任意 Client 请求收到 `401` 时立即卸载业务 Runtime、清空 Query Cache 并返回门禁；LAN 设置页提供明确的“退出局域网访问”，注销完成后执行相同清理。错误文案保持通用，不展示服务端内部消息或配对码匹配细节。

**Stop Conditions:**

- 如果未认证首屏仍会挂载 `ProjectProvider` 或建立 Event WebSocket，停止并调整 Provider 层级后再继续。
- 如果注销后 Query Cache、Project Runtime、Composer Draft 或附件 URL 仍可访问敏感数据，停止并补齐统一清理边界。
- 如果配对 UI 需要新增独立 Router 登录路径，保持顶层 Gate 方案，不创建可绕过深链的双轨路由。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/access/access-context.test.tsx apps/web/src/features/access/pairing-gate.test.tsx apps/web/src/app/providers.test.tsx apps/web/src/features/settings/components/global-settings-dialog.test.tsx apps/web/src/i18n/resources.test.ts`

Expected: 未认证请求隔离、配对成功、错误重试、`401` 失效、注销清理、Local 直通、深链恢复和中英文可访问性测试全部通过。

### Task 5: 覆盖真实浏览器 LAN 配对流程并固化架构文档

**Files:**

- Create: `tests/e2e/fixtures/lan-access.ts`
- Create: `tests/e2e/lan-access.spec.ts`
- Modify: `tests/fixtures/fake-realtime-server.mjs`
- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/backend/quality-guidelines.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/frontend/quality-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: `AccessProvider`
- Consumes: `PairingGate`
- Consumes: `CreateCodexlyServerOptions.access`
- Consumes: Fastify Cookie/WebSocket 的真实浏览器行为。
- Produces: 独立 Playwright Worker LAN Server Fixture，使用固定测试配对码但不影响现有 Local E2E Server。
- Produces: 可信 LAN 模式的浏览器验收证据和稳定安全边界文档。

**Behavior:**

- 真实浏览器首次打开 LAN Server 时只能看到配对门禁，错误配对不进入工作台，正确配对后 Cookie 驱动 HTTP Snapshot 与 WebSocket 正常工作；刷新保持 Session，注销清理工作台并回到门禁，另一个无 Cookie Browser Context 仍保持未认证。Fixture 使用独立动态端口和进程，不把固定测试配对码写入生产默认值。文档明确 `codexly start --lan [--session-ttl <duration>]` 的可信网络前提、默认 `24h`、合法单位与范围、仅绝对过期且不续期、HTTP 明文限制、终端配对流程、默认 Loopback 行为、匿名路由和 Server 统一认证边界。

**Stop Conditions:**

- 如果 LAN E2E 通过 `page.route()` 伪造 Access API 或 Cookie，停止并改用真实 Fastify Server 验证。
- 如果 LAN Fixture 与现有 App Shell Worker 共享可变 Session、端口或 Runtime 状态，停止并拆分为独立进程。
- 如果文档把该模式描述为加密、安全远程访问或互联网暴露能力，停止并修正为可信局域网基础访问控制。

- [x] **Task Status:** completed

Run: `pnpm build && pnpm exec playwright test tests/e2e/lan-access.spec.ts`

Expected: 错误/正确配对、Cookie 刷新、真实 HTTP/WS、独立 Browser Context 和注销失效的端到端场景全部通过。

### Task 6: 执行完整门禁与安全回归审计

**Files:**

- Verify: `src/**/*.ts`
- Verify: `packages/protocol/src/**/*.ts`
- Verify: `packages/client/src/**/*.ts`
- Verify: `packages/server/src/**/*.ts`
- Verify: `apps/web/src/**/*.ts`
- Verify: `apps/web/src/**/*.tsx`
- Verify: `tests/e2e/**/*.ts`
- Verify: `README.md`
- Verify: `docs/**/*.md`
- Verify: `.superwork/spec/**/*.md`
- Modify: `.superwork/plans/2026-08-04-trusted-lan-pairing-access.md`

**Interfaces:**

- Consumes: Task 1 至 Task 5 的 Access 协议、Server、CLI、Web、E2E 和文档产物。
- Produces: 通过格式、Lint、依赖架构、单元测试、性能测试、类型、构建、包校验和完整 Playwright 的可交付工作树。

**Behavior:**

- 运行完整门禁并进行静态安全审计：确认配对码不存在于 URL、环境变量、日志、持久层和浏览器存储；确认未认证 allowlist 只有批准的静态/健康/Access 入口；确认所有业务 HTTP 与 WS 路由都位于统一 Hook 后；确认 Local 默认监听、LAN 显式监听、`--session-ttl` 解析边界、Session 仅绝对过期且请求不续期、Cookie 属性、Session 有界清理、`no-store` 和安全响应头与文档一致。只有观察到全部证据后才把各 Task Status 更新为 `completed`。

**Stop Conditions:**

- 如果 `pnpm check` 或 `pnpm test:e2e` 出现失败，保留首个可复现命令和错误，不绕过门禁、不降低断言。
- 如果审计发现配对码或 Session 泄漏、未保护业务路由、跨 Origin 放行或默认非 Loopback 监听，停止交付并返回对应任务修复。
- 如果失败被确认来自无关既有问题，记录完整证据并请求用户决定，不修改无关模块。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全部项目门禁和完整浏览器套件退出码为 0，静态审计未发现凭据泄漏、未认证业务路由或默认暴露回归。
