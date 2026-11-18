# Feature Implementation Plan

**Goal:** 将 ACP 固定双引擎改为按本机 CLI 检测与用户选择注册、按需安装和配置。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 跨端、共享、性能约束。
- `.superwork/spec/protocol/shared/index.md` — 身份与传输契约。
- `.superwork/spec/ui/shared/index.md` — 共用设置、保存和移动布局。
- `.superwork/spec/core/shared/index.md` — 稳定任务身份与懒启动。

**Architecture:** 共享 ACP 目录管理器负责本机发现、持久配置及安装；HTTP 与桌面宿主复用，运行时按原始 Agent 身份动态路由。内置 Codex/Claude 身份保留，新增 Agent 使用 acp: 前缀。安装与认证分开，CLI 原生凭据由 Agent 自行读取。

**Tech Stack:** TypeScript、TypeBox、React、Fastify、Tauri、Vitest、pnpm。

## Global Constraints

- Web 检测服务端电脑；macOS、Windows、Ubuntu 使用同一共享 Node 宿主逻辑。
- 冷读取不启动模型，不复制其他 Agent 凭据，安装失败不启用。
- 关键逻辑使用中文注释，任务身份不可因选择改变。
- 不提交 Git；并行登记 acp-agent-catalog-1114 / codex-acp-catalog。

### Task 1: 通用目录与按需执行

**Files:**

- Modify: `packages/core/src/acp-service.ts`
- Modify: `packages/core/src/catalog-search.ts`
- Modify: `packages/core/src/engine-router.ts`
- Modify: `packages/core/src/generation-defaults.ts`
- Create: `packages/protocol/src/acp-agent-catalog.ts`
- Modify: `packages/protocol/src/acp-scheduled-plan-schema.js`
- Modify: `packages/protocol/src/acp-service.ts`
- Modify: `packages/protocol/src/agent-engine.ts`
- Modify: `packages/protocol/src/application-preferences-schema.js`
- Modify: `packages/protocol/src/global-search.ts`
- Modify: `packages/protocol/src/project-settings.ts`
- Modify: `packages/provider-acp/package.json`
- Test: `packages/provider-acp/src/agent-catalog.test.ts`
- Create: `packages/provider-acp/src/agent-catalog.ts`
- Create: `packages/provider-acp/src/agent-executable.ts`
- Test: `packages/provider-acp/src/agent-installer.test.ts`
- Create: `packages/provider-acp/src/agent-installer.ts`
- Modify: `packages/provider-acp/src/agent-service.ts`
- Modify: `packages/provider-acp/src/application-runtime.ts`
- Test: `packages/provider-acp/src/config-preview.test.ts`
- Modify: `packages/provider-acp/src/config-preview.ts`
- Modify: `packages/provider-acp/src/default-config.ts`
- Modify: `packages/provider-acp/src/host-dispatch.ts`
- Modify: `packages/provider-acp/src/host-entry.ts`
- Modify: `packages/provider-acp/src/main.ts`
- Modify: `packages/provider-acp/src/migration.ts`
- Modify: `packages/provider-acp/src/native-connection.ts`
- Modify: `packages/provider-acp/src/official-agent.ts`
- Create: `packages/provider-acp/src/registry-snapshot.json`
- Test: `packages/provider-acp/src/runtime.test.ts`
- Modify: `packages/provider-acp/src/runtime.ts`
- Modify: `packages/provider-acp/src/session-initialization.ts`
- Modify: `packages/provider-acp/src/settings-store.ts`
- Modify: `packages/provider-acp/tsconfig.json`

**Interfaces:**

- Consumes: ACP Registry 分发与本机 PATH。
- Produces: AcpAgentCatalog、可持久 Agent 身份和启动配置。

**Behavior:**

- 无 CLI 不自动安装；检测已安装 CLI 后注册；用户可添加其他 Agent，安装去重、失败不保存。

**Stop Conditions:**

- 必须启动模型才能发现 Agent 时停止并修正设计。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-acp/src/agent-catalog.test.ts`

Expected: 发现、安装失败、持久化与自定义 Agent 用例通过。

### Task 2: 接入两端设置与启动

**Files:**

- Test: `apps/web/src/features/settings/components/global-settings-page.test.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-page.tsx`
- Modify: `desktop/src-tauri/src/application/acp_commands.rs`
- Modify: `desktop/src-tauri/src/application/acp_task_creation.rs`
- Modify: `desktop/src-tauri/src/application/claude_host.rs`
- Modify: `desktop/src-tauri/src/infrastructure/acp_runtime.rs`
- Modify: `desktop/src-tauri/src/infrastructure/acp_runtime_tests.rs`
- Modify: `desktop/src-tauri/src/infrastructure/local_catalog/acp_plan_validation.rs`
- Modify: `desktop/src-tauri/src/infrastructure/local_catalog/acp_scheduled_configs.rs`
- Modify: `desktop/src-tauri/src/infrastructure/local_catalog/acp_task_titles.rs`
- Modify: `desktop/src-tauri/src/infrastructure/local_catalog/application_preferences.rs`
- Modify: `desktop/src-tauri/src/infrastructure/local_catalog/operations.rs`
- Modify: `desktop/src-tauri/src/infrastructure/local_catalog/sidebar.rs`
- Modify: `desktop/src/features/settings/components/global-settings-page.tsx`
- Modify: `desktop/src/platform/tauri/acp-client.ts`
- Test: `desktop/tests/browser/acp-catalog.browser.test.tsx`
- Modify: `package.json`
- Test: `packages/client/src/http-client-acp.test.ts`
- Modify: `packages/client/src/http-client-acp.ts`
- Modify: `packages/frontend-core/src/acp-draft-engine.ts`
- Modify: `packages/frontend-core/src/conversation-export-collector.ts`
- Modify: `packages/frontend-core/src/engine-setup.ts`
- Modify: `packages/server/src/acp-scheduled-config-worker.js`
- Modify: `packages/server/src/acp-task-title-worker.js`
- Test: `packages/server/src/app-acp.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/global-settings-reader.ts`
- Modify: `packages/server/src/global-settings-writer.ts`
- Modify: `packages/server/src/local-catalog-worker.js`
- Modify: `packages/server/src/routes/acp-routes.ts`
- Modify: `packages/server/src/routes/context.ts`
- Create: `packages/ui/src/core/acp-catalog-settings.tsx`
- Modify: `packages/ui/src/core/acp-engine-settings-gate.tsx`
- Modify: `packages/ui/src/core/acp-engine-setup-gate.tsx`
- Modify: `packages/ui/src/core/acp-generation-settings.tsx`
- Modify: `packages/ui/src/core/acp-model-selector.tsx`
- Modify: `packages/ui/src/core/acp-settings-panel.tsx`
- Modify: `packages/ui/src/core/agent-engine-icon.tsx`
- Modify: `packages/ui/src/core/default-generation-settings.tsx`
- Modify: `packages/ui/src/core/engine-settings-gate.tsx`
- Modify: `pnpm-lock.yaml`
- Modify: `src/cli-acp-runtime.ts`
- Modify: `tools/acp-runtime-layout.mjs`
- Modify: `tools/build-acp-host.mjs`
- Modify: `tools/build-acp-runtime.mjs`
- Modify: `tools/build-desktop-runtime.mjs`

**Interfaces:**

- Consumes: AcpAgentCatalog、AcpAgentServices。
- Produces: 共享目录列表、安装/配置入口及 HTTP/IPC。

**Behavior:**

- 用户在 ACP 添加 Agent、编辑启动配置，已发现 Agent 自动进入可选列表；新旧 Agent 能按身份执行和恢复会话。

**Stop Conditions:**

- HTTP 与 IPC 不能使用相同配置和身份时停止并修复契约。

- [x] **Task Status:** completed

Run: `pnpm typecheck`

Expected: 共享协议、Web 与桌面调用兼容；相关测试通过。

### Task 3: 验证并记录交付边界

**Files:**

- Create: `.superwork/plans/2026-11-14-acp-agent-catalog.md`
- Modify: `.superwork/spec/core/shared/index.md`
- Modify: `.superwork/spec/desktop/backend/index.md`
- Modify: `docs/agent-engines.md`

**Interfaces:**

- Consumes: 最终实现和定向测试证据。
- Produces: 使用说明、验证记录。

**Behavior:**

- 检查跨端类型、静态边界及 ACP 回归，记录真实平台限制。

**Stop Conditions:**

- 回归失败未定位时不得宣称完成。

- [x] **Task Status:** completed

Run: `pnpm lint:architecture`

Expected: 无依赖方向违规；检查结果写入本计划。

## 最终验证与交接记录

- RED：新增目录用例首次运行因尚无 agent-catalog 模块而失败；随后验证未安装电脑无自动安装、选择性发现、并发安装合并、失败重试、配置保密、刷新保留停用及退出取消。
- 完整根测试：`node node_modules/vitest/vitest.mjs run`，795 个文件通过、4463 项通过、17 项条件跳过（真实账号/运行时等现有门禁）。在后续安装生命周期及目录拆分调整后，重新执行 ACP、Server、CLI、Client 定向回归：203 项通过；最终目录用例 7 项通过。
- 根和桌面 TypeScript 构建、Oxlint 均通过；依赖边界 2308 模块无违规；Rust 全特性 Clippy 无警告，ACP 资源测试 5 项通过；桌面源文件均未超过 500 行。
- Chromium/WebKit 在 390px/1280px 的共享目录、安装、自定义命令、自动进入工作区及既有设置回归合计 20 项通过。Web 与桌面共用被测组件。
- 性能套件 16 项通过；Web 首屏 353.71 KiB / 360 KiB，工作台 494.72 KiB / 520 KiB，异步闭包 464.06 KiB / 640 KiB。新增目录编辑器采用懒加载。
- Node/Web 生产构建、真实 npm tarball（374 文件）校验通过；独立 ACP 宿主原生编译成功，资源清单 engines 为空，编译宿主协议测试 4 项通过。
- 简化结果 changed：将可执行文件发现拆至 agent-executable，消除目录/安装器循环依赖；运行时按身份惰性装配；旧设置输出保持冻结 Schema。
- 长期规范 update：Core Agent 身份/安装契约与桌面宿主分发约束已更新，使用说明链接官方 Registry 格式。
- 未声称通过的范围：Windows/Ubuntu 真机、签名发行安装包、各厂商真实账号和计费模型会话；这些不能由 macOS 测试替代。
- 本次未创建 Git 提交。依赖版本未升级，锁文件只将固定 adapter 从生产依赖移至开发依赖。
- 额外联网 smoke：在隔离临时目录尝试按官方目录安装 crow-cli，再做仅 initialize 的握手；直连 Node 与复用共享代理配置的 Bun 均在 GitHub / release-assets.githubusercontent.com 下载阶段遇到 ECONNRESET。临时目录与进程均清理，未创建用户安装记录；不能据此宣称真实外网下载安装或握手已通过。离线安装器校验/失败清理测试通过，外网可用后可重试。
- 最终格式检查此前仅受临时并行公告 JSON 影响，公告完成移除后重跑；计划 preflight 通过。最终定向 ACP/CLI/Server/Client 回归 203 项通过（2 项真实运行时条件跳过），目录关闭/刷新等最终 7 项通过。
