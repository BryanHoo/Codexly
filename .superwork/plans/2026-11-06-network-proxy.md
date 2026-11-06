# Feature Implementation Plan

**Goal:** 实现跨端完整网络代理配置及执行。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 全局约束
- `.superwork/spec/guides/cross-layer-thinking-guide.md` — 跨端存储及接口
- `.superwork/spec/provider-claude/backend/index.md` — 共享宿主
- `.superwork/spec/desktop/backend/index.md` — 原生网络与进程

**Architecture:** 共享配置/表单，Node 与 Rust 适配；重启生效。

**Tech Stack:** TypeScript、React、Fastify、Undici、proxy-chain、Rust、reqwest、Tauri。

## Global Constraints

- 两端共用 ~/.codexly；关键逻辑中文注释；TLS 校验、连接池复用、本地通信直连。
- 用户已授权移除已完成的历史发布和测试登记。

### Task 1: 配置与Node出口

**Files:**

- Create or modify: `packages/protocol/src/network-proxy.ts`
- Create or modify: `packages/provider-claude/src/network-proxy.ts`
- Create or modify: `packages/provider-claude/src/network-proxy.test.ts`
- Create or modify: `src/cli-command.ts`
- Create or modify: `packages/provider-claude/src/host.ts`

**Interfaces:**

- Consumes: 应用数据目录和继承环境
- Produces: NetworkProxySettings、统一出口与脱敏配置

**Behavior:**

- 配置与Node出口，保证配置生效及错误不直连。

**Stop Conditions:**

- 公开契约不明确时修订计划。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-claude/src/network-proxy.test.ts`

Expected: 检查通过。

### Task 2: 设置传输与共用界面

**Files:**

- Create or modify: `packages/server/src/network-proxy-routes.ts`
- Create or modify: `packages/client/src/network-proxy.ts`
- Create or modify: `packages/ui/src/core/network-proxy-settings.tsx`
- Create or modify: `apps/web/src/features/settings/components/network-proxy-settings.tsx`
- Create or modify: `desktop/src/features/settings/components/network-proxy-settings.tsx`

**Interfaces:**

- Consumes: NetworkProxySettings
- Produces: 统一出口与脱敏配置

**Behavior:**

- 设置传输与共用界面，保证配置生效及错误不直连。

**Stop Conditions:**

- 公开契约不明确时修订计划。

- [x] **Task Status:** completed

Run: `pnpm typecheck`

Expected: 检查通过。

### Task 3: 桌面原生出口

**Files:**

- Create or modify: `desktop/src-tauri/src/infrastructure/network_proxy.rs`
- Create or modify: `desktop/src-tauri/src/application/network_proxy_commands.rs`
- Create or modify: `desktop/src-tauri/src/infrastructure/codex/process.rs`
- Create or modify: `desktop/src-tauri/src/application/claude_host.rs`

**Interfaces:**

- Consumes: NetworkProxySettings
- Produces: 统一出口与脱敏配置

**Behavior:**

- 桌面原生出口，保证配置生效及错误不直连。

**Stop Conditions:**

- 公开契约不明确时修订计划。

- [x] **Task Status:** completed

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml network_proxy`

Expected: 检查通过。

## 最终证据与交接

共享协议/校验与表单；Node 设置文件、Undici 出口、SOCKS5 转接；HTTP 接口与 Client；Tauri 命令/ACL；Rust 原生请求、更新插件和引擎/Git 进程启动快照已实现。构建子路径同步补充到 TypeScript、Vitest 和 tsup。历史发布/测试登记按用户授权删除，其余暂停登记保留。

Simplification: no-change。平台仅保留传输及 reqwest 适配，复用共享 Node 网络实现与表单。

验证均从仓库根目录执行：

- `pnpm test`：4016 passed、13 skipped。后续系统环境快照与 doctor 入口修改由最终定向 21 项及代理/HTTP 接口 7 项覆盖，未重复整套测试。
- `pnpm --dir desktop check:web`：697 项单测通过；类型、lint、ACL/约束、现代/Legacy 构建和包体预算通过。
- 共享表单 Chromium/WebKit 两项通过；Ego Lite 390px 预览页面与正文同宽、保存/测试反馈可见。预览使用模拟传输，真实网络验证由传输测试完成。
- Node 真实 HTTP CONNECT/认证、SOCKS5 远端 DNS、网关失败不直连，以及 Rust HTTP 认证和 SOCKS5 远端 DNS 通过。
- `pnpm test:claude-host`：12 项通过，含实际编译宿主、SDK 会话和进程清理。
- `pnpm audit:prod`、`pnpm codex:schema:check`、发布测试（3项）、高亮测试（5项）、性能测试（16项）通过。
- 根 `pnpm check` 初次因自身本地公告格式停止，已修正；后续独立完成格式、lint、architecture、typecheck、Web/Node 构建、bundle 与 package 检查。构建子路径别名和打包故障诊断已修正并重新验证。
- Spec: create `.superwork/spec/guides/network-proxy.md`，导航可达，固化重启快照、Bun fetch、密码语义和不静默直连规则。
- 原生格式/Clippy/测试通过：812 项单元测试、6 项集成测试；9 项默认忽略测试保留；性能基线通过独立 Release 命令执行。
- `pnpm --dir desktop check:rust` 完整通过；Release 性能基线 6 项通过。

未运行全量 Web E2E、全量桌面浏览器套件及 Windows/Ubuntu 真机网络验证；本次新增范围以共享表单双浏览器、设置接口、真实代理传输和编译宿主验证。
