# Codexly Workbench Rust Migration Plan

**Goal:** 在保持现有桌面 UI 交互的前提下，以 Rust/Tauri 直接对接 Codex 0.149 app-server，完整覆盖 Codexly 工作台能力。
**Scope:** 修改 `src/` 与 `src-tauri/`；协议以本地 `rust-v0.149.0` 源码为准；移除 Codexly HTTP、WebSocket 和 mock 运行时对接。
**Acceptance:** 左栏、中栏、右栏及设置联动均由 Tauri IPC 驱动，源码不再包含运行时 HTTP/mock 传输，`pnpm check` 与桌面端关键流程验证通过。

### Task 1: 接入真实会话快照

**Files:**

- Add: `src-tauri/src/domain/conversation.rs`
- Add: `src-tauri/src/infrastructure/codex/conversation.rs`
- Modify: `src-tauri/src/application/sidebar_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/platform/tauri/sidebar-client.ts`
- Test: `src-tauri/src/infrastructure/codex/conversation_tests.rs`

**Behavior:**

- 使用 `thread/read(includeTurns: true)` 返回真实任务状态、设置、回合与消息/推理/命令/文件变更/工具项，替换前端空快照。

**Interfaces:**

- Tauri command: `read_task(project_id, task_id) -> AgentTaskSnapshotResponse`

**Proof:** `cargo test --manifest-path src-tauri/Cargo.toml conversation --locked && pnpm vitest run src/platform/tauri/sidebar-client.test.ts`

**Stop Conditions:**

- Codex 0.149 `thread/read` 数据无法稳定映射到现有 `AgentTaskSnapshot` 契约。

- [x] **Task Status:** completed

### Task 2: 接入回合提交与流式事件

**Files:**

- Modify: `src-tauri/src/infrastructure/codex/connection.rs`
- Modify: `src-tauri/src/infrastructure/codex/conversation.rs`
- Add: `src-tauri/src/infrastructure/codex/conversation_commands.rs`
- Add: `src-tauri/src/infrastructure/codex/conversation_events.rs`
- Modify: `src-tauri/src/application/state.rs`
- Modify: `src-tauri/src/application/sidebar_commands.rs`
- Modify: `src/platform/tauri/runtime.ts`
- Modify: `src/platform/tauri/sidebar-client.ts`
- Test: `src-tauri/src/infrastructure/codex/conversation_tests.rs`
- Test: `src/platform/tauri/sidebar-client.test.ts`

**Behavior:**

- 实现 `thread/start`、`thread/resume`、`turn/start`、`turn/steer`、`turn/interrupt`，并通过唯一长生命周期 Tauri `Channel` 投递带单调序号的归一化事件。

**Proof:** `cargo test --manifest-path src-tauri/Cargo.toml conversation --locked && pnpm vitest run src/platform/tauri/sidebar-client.test.ts`

**Stop Conditions:**

- 事件背压或顺序保证需要改变已确认的单 Channel 架构。

- [x] **Task Status:** completed

### Task 3: 完整映射中栏事件与审批

**Files:**

- Modify: `src-tauri/src/domain/conversation.rs`
- Modify: `src-tauri/src/infrastructure/codex/conversation.rs`
- Modify: `src-tauri/src/application/sidebar_commands.rs`
- Modify: `src/platform/tauri/sidebar-client.ts`
- Test: `src-tauri/src/infrastructure/codex/conversation_tests.rs`

**Behavior:**

- 覆盖计划、用量、错误、命令输出、Diff、MCP、审批与用户输入请求，并将前端处理结果回写 app-server。

**Proof:** `cargo test --manifest-path src-tauri/Cargo.toml conversation --locked && pnpm check:web`

**Stop Conditions:**

- Codex 0.149 服务端请求类型与现有 UI 无法形成无损交互。

- [x] **Task Status:** completed

### Task 4: 完成任务高级能力

**Files:**

- Modify: `src-tauri/src/infrastructure/codex/conversation.rs`
- Modify: `src-tauri/src/application/sidebar_commands.rs`
- Modify: `src/platform/tauri/sidebar-client.ts`
- Test: `src-tauri/src/infrastructure/codex/conversation_tests.rs`

**Behavior:**

- 实现历史分页、任务设置、review、compact、fork、goal、排队提交、后台终端和 temporary task 工作流。

**Proof:** `cargo test --manifest-path src-tauri/Cargo.toml conversation --locked && pnpm check:web`

**Stop Conditions:**

- 某项 Codexly 能力在 Codex 0.149 中没有对应协议或可由 Rust 安全实现的本地能力。

- [x] **Task Status:** completed

### Task 5: 接入文件、附件与 Git 工作流

**Files:**

- Add: `src-tauri/src/infrastructure/workspace/`
- Modify: `src-tauri/src/application/commands.rs`
- Modify: `src/platform/tauri/sidebar-client.ts`
- Test: `src-tauri/src/infrastructure/workspace/`

**Behavior:**

- 以受限 Rust 文件系统和 Git 子进程实现文件树、搜索、读取、重命名、删除、附件、状态、历史、Diff、分支、worktree 与提交，并驱动右栏检查器联动。

**Proof:** `cargo test --manifest-path src-tauri/Cargo.toml workspace --locked && pnpm check:web`

**Stop Conditions:**

- 实现需要向 WebView 暴露通用 shell 权限或越过项目根目录边界。

- [x] **Task Status:** completed

### Task 6: 接入模型、认证、设置、Skills 与 MCP

**Files:**

- Add: `src-tauri/src/infrastructure/codex/catalogs.rs`
- Add: `src-tauri/src/infrastructure/settings/`
- Modify: `src-tauri/src/application/commands.rs`
- Modify: `src/platform/tauri/sidebar-client.ts`
- Test: `src-tauri/src/infrastructure/`

**Behavior:**

- 通过 Codex 0.149 协议和应用私有配置实现模型、认证、Provider 连接、全局/项目设置、Skills、MCP 与诊断能力。

**Proof:** `cargo test --manifest-path src-tauri/Cargo.toml infrastructure --locked && pnpm check:web`

**Stop Conditions:**

- 认证信息必须进入 WebView 持久化状态才能继续。

- [x] **Task Status:** completed

### Task 7: 移除 Codexly 旧对接逻辑

**Files:**

- Delete: `src/mock/`
- Delete: `src/client/event-client.ts`
- Delete: `src/client/http-client-*.ts`
- Modify: `src/platform/tauri/`
- Modify: `src/features/`

**Behavior:**

- 使用独立 Tauri 客户端替换 `CodexlyClient` 继承关系，删除运行时 HTTP、WebSocket、mock 和不可达兼容分支。

**Proof:** `! rg -n "MockWebSocket|mockFetch|new WebSocket|/v1/projects" src && pnpm check`

**Stop Conditions:**

- 仍有 UI 功能依赖未迁移的 Codexly 客户端方法。

- [x] **Task Status:** completed

### Task 8: 验证完整桌面能力

**Files:**

- Modify: `src/` or `src-tauri/` only when verification exposes a defect
- Modify: `.superwork/plans/codexly-workbench-migration.md`

**Behavior:**

- 以 `architecture-research.md`、Codexly 功能清单、Codex 0.149 源码和官方 App Server 文档建立逐项能力矩阵。
- 使用真实 Codex 0.149 app-server 验证项目、任务、会话、审批、文件、Git、检查器和设置联动。
- 验证桌面视口无空白、遮挡和运行时错误，并记录空实现、降级分支、残留 Node 后端依赖及性能证据。

**Proof:** 能力矩阵全部具备源码与运行证据；`pnpm check`、真实 Codex 0.149 集成测试、Tauri 桌面流程与性能检查全部通过

**Stop Conditions:**

- 验证失败来自仓库外不可用的签名、账号或网络依赖。

- [x] **Task Status:** completed
