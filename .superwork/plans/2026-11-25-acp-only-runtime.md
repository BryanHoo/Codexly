# 统一使用 ACP 运行时

**Goal:** 删除应用内 Codex App Server 与直连 Claude SDK，全部智能体通过 ACP 连接。

**Suggested Spec Reads:**

- `.superwork/spec/desktop/backend/index.md` 桌面命令、事件与生命周期
- `.superwork/spec/root/backend/index.md` 构建与发布

**Architecture:** 桌面只启动共享 ACP 宿主，Web 直接使用共享 ACP 适配器。应用继续读自己的任务目录与设置，在能力边界显示 Agent 支持的功能。

**Tech Stack:** Rust、Tauri、TypeScript、pnpm

## Global Constraints

- 两端复用 ACP 执行层，控制启动、传输及渲染开销。

### Task 1: 移除桌面原生宿主

**Files:**

- Modify: `desktop/src-tauri/src/application`、`desktop/src-tauri/src/infrastructure`、`desktop/src-tauri/build.rs`、`desktop/src-tauri/permissions/window-command-sets.toml`

**Interfaces:**

- Consumes: 共享 ACP 宿主协议、SQLite 任务目录
- Produces: 仅 ACP 的桌面执行与宿主生命周期

**Behavior:**

- 删除原生子进程启动和旧 IPC 入口，保留 ACP 搜索、附件、生成和任务生命周期。

**Stop Conditions:**

- 核对每个实际生产调用与 ACP 宿主能力后清理旧端口。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop rust:test`

Expected: 桌面 Rust 测试通过。

### Task 2: 清理 Web 和打包链

**Files:**

- Modify: `packages/provider-acp/src/official-agent.ts`、`packages/provider-codex`、`packages/server/src`、`tools`、`package.json`

**Interfaces:**

- Consumes: ACP Agent 目录和 IPC 宿主
- Produces: 仅打包共享宿主的运行时产物

**Behavior:**

- 删除原生 RPC 包装和上游 App Server schema 依赖，版本读取使用 ACP Agent 安装清单。

**Stop Conditions:**

- 核对生产构建入口和打包资源均只连接 ACP。

- [x] **Task Status:** completed

Run: `pnpm build`

Expected: Web 与 Node 生产包通过构建。

## 验证结果

- 根 Vitest 3649 项通过，桌面 Vitest 845 项通过。
- Rust 全特性测试、编译 ACP 宿主的 Rust 集成测试、Clippy 和 Tauri 权限检查通过。
- ACP 编译宿主测试、Web 构建、包内容校验、macOS ARM64 ACP sidecar 布局和 4 项 Chromium 端到端回归通过。
