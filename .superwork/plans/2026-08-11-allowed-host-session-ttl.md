# Feature Implementation Plan

**Goal:** 支持显式反向代理域名白名单，并让 LAN 会话仅在配置 `--session-ttl` 时过期。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束 CLI、测试、包边界与验证命令。
- `.superwork/spec/backend/directory-structure.md` — 明确根 CLI 与 Server 交付层职责。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 LAN Session 生命周期和关闭清理。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Host 白名单、Origin 同源与 Cookie 安全。

**Architecture:** 根 CLI 负责解析并提前校验可重复的 `--allowed-host` 与可选 `--session-ttl`；Server 交付层仅接受精确规范化域名白名单，继续默认允许 Loopback 和 LAN 数字 IP。Session 服务用可空绝对期限区分永久会话与定时会话，HTTP Cookie 和 WebSocket 定时器按同一期限语义装配。

**Tech Stack:** TypeScript、Fastify、Vitest、pnpm。

## Global Constraints

- 保留现有 Loopback 与 LAN 数字 IP Host 规则，只额外允许用户显式配置的精确域名；不接受通配符、URL、端口或任意 Host 回退。
- `--allowed-host` 可重复使用，匹配时忽略 DNS 域名大小写，但不读取 `X-Forwarded-Host`。
- `--session-ttl` 接受正整数 `ms | s | m | h | d`，删除 `1m` 至 `180d` 业务限制；不配置时会话在当前 Server 进程内永不过期。
- 有期限会话保持固定绝对截止时间且请求不续期；所有 Session 仍在 Server 关闭时清空。
- 新增或修改关键校验和生命周期逻辑时添加简短、清晰的中文注释。

### Task 1: 实现精确 Host 白名单与可永久 Session

**Files:**

- Modify: `packages/server/src/access-control.ts`
- Modify: `packages/server/src/server-delivery.ts`
- Modify: `packages/server/src/routes/access-routes.ts`
- Modify: `packages/server/src/routes/event-routes.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/src/access-control.test.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `CodexlyAccessOptions`, `ConfigureServerDeliveryOptions`, `AccessSessionService.expiresAt`
- Produces: `normalizeAllowedHost`, 精确 `allowedHosts` 请求校验、`number | null | undefined` Session 期限语义

**Behavior:**

- 先用失败测试证明只有显式白名单域名通过 Host 与同源 Origin 校验，未配置域名仍拒绝外部主机名；证明永久会话不设置持久 Cookie 截止时间、不安排 WebSocket 过期，而显式 TTL 会话保持既有固定过期行为。

**Stop Conditions:**

- 如果永久期限无法与无效 Session 明确区分，停止并调整服务接口，禁止通过认证旁路实现。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/access-control.test.ts packages/server/src/app.test.ts`

Expected: Host、Origin、配对 Cookie、HTTP Session 与 WebSocket 生命周期测试全部通过。

### Task 2: 更新 CLI 参数与启动装配

**Files:**

- Modify: `src/cli-command-options.ts`
- Modify: `src/cli-command.ts`
- Modify: `src/lan-access.ts`
- Test: `src/cli-command.test.ts`
- Test: `src/lan-access.test.ts`

**Interfaces:**

- Consumes: `parseCommandOptions`, `parseSessionTtl`, `normalizeAllowedHost`
- Produces: `ParsedCommandOptions.allowedHosts`, 可选 `CodexlyAccessOptions.sessionTtlMs`, `CreateServerInput.allowedHosts`

**Behavior:**

- 先用失败测试证明 `--allowed-host code.example.com` 可重复传递并在 Runtime 创建前拒绝通配符、URL、端口和非法域名；证明未配置 `--session-ttl` 时 LAN Access 不携带期限，显式配置时支持小于一分钟及超过 180 天的正整数时长。

**Stop Conditions:**

- 如果 Server 公开入口无法提供统一域名规范化函数，停止并重新确认校验归属，避免 CLI 与 Server 产生不同匹配语义。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run src/cli-command.test.ts src/lan-access.test.ts`

Expected: CLI 参数、启动装配与任意正时长解析测试全部通过。

### Task 3: 同步用户文档与工程规范

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/backend/quality-guidelines.md`

**Interfaces:**

- Consumes: 已实现的 `--allowed-host` 与 `--session-ttl` CLI 行为
- Produces: 英文/中文使用说明与持久工程约束

**Behavior:**

- 记录反向代理精确域名白名单示例、安全边界、可重复参数，以及 Session 默认永不过期和显式正时长配置语义，删除旧 `24h` 默认值与 `1m` 至 `180d` 限制。

**Stop Conditions:**

- 如果文档描述与已通过测试的参数语法或 Cookie 行为不一致，停止并以实现测试为准修正文档。

- [x] **Task Status:** completed

Run: `pnpm exec prettier --check README.md README.zh-CN.md .superwork/spec/backend/runtime-lifecycle.md .superwork/spec/backend/quality-guidelines.md`

Expected: 文档格式检查通过，且中英文说明与工程规范一致。
