# Feature Implementation Plan

**Goal:** 为两端 Codex 普通线程配置 300 秒空闲热缓存，标题线程退订后立即卸载，保留运行回合、队列和后台终端保护。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 验证与跨端约束。
- `.superwork/spec/provider-codex/backend/index.md` — Codex 生命周期边界。
- `.superwork/spec/desktop/backend/index.md` — Rust 适配与验证。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 配置集中在各语言适配器，复用已有创建、恢复和分叉路径。

**Architecture:** 使用 thread/start、thread/resume、thread/fork 的 config 覆盖 thread_unload_delay_secs；沿用上游空闲卸载调度和既有退订保护，不添加轮询、定时器或全局配置写入。

**Tech Stack:** TypeScript、Rust、pnpm、Vitest、Cargo。

## Global Constraints

- 同时覆盖 Web（含移动浏览器）与 macOS、Windows、Ubuntu 桌面。
- 关键执行位置添加中文注释；保持运行回合、队列和后台终端不被提前退订。
- 使用本地源码 rust-v0.164.0 标签核对线程配置修复，不修改上游 checkout。
- 公告：thread-idle-unload-20261026；owner：codex-thread-unload。

### Task 1: 接入线程卸载配置并验证两端保护

**Files:**

- Modify: `packages/provider-codex/src/codex-mapping-common.ts`
- Modify: `packages/provider-codex/src/task-title-generation.ts`
- Modify: `packages/provider-codex/src/agent-provider-turns.ts`
- Test: `packages/provider-codex/src/task-title-generation.test.ts`
- Test: `packages/provider-codex/src/agent-provider-background-lifecycle.test.ts`
- Test: `packages/provider-codex/src/agent-provider-lifecycle.test.ts`
- Test: `packages/provider-codex/src/agent-provider-ownership.test.ts`
- Test: `packages/provider-codex/src/agent-provider-fork.test.ts`
- Test: `packages/provider-codex/src/agent-provider-catalogs.test.ts`
- Test: `packages/provider-codex/src/agent-provider-history.test.ts`
- Test: `packages/provider-codex/src/agent-provider-mcp.test.ts`
- Test: `packages/provider-codex/src/agent-provider-mutations.test.ts`
- Modify: `desktop/src-tauri/src/infrastructure/codex/conversation_commands.rs`
- Modify: `desktop/src-tauri/src/infrastructure/codex/local_catalog_bridge.rs`
- Modify: `desktop/src-tauri/src/infrastructure/codex/task_title.rs`
- Modify and Test: `desktop/src-tauri/src/infrastructure/codex/commit_message.rs`
- Test: `desktop/src-tauri/src/infrastructure/codex/conversation_command_tests.rs`
- Test: `desktop/src-tauri/src/infrastructure/codex/task_title_tests.rs`
- Test: `desktop/src-tauri/src/infrastructure/codex/tasks_tests.rs`
- Modify: `docs/conversation-performance.md`
- Modify: `.superwork/spec/provider-codex/backend/index.md`

**Interfaces:**

- Consumes: Codex 0.164 thread/start、thread/resume、thread/fork 的 config 与 thread/unsubscribe。
- Produces: 普通线程 thread_unload_delay_secs=300；标题和提交说明辅助线程 thread_unload_delay_secs=0。

**Behavior:**

- 创建、恢复、分叉和本地目录延迟物化均传递普通线程配置。
- 标题成功、失败、取消与超时清理沿用原有中断和退订顺序。
- 运行回合、提交租约、排队消息与后台终端保护回归继续通过。

**Stop Conditions:**

- 上游 0.164 标签不支持线程级配置，或需要改变运行回合、队列和终端保护语义。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src`

Expected: 全部 Provider 测试通过；补充 Cargo 测试、类型、静态、Schema 与性能检查。

## 执行与交接证据

- 工作目录为仓库根目录；环境为 macOS arm64、Node 24、项目 pnpm，Python 脚本使用本机 Python 3.14 的 python3 路径。
- 本地 Codex checkout 为 rust-v0.163.0；通过 git show rust-v0.164.0 核对 thread_lifecycle.rs，确认卸载延迟由 conversation.config().thread_unload_delay 提供，没有修改上游源码。
- RED：pnpm exec vitest run packages/provider-codex/src/agent-provider-lifecycle.test.ts packages/provider-codex/src/agent-provider-ownership.test.ts packages/provider-codex/src/agent-provider-fork.test.ts packages/provider-codex/src/task-title-generation.test.ts，8 项因缺少线程卸载字段失败，退出码 1；辅助会话 0 秒的单独断言也观察到同因失败。
- RED：Cargo lifecycle、title_generation_should_use_isolated_structured_turn_and_persist_summary 和 commit_message 的 generation_should_use_configured_model_on_an_ephemeral_turn，均实际执行 1 项并因字段为 Null 而非 300/0 失败，退出码 101。一次完整模块过滤未匹配任何测试，不作为证据，随后已用函数名过滤获得有效 RED。
- GREEN：pnpm exec vitest run packages/provider-codex/src，514 passed、4 skipped，退出码 0；随后增加两类线程的启动与终端保护表格回归，最终由全量 pnpm test 覆盖，3624 passed、28 skipped，退出码 0。
- Cargo 定向 Codex 适配测试 244 passed、2 ignored，退出码 0；后续 pnpm --dir desktop check:rust 的全特性测试为 785 passed、9 ignored，另两个集成测试组各 3 passed。
- pnpm typecheck、pnpm lint、pnpm lint:architecture、pnpm codex:schema:check 通过；架构检查仅报告既有 sqlite-journal.d.ts 孤立声明警告。Schema 基线为 0.164.0。
- pnpm format:check 通过；首轮失败仅涉及任务自己的临时公告 JSON 格式，格式化后全量复验通过。
- pnpm test:performance：9 files、17 tests passed，退出码 0。
- pnpm build、pnpm bundle:check、pnpm package:check 通过。初始包 311.81 KiB / 320 KiB，工作台就绪 444.78 KiB / 500 KiB，发布内容校验通过。
- pnpm --dir desktop check:web 通过：639 tests，格式/类型/静态/约束/Legacy/标准与 Legacy 构建及包体预算检查通过。初轮发现 Rust 文件超出 500 行，去除不必要的独立零值常量后完整重跑通过。
- 最后语义改动后的测试、类型、构建和性能证据复用；之后仅删除一处导入间空行以满足 TypeScript 500 行限制，并重新通过格式和 lint。两端配置路径均集中在各自适配器，不添加调度器、轮询、RPC 或全局配置写入。
- 简化评审：no-change；保留现有调度与忙碌保护，避免引入跨语言配置加载机制。
- 规范决策：update；在 provider-codex 规范索引补充 300/0 秒策略、保护条件和两端验证入口；用户文档已同步，沿现有索引可达。
- 未执行真实模型请求、内存量化测量、浏览器交互 E2E 和 Windows/Ubuntu 实机验证；本次无界面、传输协议或平台专属 API 改动。
- 最终 pnpm --dir desktop check:rust 完整通过，退出码 0：格式、Clippy、全特性测试与 Release 性能基线 6 passed；最终 pnpm --dir desktop rust:fmt:check 和 rust:clippy 复验亦通过，退出码 0。
- 规范索引本地链接逐项验证有效；计划 preflight ok=true，全部任务完成。最终代码无未解决检查失败，保留各工具默认跳过的环境相关测试。
