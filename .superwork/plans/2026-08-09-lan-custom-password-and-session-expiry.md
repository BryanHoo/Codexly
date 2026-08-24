# Feature Implementation Plan

**Goal:** 允许 LAN 模式使用用户提供的高强度访问密码，并把固定 Session 有效期上限扩展到 180 天。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包变更、验证命令和安全边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — 定义 LAN CLI、进程内凭据与 Session 生命周期。
- `.superwork/spec/backend/quality-guidelines.md` — 定义 LAN 凭据、限流、Cookie 和日志安全要求。
- `.superwork/spec/frontend/component-guidelines.md` — 定义未认证 LAN 门禁及凭据局部状态。
- `.superwork/spec/frontend/quality-guidelines.md` — 定义 LAN Access 浏览器验证范围。
- `.superwork/spec/shared/quality-guidelines.md` — 定义 Access 协议与 Client、Server、Web 同步约束。

**Architecture:** 在根 CLI 的 LAN 参数边界校验自定义密码和 Session TTL；未提供密码时继续生成启动期高熵凭据，提供时只以内存参数传入 Server 且不回显。Server 继续复用固定期限 Session 和常量时间凭据比较。Web 将配对码文案统一为访问密码，不改变严格 Access 协议结构。

**Tech Stack:** TypeScript、Node.js 24、Vitest、React、Playwright、pnpm。

## Global Constraints

- 自定义密码只允许与 `--lan` 同时使用，长度必须为 16 至 128 个字符，并同时包含大写字母、小写字母、数字和符号。
- 自定义密码不得写入终端输出、结构化日志、环境变量、URL、浏览器存储或持久层；只允许通过 CLI 参数解析后的进程内对象传给 Server。
- 未提供自定义密码时继续使用至少 128 bit 熵的随机凭据，不保留旧的 30 天 Session 上限。
- Session 继续使用签发时固定的绝对期限且请求不续期，合法范围为 `1m` 至 `180d`。
- 不改变 `PairAccessRequest = { code: string }`、Cookie 属性、限流和未认证路由边界。

### Task 1: 扩展 LAN 凭据与有效期校验

**Files:**

- Modify: `src/lan-access.ts`
- Test: `src/lan-access.test.ts`

**Interfaces:**

- Consumes: `parseSessionTtl(value: string)` 与用户提供的 LAN 密码字符串。
- Produces: `parseSessionTtl(value)` 支持 `1m` 至 `180d`。
- Produces: `validateLanPassword(value: string): void`

**Behavior:**

- 先用测试证明 `180d` 可解析、`181d` 与溢出值被拒绝；再证明满足全部强度规则的密码通过，长度不足、过长或缺少任一字符类型的密码在任何 Runtime 资源启动前被拒绝。

**Stop Conditions:**

- 如果强度规则不能在 CLI 边界确定性执行，或会改变自动生成凭据的 128 bit 熵保证，则停止并重新确认接口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run src/lan-access.test.ts`

Expected: LAN helper 的有效期边界和自定义密码强度测试全部通过。

### Task 2: 接入 LAN 自定义密码启动参数

**Files:**

- Modify: `src/cli-command.ts`
- Test: `src/cli-command.test.ts`

**Interfaces:**

- Consumes: `validateLanPassword(value: string): void`
- Consumes: `generateLanPairingCode()` 与现有 `CodexlyAccessOptions`。
- Produces: `codexly start --lan [--lan-password <password>] [--session-ttl <duration>]`。
- Produces: `CodexlyAccessOptions = { pairingCode: string; sessionTtlMs: number }`，其中 `pairingCode` 为自定义密码或自动生成凭据。

**Behavior:**

- 增加 `--lan-password <password>` 帮助和解析；自定义密码只允许与 `--lan` 组合，合法值直接作为进程内 Access 凭据且不调用随机生成器、不在终端回显，未提供时继续生成并显示随机凭据。LAN Session 接受最长 `180d`，所有非法组合和弱密码在创建数据库、Provider 或 Server 前失败。

**Stop Conditions:**

- 如果自定义密码进入环境变量、终端输出、日志或持久化，立即停止并修复泄漏。
- 如果默认 Local 启动或未提供自定义密码的 LAN 启动行为发生非预期变化，停止并恢复边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run src/cli-command.test.ts`

Expected: CLI 参数矩阵、180 天边界、凭据选择、输出脱敏和资源启动顺序测试全部通过。

### Task 3: 更新 LAN 用户文案与工程约束

**Files:**

- Modify: `README.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/backend/quality-guidelines.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `apps/web/src/i18n/locales/zh-CN/common.ts`
- Modify: `apps/web/src/i18n/locales/en/common.ts`
- Test: `apps/web/src/features/access/pairing-gate.test.tsx`
- Test: `tests/e2e/lan-access.spec.ts`

**Interfaces:**

- Consumes: 现有 `PairingGate` 与 i18n `access.*` 文案键。
- Produces: 对随机凭据和自定义密码都准确的“访问密码”界面及文档。
- Produces: LAN 自定义密码、180 天上限和不回显规则的持久工程规范。

**Behavior:**

- 将用户可见的配对码表述统一为访问密码，保持表单密码输入、局部状态和通用失败提示；README 记录完整命令、强度规则、Shell 引号要求、默认随机凭据、最长 `180d` 与绝对不续期语义；工程规范同步新逻辑并移除 30 天旧约束。

**Stop Conditions:**

- 如果文案更新要求扩展 Access 协议或让浏览器获知服务端凭据类型，停止该扩展并保持通用访问密码表述。
- 如果文档示例包含真实 Secret 或暗示 LAN HTTP 已加密，立即停止并修正。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/access/pairing-gate.test.tsx`

Expected: 中英文访问门禁文案及相关组件行为测试通过，文档与规范不再包含 30 天上限或仅支持随机配对码的陈述。

### Task 4: 完成全量质量验证

**Files:**

- Modify: `.superwork/plans/2026-08-09-lan-custom-password-and-session-expiry.md`
- Test: `src/lan-access.test.ts`
- Test: `src/cli-command.test.ts`
- Test: `apps/web/src/features/access/pairing-gate.test.tsx`
- Test: `tests/e2e/lan-access.spec.ts`

**Interfaces:**

- Consumes: 完成后的 LAN CLI、Access Server、Web 门禁与工程文档。
- Produces: 全量门禁结果和静态 Secret 泄漏审计证据。

**Behavior:**

- 运行 `pnpm check` 和 LAN Access E2E，检查自定义密码不出现在输出、环境变量、日志、URL、持久化和浏览器状态；确认 Local 默认监听、LAN 强密码校验、随机凭据回退、`180d` 边界、固定 Session 期限、Cookie 与限流行为保持一致。

**Stop Conditions:**

- 如果任一质量门禁或 LAN E2E 失败，停止交付并返回对应任务修复。
- 如果发现 Secret 泄漏、未认证业务路由或 Session 续期，立即停止并修复安全回归。

- [ ] **Task Status:** pending

Run: `pnpm check && pnpm test:e2e -- tests/e2e/lan-access.spec.ts`

Expected: 全量质量门禁与真实 LAN 浏览器流程全部通过，静态审计未发现自定义密码泄漏。
