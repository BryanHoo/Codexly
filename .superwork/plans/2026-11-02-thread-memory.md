# Feature Implementation Plan

**Goal:** 在 Web、移动浏览器和桌面上下文面板展示会话所选版本的记忆摘要。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 跨层复用和验证入口。
- `.superwork/spec/protocol/shared/index.md` — 公开响应契约。
- `.superwork/spec/provider-codex/backend/index.md` — 会话身份和实验 RPC。
- `.superwork/spec/desktop/backend/index.md` — 原生命令和 ACL。
- `.superwork/spec/ui/shared/index.md` — 共享组件和按需加载。

**Architecture:** Provider 和原生适配分别读取实验接口，共用公开状态协议及 React 展示；仅上下文可见时读取，不恢复会话、不轮询、不落盘。

**Tech Stack:** TypeScript、React Query、Fastify、Rust、Tauri、Vitest。

## Global Constraints

- 遵守两端原生传输边界，关键执行位置添加中文注释。
- 上游固定 rust-v0.166.0，thread/memory/read 返回 summary，null 是正常结果。
- 按用户后续要求，摘要模块仅在有非空白内容时显示；移除内部说明和空状态，刷新采用 MCP 同规格图标按钮。
- 不修改其他任务登记中的 CHANGELOG 和发布文件；说明写入独立文档。

### Task 1: 接入两端只读摘要与共享展示

**Files:**

- Create: `packages/protocol/src/thread-memory.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/engine-router.ts`
- Modify: `packages/provider-codex/src/agent-provider-turns.ts`
- Modify: `packages/provider-codex/src/runtime-project-provider.ts`
- Create: `packages/server/src/routes/task-memory-routes.ts`
- Modify: `packages/server/src/routes/task-routes.ts`
- Modify: `packages/client/src/http-client-tasks.ts`
- Create: `packages/ui/src/core/thread-memory-section.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `desktop/src/platform/tauri/catalog-client.ts`
- Create: `packages/provider-codex/src/codex-thread-memory.ts`
- Modify: `desktop/src-tauri/src/application/workflow_commands.rs`
- Create: `desktop/src-tauri/src/infrastructure/codex/thread_memory.rs`
- Modify: `desktop/src-tauri/src/infrastructure/codex/mod.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src-tauri/build.rs`
- Modify: `desktop/src-tauri/permissions/window-command-sets.toml`
- Test: `packages/provider-codex/src/agent-provider-memory.test.ts`
- Test: `packages/server/src/app-memory.test.ts`
- Test: `packages/client/src/http-client-memory.test.ts`
- Test: `desktop/src/shared/components/core/thread-memory.browser.test.tsx`
- Create: `docs/thread-memory.md`
- Modify: `tests/fixtures/fake-realtime-server.mjs` — 修复 E2E 夹具启动参数与既有官方启动契约不一致，避免浏览器测试在就绪前退出。

**Interfaces:**

- Consumes: `thread/memory/read({threadId}) -> {summary: string | null}`。
- Produces: `AgentThreadMemory`，区分 ready、not_loaded、unsupported；读取失败保留错误。

**Behavior:**

- 仅打开上下文时查询，按项目和任务隔离，不自动恢复历史会话，空摘要隐藏整个模块；共享正文安全按纯文本显示，保留换行，支持手动刷新与重试。

**Stop Conditions:**

- 官方固定版本无法确认响应或任务归属无法校验时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/agent-provider-memory.test.ts packages/server/src/app-memory.test.ts`

Expected: 有摘要、null、未加载、旧版本不支持、真实错误及路由归属测试通过。

## 执行与交接记录

- 当前任务登记：`thread-memory-20261102`，执行者 `codex-thread-memory`。
- 官方契约：读取本地 Git 的 `rust-v0.166.0` 标签，核对 `memory.rs` 和 `request_processors/thread_memory.rs`；用户随后明确要求将本机源码工作区切换到该标签，已完成，提交 `6ff1e1ca3b`，源码工作区干净。
- TDD RED：`pnpm exec vitest run packages/provider-codex/src/agent-provider-memory.test.ts`，5 项因缺失 `readThreadMemory` 失败；GREEN：实现后 5 项通过。最终协议、HTTP 路由和客户端定向共 10 项通过，覆盖正文、null、缺失字段、未加载、方法不存在、真实错误、任务归属、编码和取消传播。
- 简化结果：changed。将 RPC 适配提取为 `codex-thread-memory.ts`，避免已有 500 行文件膨胀；原生客户端方法复用 Catalog 客户端基类。共享 React 查询与展示只实现一次。根协议将 server-metrics 的完整同名导出改为星号导出，导出集合不变。
- 新执行并通过：`pnpm test`（670 个文件、3919 项通过，6 个文件/12 项既有跳过）；`pnpm --dir desktop check:web`（688 项单元测试、静态检查、权限检查、现代和 Legacy 构建及预算）；`pnpm --dir desktop check:rust`（Clippy、817 项原生测试及其他目标、6 项 Release 性能基线）；`pnpm test:performance`（17 项）。
- 新执行并通过：共享浏览器 `thread-memory.browser.test.tsx`，Chromium/WebKit 共 4 项，覆盖 320px 换行、空值、刷新、错误重试、任务隔离、卸载缓存和安全正文；Playwright 的 inspector-mobile/inspector-desktop 共 16 项通过；实时路径夹具回归 4 项通过。
- 新执行并通过：`pnpm build`、`pnpm bundle:check`、`pnpm package:check`、`pnpm typecheck`、`pnpm lint`、`pnpm lint:architecture`、`pnpm codex:schema:check`、`pnpm format:check`、`git diff --check`。Web 首屏 351.28 KiB / 360 KiB，工作台就绪 512.34 KiB / 520 KiB。
- 复用证据：上述原生与桌面完整检查运行于最后相关实现之后；后续仅调整根导出组织、HTTP 客户端测试断言和 E2E 启动夹具，分别由最终根测试、构建、定向浏览器和实时测试校验，无须重复原生 Release 编译。
- 验证期间修正：客户端传输会合并超时信号，取消测试改为验证实际取消传播；Fake realtime server 缺少既有 `features.plugin_discovery_prefetch=false` 参数导致 E2E 就绪前退出，补齐后 16 项通过。这两次旧失败不作为最终通过证据。
- 规范结果：update，更新 `.superwork/spec/provider-codex/backend/index.md` 并链接 `docs/thread-memory.md`，记录 null、未加载、实验能力、两端只读链路与按需缓存约束。未修改其他任务负责的 CHANGELOG/发布文档。
- 验证环境为本机 macOS；未执行 Windows/Ubuntu 真机测试。接口为实验能力，展示所选版本的摘要，不宣称完整模型上下文或逐步推理。

## 展示收敛：2026-11-02

- 用户明确要求产品界面仅在有摘要时展示；已移除内部说明、空值、未加载、接口不支持及首次错误的提示，整个模块在无可读内容时返回 null。
- 刷新与 MCP 一致，使用 RefreshCw、28px icon-sm、Tooltip、忙碌禁用和旋转动画；刷新失败保留已有正文供重试，成功返回空值后隐藏。
- 共用组件同时覆盖 Web/移动浏览器和桌面，传输与会话生命周期不变。同步更新用户文档和 Provider 规范中的展示规则，此规则替代前文首次实现的空状态说明。
- 当前登记：thread-memory-polish-20261102 / codex-thread-memory-polish。
- RED：共享浏览器测试 12 项因旧模块显示空提示、刷新按钮仍有文字而失败；GREEN：同一套 Chromium/WebKit 测试 12 项通过，包含空值/空白/未加载/不支持/首次失败隐藏、图标规格、窄屏、安全文本、刷新后隐藏、错误保留旧正文及缓存清理。
- 新验证：Web 上下文与 MCP 定向测试 20 项通过；两端 typecheck、lint、依赖边界、格式检查通过；Web 与桌面生产构建通过。后续检查阶段无额外简化（no-change），仅收敛文案、条件渲染和图标入口。
- 原生与接口行为未改动，沿用前述已通过的协议和 Rust 验证；本次不重复执行无关的后台完整套件。
