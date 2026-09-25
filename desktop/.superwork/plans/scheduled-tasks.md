# Scheduled Tasks Implementation Plan

**Goal:** 在桌面任务看板入口旁提供可持久化、可无人值守执行的 Codex 定时任务，并完整支持增删改查、暂停、立即运行、运行记录和输入器配置。
**Scope:** React 工作台、TypeScript IPC 契约、Tauri Rust 调度与本地持久化；仅支持当前应用已配置的本地 Project 与 `temporary` 作用域，不引入云端或系统级守护进程。
**Acceptance:** 用户可从侧栏“定时任务”创建一次性或 RFC 5545 重复任务，关闭主窗口后仍能在应用进程内按时创建独立 Codex 会话，任务与运行状态可重启恢复并通过 `pnpm check`。

### Task 1: 建立调度领域与持久化

**Files:**

- Create: `src-tauri/src/domain/scheduled_task.rs`
- Create: `src-tauri/src/infrastructure/scheduled_tasks.rs`
- Create: `src-tauri/src/infrastructure/scheduled_tasks_tests.rs`
- Modify: `src-tauri/src/domain/mod.rs`
- Modify: `src-tauri/src/infrastructure/mod.rs`
- Modify: `src-tauri/Cargo.toml`

**Behavior:**

- 校验一次性时间与 RFC 5545 RRULE，按当前电脑 IANA 时区计算下一次运行，原子持久化任务与有界运行记录，并将离线错过的多个时点合并为一次补跑。

**Proof:** `cargo test --manifest-path src-tauri/Cargo.toml scheduled_tasks -- --nocapture`

**Stop Conditions:**

- 停止于 RRULE 库不能稳定处理 IANA 时区或当前 Rust 工具链不兼容。

- [x] **Task Status:** completed

### Task 2: 实现常驻调度执行器与 IPC

**Files:**

- Create: `src-tauri/src/application/scheduled_task_commands.rs`
- Create: `src-tauri/src/application/scheduled_task_runtime.rs`
- Create: `src-tauri/src/application/scheduled_task_runtime_tests.rs`
- Modify: `src-tauri/src/application/mod.rs`
- Modify: `src-tauri/src/application/sidebar_commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Behavior:**

- 提供列表、创建、更新、删除、暂停/恢复、立即运行命令；到期时确保 Codex Runtime 可用，创建独立 Task/Turn，禁止同一定时任务重叠，并记录成功或失败。

**Interfaces:**

- Tauri commands: `list_scheduled_tasks`, `create_scheduled_task`, `update_scheduled_task`, `delete_scheduled_task`, `set_scheduled_task_enabled`, `run_scheduled_task_now`

**Proof:** `cargo test --manifest-path src-tauri/Cargo.toml scheduled_task_runtime -- --nocapture`

**Stop Conditions:**

- 停止于现有 App Server 连接无法从后台安全调用 `thread/start` 与 `turn/start`。

- [x] **Task Status:** completed

### Task 3: 建立 WebView 类型与客户端契约

**Files:**

- Create: `src/protocol/scheduled-task.ts`
- Create: `src/platform/tauri/scheduled-task-client.test.ts`
- Modify: `src/protocol/index.ts`
- Modify: `src/platform/tauri/sidebar-client.ts`
- Modify: `src/features/projects/project-query-contracts.ts`

**Behavior:**

- TypeBox 契约覆盖调度、输入、设置和运行记录，Tauri 客户端精确映射全部 CRUD 与执行命令。

**Proof:** `pnpm vitest run src/platform/tauri/scheduled-task-client.test.ts`

**Stop Conditions:**

- 停止于 Rust 与 TypeScript 序列化字段无法形成单一 camelCase 契约。

- [x] **Task Status:** completed

### Task 4: 添加定时任务路由与管理界面

**Files:**

- Create: `src/app/routes/scheduled-tasks-route.tsx`
- Create: `src/features/scheduled-tasks/`
- Create: `src/shared/styles/scheduled-tasks.css`
- Modify: `src/app/router.tsx`
- Modify: `src/app/routes/workbench-route.tsx`
- Modify: `src/features/workbench/components/project-sidebar.tsx`
- Modify: `src/features/workbench/components/workbench-shell*.tsx`
- Modify: `src/i18n/locales/*/workbench.ts`
- Modify: `src/main.tsx`

**Behavior:**

- 侧栏在任务看板上方显示“定时任务”；桌面双栏视图支持筛选、空态、创建、编辑、删除、暂停/恢复、立即运行及最近运行跳转。

**Proof:** `pnpm vitest run src/features/scheduled-tasks/scheduled-tasks.browser.test.tsx`

**Stop Conditions:**

- 停止于界面需要与任务看板无关的新导航层级。

- [x] **Task Status:** completed

### Task 5: 复用完整提示词输入能力

**Files:**

- Modify: `src/features/workbench/components/workbench-composer*.tsx`
- Modify: `src/features/workbench/components/workbench-composer-submission.ts`
- Modify: `src/features/scheduled-tasks/`

**Behavior:**

- 定时任务编辑器复用正文、Skill、项目文件引用、浏览器/宿主附件、权限、模型、推理强度与快速模式逻辑；提交时仅保存快照，不启动即时 Turn。

**Proof:** `pnpm vitest run src/features/scheduled-tasks/scheduled-task-composer.test.ts`

**Stop Conditions:**

- 停止于复用要求会改变普通 Composer 的即时提交行为。

- [x] **Task Status:** completed

### Task 6: 完成跨层验收

**Files:**

- Modify: `.superwork/spec/root/shared/index.md`

**Behavior:**

- 固化定时任务的持久化、误点、并发、权限与附件契约，并执行 Web、Rust 和跨层完整检查。

**Proof:** `pnpm check`

**Stop Conditions:**

- 停止于发现与本功能无关的既有失败并记录其证据。

- [x] **Task Status:** completed
