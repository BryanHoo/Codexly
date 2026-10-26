# Feature Implementation Plan

**Goal:** 按需预检 Codex 配置，为 doctor 和两端启动失败补充结构化诊断。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 全局约束。
- `.superwork/spec/provider-codex/backend/index.md` — Codex 适配边界。
- `.superwork/spec/root/backend/index.md` — CLI 延迟启动。
- `.superwork/spec/desktop/backend/index.md` — 原生进程和日志。

**Architecture:** 使用 Codex 0.164.0 的一次性命令；Node 供 doctor 和 Web 共用，Rust 保持相同契约并复用跨端测试样本。成功启动不预检。自动诊断只在握手失败且原进程清理后执行，诊断不可用时保留原错误。

**Tech Stack:** TypeScript、Rust、Vitest、Tokio、pnpm。

## Global Constraints

- 正常启动不增加预检进程，不初始化额外线程存储、环境或插件。
- 不修改 Codex 上游源码，不注销账号或修改配置。
- 保留 CODEX_HOME、cwd、PATH 和客户端身份；超时 10 秒、单流输出最多 1 MiB。
- 关键执行边界添加中文注释；不把专有预检接口加入公开 Protocol。
- 公告：startup-config-20261026 / codex-startup-config。

### Task 1: 实现 Node 预检并接入 doctor

**Files:**

- Create: `packages/provider-codex/src/startup-config.ts`
- Test: `packages/provider-codex/src/startup-config.test.ts`
- Create: `packages/provider-codex/test/fixtures/startup-config.json`
- Modify: `packages/provider-codex/src/index.ts`
- Modify: `src/cli-command.ts`
- Create: `src/cli-doctor.ts`
- Modify: `src/cli-command-options.ts`
- Modify: `src/cli-command.test-support.ts`
- Test: `src/cli-command-start.test.ts`

**Interfaces:**

- Consumes: app-server --print-startup-config 的 appServerVersion/configRequirements 或 error JSON。
- Produces: readCodexStartupConfig 与 CodexStartupConfigError，doctor 输出配置状态并在配置错误时返回 1。

**Behavior:**

- 非零退出仍优先解析 stdout 结构化错误，展示 reason/filePath/line/column/detail；无效输出、超时和启动失败不得误报成功。
- doctor 在数据库前执行预检，并且不启动常驻 app-server。

**Stop Conditions:**

- 上游 JSON 契约与标签源码不一致时先修正计划。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/startup-config.test.ts src/cli-command-start.test.ts`

Expected: 预检和 doctor 回归全部通过。

### Task 2: 为 Web 和桌面握手失败补充诊断

**Files:**

- Modify: `packages/provider-codex/src/app-server-process.ts`
- Test: `packages/provider-codex/src/app-server-process.test.ts`
- Modify: `packages/provider-codex/test/fixtures/fake-app-server.mjs`
- Create: `desktop/src-tauri/src/infrastructure/codex/startup_config.rs`
- Create: `desktop/src-tauri/src/infrastructure/codex/startup_config_tests.rs`
- Modify: `desktop/src-tauri/src/infrastructure/codex/mod.rs`
- Modify: `desktop/src-tauri/src/infrastructure/codex/process.rs`

**Interfaces:**

- Consumes: Task 1 的预检命令和共享样本、现有握手和错误日志链。
- Produces: 启动失败错误附带配置定位，预检成功或不可用仍返回原始错误。

**Behavior:**

- 仅握手失败后清理原进程再执行一次有界预检；成功启动不触发预检。
- Rust 复用后台进程选项及 PATH，诊断信息沿现有错误链进入脱敏日志。

**Stop Conditions:**

- 需要改变公开 UI/IPC 契约或引入新依赖时先修正计划。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/app-server-process.test.ts && cargo test --manifest-path desktop/src-tauri/Cargo.toml startup_config --all-features --locked`

Expected: Node 和 Rust 覆盖诊断、输出限制与正常启动无额外调用。

### Task 3: 记录使用方式并完成范围验证

**Files:**

- Modify: `docs/faq.md`
- Modify: `CHANGELOG.md`
- Modify: `.superwork/spec/provider-codex/backend/index.md`

**Interfaces:**

- Consumes: 已完成的 doctor 与启动失败诊断。
- Produces: 可复现的排查说明及验证记录。

**Behavior:**

- 说明 TOML、组织策略定位、失败后诊断和不会自动修复或注销。
- 执行相关测试、类型检查、静态检查、架构检查、Schema 检查和 Rust 检查。

**Stop Conditions:**

- 环境缺失导致必需检查无法运行时记录准确阻塞。

- [x] **Task Status:** completed

Run: `pnpm typecheck && pnpm lint && pnpm lint:architecture && pnpm codex:schema:check`

Expected: 检查通过且文档与实现一致。

## Evidence Ledger

- Task 1 RED：定向 Vitest 发现预检模块缺失、doctor 配置错误仍返回成功。
- Task 1 GREEN：2026-10-26，根目录执行计划定向 Vitest，2 文件 21 测试通过（exit 0）；依赖与锁文件未变。

- 静态检查发现 CLI 主文件超出 500 行限制，因此将 doctor 与所需依赖接口提取到独立模块；属于原有行为的保持性重构。

- 真实二进制校验修正：Codex config TextRange 是 **1-based**，两端直接保留行列；先以真实样本重现偏移失败，再修正并复测。构建后的 doctor 在损坏 TOML 下返回 1、显示 `configLoad` 和 `config.toml:1:10`，未执行 SQLite。
- 简化审查：changed，将 doctor 从接近 500 行的 CLI 主文件独立提取；重构后的类型、静态检查和 Provider/CLI 572 项测试通过。
- 规范决策：update，更新既有 Provider backend 索引；分类器错误建议新建 shared 层，与仓库实际分层不符，未采纳其路径。

- Task 2 最终 GREEN：Node Provider/CLI 572 测试通过；Rust 全特性测试 790+6 通过、9 忽略，新增 5 项预检回归均通过，Clippy 无警告。桌面预检沿用正式握手历史身份 `codeagent`，Web 沿用 `codexly`。
- 最终全量验证：根 `pnpm test` 3637 通过、28 跳过；`pnpm typecheck`、`pnpm lint`、`pnpm lint:architecture`（仅既有 sqlite-journal.d.ts 孤立声明警告）、`pnpm codex:schema:check`、`pnpm format:check` 通过。依赖与锁文件未修改。
- 构建与发布验证：`pnpm build`、`pnpm bundle:check`、`pnpm package:check` 通过；桌面 Tauri 约束 65 通过、1 平台跳过，500 行限制检查通过。
- macOS 真实 Codex 0.164.0：空配置预检返回正确版本及有效要求，目录仅产生官方临时目录；损坏 TOML 的构建产物 doctor 返回 1 且在 SQLite 前停止。
- Release 性能基线编译耗时较长。第二次 check:rust 的最终 Clippy/测试已通过，停止其等待锁的重复性能编译，等待首次性能基线结果；此后改动仅为预检客户端名及测试，不影响 6 项存储/搜索/图片基线的调用图及输入，可按证据政策复用。
- 未覆盖环境：Windows/Ubuntu 实机、实际组织策略网络故障（使用上游一致的结构化样本验证）、无需界面变更的浏览器 E2E 未运行。

- 最终性能证据：首次 `pnpm --dir desktop check:rust` 退出 0；6 项 Release 基线全部通过，编译 6m10s、执行 27.06s。最后仅调整预检客户端身份与测试，不影响这些基线；按上述调用图独立性复用。最终 Clippy、全特性 790+6 测试来自第二次检查，已覆盖最终 Rust 代码。第二次重复的性能步骤主动终止（143），不计为新的通过结果。
- Task 3 completed：文档、规范与计划已同步；复用本轮有效的全量测试、构建、包校验及性能证据，最终格式和 diff 空白检查通过。Windows/Ubuntu 实机留待对应平台 CI。
