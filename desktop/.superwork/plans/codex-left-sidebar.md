# Codex Left Sidebar Implementation Plan

**Goal:** 左栏所有项目与任务操作通过 Tauri/Rust 直接连接 Codex 0.149 app-server
**Scope:** 保持现有左栏 UI 交互；不实现设置弹窗内部功能，不保留运行时 mock/HTTP/WebSocket 对接
**Acceptance:** 直接 Tauri IPC 覆盖项目浏览与管理、任务查询/搜索/置顶/重命名/归档/恢复/删除，并通过完整 Web/Rust 检查

### Task 1: Enable the Codex experimental protocol surface

**Files:**

- Modify: `src-tauri/src/infrastructure/codex/protocol.rs`
- Modify: `src-tauri/src/infrastructure/codex/connection.rs`

**Behavior:**

- 初始化明确发送 `capabilities.experimentalApi: true`，并保持请求响应关联和初始化顺序。

**Proof:** `cargo test --manifest-path src-tauri/Cargo.toml infrastructure::codex --locked`

**Stop Conditions:**

- Codex 0.149 源码 Schema 与官方文档的初始化契约不一致。

- [x] **Task Status:** completed

### Task 2: Implement project and filesystem commands

**Files:**

- Add: `src-tauri/src/domain/sidebar.rs`
- Add: `src-tauri/src/infrastructure/codex/sidebar.rs`
- Modify: `src-tauri/src/application/commands.rs`
- Modify: `src-tauri/src/application/state.rs`
- Modify: `src-tauri/src/lib.rs`

**Behavior:**

- 通过 `project/list/create/update/delete/move` 管理项目，通过受限 Rust 文件系统查询驱动原目录选择器。

**Proof:** `cargo test --manifest-path src-tauri/Cargo.toml sidebar --locked`

**Stop Conditions:**

- 项目操作需要引入 Codex 之外的第二事实来源。

- [x] **Task Status:** completed

### Task 3: Implement task sidebar commands

**Files:**

- Modify: `src-tauri/src/domain/sidebar.rs`
- Modify: `src-tauri/src/infrastructure/codex/sidebar.rs`
- Modify: `src-tauri/src/application/commands.rs`
- Modify: `src-tauri/src/application/state.rs`

**Behavior:**

- 通过 `thread/list/read/name/set/section/move/archive/unarchive/delete` 完成列表、搜索、置顶和任务生命周期操作。

**Proof:** `cargo test --manifest-path src-tauri/Cargo.toml sidebar --locked`

**Stop Conditions:**

- 任一任务状态只能通过解析终端文本获得。

- [x] **Task Status:** completed

### Task 4: Replace the frontend mock transport

**Files:**

- Add: `src/platform/tauri/runtime.ts`
- Add: `src/platform/tauri/sidebar-client.ts`
- Modify: `src/features/projects/project-query-contracts.ts`
- Test: `src/platform/tauri/sidebar-client.test.ts`

**Behavior:**

- 保持 Codexly 左栏组件调用契约，但所有运行时数据改用模块级 Tauri Channel 与直接 `invoke`。

**Proof:** `pnpm vitest run src/platform/tauri/sidebar-client.test.ts`

**Stop Conditions:**

- 现有 UI 必须依赖 HTTP 路由语义才能保持交互。

- [x] **Task Status:** completed

### Task 5: Verify the cross-layer integration

**Files:**

- Modify: `.superwork/plans/codex-left-sidebar.md`

**Behavior:**

- 所有定向测试、静态检查和生产构建通过，且源码不再选择 mock transport。

**Proof:** `pnpm check`

**Stop Conditions:**

- 验证失败来自无法安全绕过的外部运行时依赖。

- [x] **Task Status:** completed
