# 清理旧执行入口与 ACP 会话兼容

**Goal:** 两端仅从 ACP 发现和运行 Agent，按能力恢复已绑定的会话。

**Suggested Spec Reads:**

- `.superwork/spec/core/shared/index.md` 约束会话、历史缓存与目录。
- `.superwork/spec/desktop/backend/index.md` 约束 IPC 和权限。

**Architecture:** 两端沿用共享 ACP 连接、安装目录和任务存储。

**Tech Stack:** TypeScript、React、Tauri、Vitest

## Global Constraints

- Web 与桌面共用 ACP 执行与发现逻辑，历史保留按协商能力决定。

### Task 1: 按 ACP 能力恢复和配置会话

**Files:**

- Create: `packages/provider-acp/src/connection-backpressure.ts`
- Modify: `packages/provider-acp/src/connection.ts`, `packages/provider-acp/src/history-use.ts`, `packages/provider-acp/src/session-loading.ts`, `packages/provider-acp/src/session-options.ts`, `packages/provider-acp/src/session-metadata.ts`
- Test: `packages/provider-acp/src/connection-v1.test.ts`

**Interfaces:**

- Consumes: ACP v1 initialize、session/load、session/resume。
- Produces: 独立的续聊与历史重放能力。

**Behavior:**

- 仅声明 resume 的 Agent 可用原有 session ID 继续，缓存保留原正文。仅公布 modes 的 Agent 可在共用会话设置切换模式。

**Stop Conditions:**

- 显式重放不能把无重放的会话当作空历史。

- [x] **Task Status:** completed

Run: `pnpm test packages/provider-acp`

Expected: 单独声明 resume 或 load 的 Agent 均按公布能力处理会话，v1 modes 支持切换和实时更新。

### Task 2: 清理旧生产入口及发布约束

**Files:**

- Modify: `packages/ui/src/core/agent-runtime-setup-gate.tsx`, `apps/web/src/features/provider-connection/components/engine-setup-gate.tsx`, `desktop/src/features/runtime/components/engine-setup-gate.tsx`, `desktop/src-tauri/build.rs`, `desktop/src-tauri/src/lib.rs`, `desktop/src-tauri/src/application/mod.rs`, `desktop/src-tauri/permissions/window-command-sets.toml`, `desktop/tests/webview/mock-runtime.ts`, `.github/workflows/ci.yml`, `.gitignore`, `.superwork/config.json`
- Delete: `apps/web/src/features/provider-connection/components/legacy-engine-setup-gate.tsx`, `desktop/src/features/runtime/components/legacy-engine-setup-gate.tsx`, `desktop/src/features/runtime/components/engine-setup-gate.test.ts`, `desktop/src-tauri/src/application/engine_setup.rs`
- Create: `packages/server/src/diagnostic-archive.ts`, `packages/server/src/diagnostic-archive.test.ts`
- Delete: `packages/server/src/codex-diagnostics.ts`, `packages/server/src/codex-diagnostics.test.ts`
- Modify: `packages/core/src/agent-provider.ts`, `packages/core/src/npm-registry.ts`, `src/npm-registry.ts`, `packages/server/src/app.ts`, `packages/client/src/http-client.ts`, `desktop/src-tauri/src/application/diagnostic_commands.rs`, `.github/workflows/desktop-quality.yml`
- Test: `tests/ci-quality-gates.test.ts`, `desktop/tests/browser/acp-engine-setup.browser.test.tsx`, `packages/provider-acp/src/registry-release.test.ts`, `packages/client/src/http-client-diagnostics.test.ts`, `packages/server/src/app-diagnostics.test.ts`, `src/npm-registry.test.ts`, `tests/e2e/app-shell-diagnostics.spec.ts`

**Interfaces:**

- Consumes: ACP Agent catalog。
- Produces: 两端共享的 ACP 首次启动流程及旧依赖回归检查。

**Behavior:**

- 移除旧启动分支及对应 IPC，诊断导出只收集应用数据，更新器探测应用自己的包，发布门禁按当前 ACP 安装目录验证。

**Stop Conditions:**

- 目录无可用 Agent 时仍可打开设置并添加 Agent。

- [x] **Task Status:** completed

Run: `pnpm test tests/ci-quality-gates.test.ts`

Expected: 发布验证确认旧执行程序和 SDK 未进入应用依赖与启动入口。

## 验证记录

- 两项新增会话回归先分别复现 resume 能力缺失及 modes 丢失，修复后随 362 项定向测试通过。
- macOS ARM64 从官方目录安装 Codex、Claude、OpenCode、Gemini、Qwen Code 和 GitHub Copilot，ACP v1 握手通过。真实握手使用隔离配置目录。会话发送、恢复、权限和历史通过协议测试与宿主测试验证。
- 两端类型检查和生产构建通过。编译宿主 10 项，桌面单元 841 项，启动与目录浏览器 20 项，Web 诊断端到端 3 项通过。Web 交付包与体积校验通过。桌面 Rust 格式、Clippy、全特性测试和 Tauri 权限检查通过。
- 限制并发后，根 Vitest 全量 3650 项通过，19 项按条件跳过。Web 性能测试、桌面 Rust 性能及静态资源体积预算通过。全仓 lint 和 format 仍受未改动文件及本地协作记录影响，变更文件格式检查与 diff 检查通过。真实账号连续对话及 Windows、Ubuntu 真机验收未覆盖。

## 静态检查补验

- 修复协议入口行数、Git 测试路径的数值插值及 ACP 测试文件排版。仅桌面浏览器测试使用的缓存监听移入该测试。Prettier 排除协作工具生成的本地 JSON 记录。
- 根目录 lint、格式、架构检查及 Web 和桌面类型检查通过。桌面 lint 和 Rust 格式检查通过。125 项定向测试和 6 项桌面浏览器测试通过。协议公共入口的 820 个导出名称逐一核对一致。
