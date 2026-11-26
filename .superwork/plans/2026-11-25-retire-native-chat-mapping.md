# 移除生产构建中的原生 Codex 聊天映射

**Goal:** Web 与桌面的生产聊天事件统一由 ACP 投影，旧 Codex App Server 的实时映射仅用于现有兼容回归。

**Suggested Spec Reads:**

- `.superwork/spec/provider-codex/backend/index.md` 描述原生历史、诊断和事件边界。
- `.superwork/spec/desktop/backend/index.md` 描述桌面事件转发。

**Architecture:** Web 从生产包入口移除旧执行器，测试单独构建夹具。桌面保留原生辅助进程的登录和内部模型响应，旧会话通知映射受 Rust 测试编译条件约束。

**Tech Stack:** TypeScript、Vitest、Rust、Cargo。

## Global Constraints

- ACP 的运行、历史读取和认证各自使用已有接口。旧历史快照仍支持只读导入。
- 已有工作区中的速率改动不纳入本任务。

### Task 1: 分离 Web 的旧映射夹具

**Files:**

- Modify: `packages/provider-codex/src/index.ts`, `packages/provider-codex/src/codex-protocol-mapping.ts`, `packages/provider-codex/src/agent-provider-runtime.ts`, `tools/prepare-e2e.mjs`
- Move: `packages/provider-codex/src/codex-event-mapping.ts`
- Test: `packages/provider-codex/src/codex-protocol-mapping.test-support.ts`, `packages/provider-codex/src/testing/index.ts`, `packages/server/src/local-catalog-http.test.ts`, `packages/server/src/personalization-routes.test.ts`, `tests/realtime-path.test.ts`

**Interfaces:**

- Consumes: `@codexly/provider-codex`、Web 测试夹具、ACP 历史导入。
- Produces: 精简的生产入口及独立测试入口。

**Behavior:**

- 发布构建不包含旧执行器和实时聊天映射，旧回归仍可执行。

**Stop Conditions:**

- 已启用的生产功能仍依赖旧聊天映射时，先保留其行为。

- [x] **Task Status:** completed

Run: `pnpm test packages/provider-codex/src packages/server/src/local-catalog-http.test.ts tests/realtime-path.test.ts`

Expected: 兼容和只读历史用例通过。

结果 579 项通过，4 项跳过。生产构建及包体检查通过。扫描发布 JavaScript 未找到旧执行器、映射器或原生 token 用量通知标识。Web 流式端到端回归通过 4 项。

### Task 2: 分离桌面的旧映射夹具

**Files:**

- Modify: `desktop/src-tauri/src/application/state_event_forwarder.rs`, `desktop/src-tauri/src/application/state.rs`, `desktop/src-tauri/src/infrastructure/codex/mod.rs`
- Move: `desktop/src-tauri/src/infrastructure/codex/conversation_events.rs`, `desktop/src-tauri/src/infrastructure/codex/conversation_runtime_events.rs`, `desktop/src-tauri/src/infrastructure/codex/conversation_delta_events.rs`

**Interfaces:**

- Consumes: 原生辅助进程消息、ACP 会话事件、Rust 兼容测试。
- Produces: 只处理辅助消息的生产转发器及独立测试映射。

**Behavior:**

- 旧聊天通知不会进入正式桌面事件流。登录、模型采样和进程准备状态继续通过既有原生能力处理。

**Stop Conditions:**

- 保留正式客户端可用的 ACP 和旧历史导入功能。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop rust:test`

Expected: 原生辅助消息、旧夹具和 ACP 用例通过。

结果 Rust 主测试套件 948 项通过，10 项按既有条件忽略，另有 6 项集成用例通过。Rust 格式检查和 Clippy 通过。编译后的 ACP 宿主通过 12 项。
