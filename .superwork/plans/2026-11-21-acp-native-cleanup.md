# Feature Implementation Plan

**Goal:** 清理 ACP 迁移后没有调用者的原生执行器和交付步骤，保留有独立用途的历史读取与升级兼容。

**Suggested Spec Reads:**

- `.superwork/spec/root/backend/index.md` 约束 CLI 装配和发布验证。
- `.superwork/spec/guides/cross-layer-thinking-guide.md` 约束两端的历史身份和存储。
- `.superwork/spec/desktop/backend/index.md` 约束桌面 IPC 与发布。

**Architecture:** 由共享 ACP 宿主和 Agent 目录负责运行及安装。应用构建仅接入仍有调用者的只读与应用能力。

**Tech Stack:** TypeScript、pnpm、Vitest、Bun、Tauri。

## Global Constraints

- Web 和桌面共用 ACP 会话机制，保持迁移后的任务身份与历史可读。
- 通过 pnpm 更新工作区锁文件，关键执行边界使用中文注释。

### Task 1: 清理旧原生宿主的装配与交付

**Files:**

- Modify: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `packages/server/package.json`, `packages/server/tsconfig.json`, `tsconfig.json`, `tsconfig.node.json`, `tsup.config.ts`, `vitest.config.ts`, `dependency-cruiser.config.cjs`
- Delete: `packages/provider-claude`, `src/cli-commit-generation-runtime.test.ts`, `src/cli-engine-runtime.ts`, `src/cli-engine-runtime.test.ts`, `src/cli-generation-defaults.ts`, `src/cli-local-catalog.ts`, `src/cli-lazy-codex-client.ts`, `src/cli-lazy-codex-client.test.ts`, `src/claude-version.ts`, `tools/build-claude-host.mjs`, `tools/claude-native-package.mjs`, `tools/codex-native-package.mjs`, `tools/claude-host.test.mjs`, `tools/claude-host-transport.test.mjs`, `tools/claude-runtime-distribution.test.mjs`, `tools/measure-claude-history-io.mjs`
- Modify: `packages/provider-codex/package.json`, `packages/provider-acp/src/official-agent.ts`, `packages/provider-acp/src/index.ts`, `tools/verify-codex-schema.mjs`
- Modify: `src/app-update.ts`, `src/app-update.test.ts`, `src/cli-server-input.ts`, `src/cli-command.test-support.ts`, `src/cli-command-start.test.ts`, `src/cli-acp-entry.test.ts`, `src/cli-claude-start.test.ts`, `src/cli-command-lan.test.ts`, `src/cli-command-managed.test.ts`, `src/cli-command-port.test.ts`, `src/cli-command-shutdown.test.ts`, `src/cli-command-update.test.ts`, `src/cli-local-catalog.test.ts`, `src/cli-multi-instance.test.ts`

**Interfaces:**

- Consumes: `CliDependencies.createAcpRuntime` 与 ACP 桌面宿主。
- Produces: 直接依赖图和 CLI 测试装配只包含仍使用的入口。

**Behavior:**

- ACP 启动、关闭和目录迁移照常工作。根包移除直接原生依赖，兼容测试只在 Codex 工作区访问固定版本。

**Stop Conditions:**

- 查明发现的运行时消费者后才删除对应实现。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run src/*.test.ts --maxWorkers 4`

Expected: CLI、ACP 及应用更新测试通过。

### Task 2: 更新 ACP 交付和回归覆盖

**Files:**

- Modify: `packages/provider-acp/README.md`, `packages/provider-acp/src/turn-persistence.test.ts`, `desktop/docs/provider-runtime-management.md`
- Modify: `.github/workflows/desktop-quality.yml`, `.github/workflows/release.yml`, `tests/ci-quality-gates.test.ts`, `tools/runtime-licenses/README.md`, `.superwork/config.json`, `.superwork/spec/index.md`, `.superwork/spec/guides/index.md`, `.superwork/spec/guides/network-proxy.md`, `.superwork/spec/root/backend/index.md`, `docs/global-search.md`
- Delete: `tools/claude-build-target.mjs`, `tools/claude-build-target.test.mjs`, `tools/runtime-licenses/codex-LICENSE`, `tools/runtime-licenses/codex-NOTICE`
- Create: `tools/acp-build-target.mjs`, `tools/acp-build-target.test.mjs`
- Modify: `tools/desktop-runtime-bundle.test.mjs`, `tools/acp-runtime-layout.mjs`, `tools/acp-runtime-layout.test.mjs`
- Modify: `tools/build-acp-host.mjs`, `tools/build-acp-runtime.mjs`, `tools/build-desktop-runtime.mjs`, `tools/test-acp-host.mjs`
- Delete: `.superwork/spec/provider-claude/backend/index.md`, `desktop/src/platform/tauri/claude-runtime-manager.ts`, `desktop/src/platform/tauri/claude-runtime-manager.test.ts`
- Modify: `desktop/src-tauri/build.rs`, `desktop/src-tauri/src/lib.rs`, `desktop/src-tauri/permissions/window-command-sets.toml`, `desktop/src-tauri/src/application/claude_commands.rs`, `.superwork/spec/core/shared/index.md`

**Interfaces:**

- Consumes: `pnpm test:acp-host`、ACP v2 共享 Provider 与 Tauri 目标三元组。
- Produces: 发布门槛覆盖共享 ACP Provider，宿主验证覆盖目标解析。

**Behavior:**

- 独立宿主编译与发布测试使用同一套 ACP 构建工具，桌面命令清单和权限移除旧 Claude 准备入口。

**Stop Conditions:**

- 若目标平台解析或 CI 测试分组退化，修复后继续验证。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/ci-quality-gates.test.ts && pnpm test:acp-host`

Expected: 发布门槛测试与编译后宿主测试通过。

## 验证记录

- 安装和静态门槛通过，包括冻结锁文件重装、类型检查、依赖架构、供应链审计和 Codex 兼容 Schema。
- CLI 与发布门槛定向重跑通过 142 项，会话归属与只读历史用例通过。共享 ACP Provider 通过 286 项用例，覆盖会话恢复、权限、事件和附件。
- 发布门槛与 Schema 用例通过 16 项。独立宿主通过 12 项测试。重新构建的 macOS arm64 桌面安装资源通过目录和摘要检查，仅包含独立 ACP 宿主、清单和两份许可。
- Web 构建、Bundle 预算和真实 npm 包检查通过。Chromium 的 ACP 目录和配置流程通过 3 项测试。桌面 Web 门槛通过，单元测试共 839 项。
- 根全量 Vitest 通过 4181 项，模型目录缓存用例在并行运行时超时，单独运行所在文件通过全部 10 项。Web 性能套件降低并发后通过 15 项。
- Rust Clippy 与格式检查通过。默认并发下原生旧协议背压用例超时，单独运行及限制为两个线程的完整套件均通过，后者包含 942 项库测试及 6 项集成测试。Rust Release 性能基线通过 6 项。

当前保留已确认有用途的 Codex 外部写入占用只读回退、旧设置读取和 Windows 安装升级清理。
