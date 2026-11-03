# Feature Implementation Plan

**Goal:** Web、移动浏览器和桌面归档、恢复与永久删除优先调用底层 Agent 开放能力。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 共享边界与跨平台约束。
- `.superwork/spec/provider-codex/backend/index.md` — RPC 与原生身份映射。
- `.superwork/spec/desktop/backend/index.md` — 原生命令及异步 I/O。
- `.superwork/spec/server/backend/index.md` — Worker 仓储与交付。
- `.superwork/spec/provider-claude/backend/index.md` — 共享 SDK 删除与真实工作保护。

**Architecture:** 在现有本地目录适配边界按 sessionId 调用原生生命周期，再提交本地状态；桌面命令复用该边界。未绑定的空任务不启动引擎。只对方法不存在明确回退。Claude SDK 无归档能力，保留共享本地归档和原生删除。

**Tech Stack:** TypeScript、Rust、Vitest、Tokio、pnpm。

## Global Constraints

- 保留应用 ID / 原生 sessionId 隔离；管理列表继续使用应用 SQLite，不新增轮询或历史加载。
- 两端共享能力语义及错误边界；底层失败保留目录入口，不伪报成功。
- 关键逻辑使用中文注释；Python 使用 Python3；包管理器使用 pnpm。
- 用户授权清理已完成的 usage-20261103 登记；本任务登记 agent-lifecycle-20261103，owner codex-agent-lifecycle。

### Task 1: 同步两端 Codex 生命周期

**Files:**

- Modify: `packages/provider-codex/src/local-catalog-client.ts`
- Modify: `desktop/src-tauri/src/infrastructure/codex/local_catalog_bridge.rs`
- Modify: `desktop/src-tauri/src/application/sidebar_commands.rs`
- Create: `desktop/src-tauri/src/application/sidebar_task_lifecycle.rs`
- Test: `packages/server/src/local-catalog-lifecycle.test.ts`
- Test: `desktop/src-tauri/src/infrastructure/codex/local_catalog_lifecycle_tests.rs`

**Interfaces:**

- Consumes: LocalTask.sessionId、Codex thread/archive、thread/unarchive、thread/delete。
- Produces: 保持原公开响应与本地列表权威状态。

**Behavior:**

- 已绑定任务先调用原生接口，成功后提交本地记录；空任务只操作本地。
- -32601 明确不支持时回退；其他故障保留本地状态。精确的删除不存在响应允许重试完成本地清理。
- 旧版本仅本地归档的会话，恢复时允许原生已在活动区这一精确状态。

**Stop Conditions:**

- 原生接口或错误语义无法核实，暂停对应兼容分支。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/local-catalog-lifecycle.test.ts`

Expected: 原生身份、提交顺序、失败保留、能力回退、空任务及恢复兼容回归通过；Rust 对应集成测试通过。

### Task 2: 更新能力说明并验证集成

**Files:**

- Modify: `docs/local-catalog.md`
- Modify: `.superwork/spec/provider-codex/backend/index.md`

**Interfaces:**

- Consumes: Codex 官方 App Server 文档及 Claude SDK 0.3.316 导出类型。
- Produces: 与两端真实实现一致的生命周期说明。

**Behavior:**

- 明确 Codex 归档/恢复/删除同步底层，Claude 仅归档回退，普通错误不回退。
- 执行 Provider、Server、类型、架构、Schema、性能和桌面相关检查。

**Stop Conditions:**

- 相关检查失败时记录原因并修复本次引入的问题。

- [x] **Task Status:** completed

Run: `pnpm exec prettier --check docs/local-catalog.md`

Expected: 文档格式通过，集成验证证据完整。

## 实施与验证证据

- 工作目录为仓库根目录，环境为 macOS arm64，使用已安装依赖，未修改依赖或锁文件。用户明确授权结束已完成的用量统计登记，已通过所有者校验移除 usage-20261103；其业务逻辑未改动。
- RED：`pnpm exec vitest run packages/server/src/local-catalog-lifecycle.test.ts` 初次 11 失败，证明现有代码没有调用原生接口且在原生故障前已提交目录。Rust 的 `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib local_catalog_bridge::lifecycle_tests --locked` 初次 2 失败，实际 JSONL 无生命周期请求。
- GREEN：两端补齐原生调用；桌面命令通过小型辅助模块复用连接边界，保持原命令文件低于 500 行。原生失败不提交本地记录；只有 -32601 回退。
- 真实运行时暴露额外兼容分支：Codex 0.166.0 安装包删除缺失历史时返回 -32600 和 `no rollout found for thread id <sessionId>`。补充精确回归先观察失败，再与源码中的 `thread not found: <sessionId>` 一起处理。没有宽泛字符串匹配。
- 最终 `CODEXLY_REAL_RUNTIME_TEST=1 pnpm exec vitest run packages/server/src/local-catalog-lifecycle.test.ts`：17 通过，退出 0。真实临时 CODEX_HOME 验证归档、恢复、旧本地归档恢复、归档历史永久删除、原生已删除后重试；不调用模型、不访问用户会话。
- `pnpm exec vitest run packages/provider-codex/src packages/server/src packages/provider-claude/src/provider.test.ts`：223 文件、1420 测试通过，7 测试按既有条件跳过，退出 0。复用此证据覆盖未受最后精确错误分支影响的 Provider、HTTP 与 Claude 行为。
- 最后错误分支修改后，`pnpm exec vitest run packages/server/src/local-catalog-lifecycle.test.ts packages/server/src/local-catalog-client.test.ts packages/server/src/local-catalog-http.test.ts packages/provider-codex/src/agent-provider-archive-state.test.ts packages/provider-codex/src/agent-provider-lifecycle.test.ts`：32 通过，真实引擎测试按默认条件跳过；真实引擎已在上一条独立启用验证。
- 最后代码修改后 `pnpm typecheck`、`pnpm lint`、`pnpm lint:architecture`、Cargo 全目标全特性 Clippy、全特性 Rust 测试均退出 0；原生最终含新增兼容测试。`pnpm codex:schema:check` 验证 0.166.0 基线。
- `pnpm --dir desktop check:web` 退出 0，含 163 文件、683 测试、Tauri 约束、正常和 Legacy 构建、包体预算。之后仅新增 Rust 精确错误分支及测试，没有修改 UI、IPC 或构建输入契约，复用前端证据。
- `pnpm --dir desktop check:rust` 首轮退出 0，含格式、Clippy、806 单元测试、6 集成测试与 6 个 Release 性能基线；随后精确删除错误分支及补充兼容测试通过最终 Clippy 与全部 Rust 测试。性能工作负载与路径不涉及本次错误分支，沿用已测 Release 性能证据。
- `pnpm test:performance`：8 文件、16 测试通过。`pnpm build`、`pnpm bundle:check`、`pnpm package:check` 均退出 0；最后 Node 错误分支修改后重新执行 `pnpm build:node`、`pnpm package:check` 均通过。Web 首屏 351.75 KiB / 360 KiB，工作台 512.83 KiB / 520 KiB。
- Simplification: no-change。平台私有传输留在 TypeScript/Rust 边界，桌面新增辅助模块是为复用原生协调并遵守文件行数约束，没有新增后台任务。
- Spec: update。分类器未自动识别，但本次引入了持久的原生生命周期提交顺序、能力回退与精确缺失错误契约，已在 Codex 适配器索引中补充并链接用户文档。Prettier 和 Git whitespace 检查通过。
- 未验证范围：Windows/Ubuntu 真机与实际用户数据操作；本次无 UI 变更，不新增浏览器交互测试。全部真实运行时操作限于隔离测试目录。
