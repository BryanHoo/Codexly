# Feature Implementation Plan

**Goal:** 在 Web 和桌面显示 ACP Agent 的自动检测、安装和更新进度，并允许移除已有 Agent。

**Suggested Spec Reads:**

- `.superwork/spec/core/shared/index.md` — Agent 目录和跨宿主锁。
- `.superwork/spec/ui/shared/index.md` — 后台通知及双端设置入口。
- `.superwork/spec/guides/cross-layer-thinking-guide.md` — 两端传输和持久化边界。

**Architecture:** 共享目录维护有界的进行中状态和安装来源，HTTP 和 IPC 仅适配；共享 React UI 按需读取状态。

**Tech Stack:** TypeScript、Fastify、React、Tauri、Vitest。

## Global Constraints

- 两端共用业务实现；后台发现不阻塞工作区。
- 不回显私有环境变量，不删除系统 CLI 或用户数据，不编造进度。
- 写入遵循 Agent 级跨宿主锁；失败更新保留原安装。

### Task 1: 实现宿主进度、更新与移除

**Files:**

- Modify: `packages/protocol/src/acp-agent-catalog.ts`, `packages/core/src/acp-service.ts`, `packages/provider-acp/src/agent-catalog.ts`, `packages/provider-acp/src/agent-installer.ts`
- Test: `packages/provider-acp/src/agent-catalog.test.ts`, `packages/provider-acp/src/agent-installer.test.ts`

**Interfaces:**

- Consumes: 内置 Registry 快照和已有 Agent 注册记录。
- Produces: `AcpAgentCatalogProgress`, `AcpAgentCatalog.progress/update/remove`。

**Behavior:**

- 自动发现和安装报告实测进度；更新失败保留原命令，移除后重启或刷新不会重新接入。

**Stop Conditions:**

- 无法区分应用运行时与本机 CLI，或无法保留失败更新之前的注册记录。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-acp/src/agent-catalog.test.ts packages/provider-acp/src/agent-installer.test.ts`

Expected: 安装进度、失败更新和移除行为测试通过。

Evidence: RED 缺少 progress/update/remove；GREEN 13 项通过。

### Task 2: 接通两端交付

**Files:**

- Modify: `packages/provider-acp/src/host-dispatch.ts`, `packages/server/src/routes/acp-routes.ts`, `packages/client/src/http-client-acp.ts`, `desktop/src/platform/tauri/acp-client.ts`, `desktop/src-tauri/src/application/acp_commands.rs`, `desktop/src-tauri/src/application/claude_host.rs`, `desktop/src-tauri/src/application/claude_host/transport.rs`
- Test: `packages/server/src/app-acp.test.ts`, `packages/client/src/http-client-acp.test.ts`

**Interfaces:**

- Consumes: `AcpAgentCatalogProgress` 和共享目录端口。
- Produces: HTTP 目录进度、更新、移除接口及等价的 ACP IPC 方法。

**Behavior:**

- 只读进度不等待安装；更新和移除复用受校验的 Agent 身份及写操作边界。

**Stop Conditions:**

- 无法安全区分取消读取与写入结果不确定。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app-acp.test.ts packages/client/src/http-client-acp.test.ts`

Expected: 进度读取和更新、移除的交付契约通过。

Evidence: RED 进度路由 404、客户端入口不存在；GREEN 18 项通过。

### Task 3: 展示两端共享交互

**Files:**

- Create: `packages/ui/src/core/acp-catalog-progress.tsx`, `packages/ui/src/core/acp-agent-maintenance.tsx`
- Modify: `packages/ui/src/core/acp-catalog-settings.tsx`, `packages/ui/src/core/acp-settings-panel.tsx`, `packages/ui/src/core/acp-engine-setup-gate.tsx`, `.superwork/spec/core/shared/index.md`, `.superwork/spec/ui/shared/index.md`, `CHANGELOG.md`, `docs/agent-engines.md`
- Test: `desktop/tests/browser/acp-catalog.browser.test.tsx`, `tests/e2e/app-shell-acp-catalog.spec.ts`

**Interfaces:**

- Consumes: `AcpCatalogClient`。
- Produces: 背景通知、安装行进度、已安装 Agent 的更新和移除交互。

**Behavior:**

- 仅操作期间读取进度；已安装 Agent 支持确认移除并同步可用列表；更新和移除保留错误反馈。

**Stop Conditions:**

- 进度读取导致空闲后台轮询，或更新后重置工作区。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser tests/browser/acp-catalog.browser.test.tsx`

Expected: 宽窄屏均展示可观察进度及更新、移除交互。

Evidence: RED 缺少进度条、后台进度文本和更新入口；GREEN 桌面 Chromium/WebKit 目录及设置用例共 30 项通过，Web 新目录用例在 Chromium/Firefox/WebKit 共 3 项通过。

## Verification

- 根目录 Provider / Protocol / Client 与 ACP 路由集合 429 项通过；最后一次格式和类型修正后，复验受影响的目录、安装器、HTTP 契约 33 项以及原生客户端 6 项。
- 根目录和桌面类型检查、lint、依赖边界检查、桌面 Rust 格式与编译、两端构建和包体预算通过。根目录性能测试 16 项通过。
- 旧 Web `app-shell-acp-setup` 和 `app-shell-acp-enable` 用例缺少目录 fixture，仍断言旧引导和旧开关；Chromium 复跑 4 项失败，未改动旧用例。新增 `app-shell-acp-catalog` 覆盖现用目录。
- 共享契约归档至 Core 和 UI 索引。预览使用隔离应用目录启动；本机安装与更新使用测试夹具验证，未运行 Windows 或 Ubuntu 真机测试。
