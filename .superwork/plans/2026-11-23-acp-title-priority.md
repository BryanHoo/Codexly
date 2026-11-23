# ACP 标题优先级实施计划

**Goal:** Web 与桌面均按手动命名、Agent 上报、自动生成的顺序展示任务标题。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 双端验证约束。
- `.superwork/spec/core/shared/index.md` — ACP 目录和标题规则。
- `.superwork/spec/desktop/backend/index.md` — 原生目录与宿主边界。

**Architecture:** 共享 SQLite 在一个事务内保存标题来源并写出有效标题。ACP 宿主通过现有目录及任务元数据事件交付结果。

**Tech Stack:** TypeScript、JavaScript、Rust、SQLite、Vitest

## Global Constraints

- 两端使用同源 SQL，保留已有任务标题和旧版数据库的列结构。
- 仅处理绑定会话的标题通知，关键执行边界使用中文注释。
- 标题变更复用现有任务元数据事件，避免重读聊天正文。

### Task 1: 目录事务解析有效标题

**Files:**

- Modify: `packages/protocol/src/acp-task-title-sql.json`
- Modify: `packages/core/src/local-catalog.ts`
- Modify: `packages/server/src/acp-task-title-worker.js`
- Modify: `packages/server/src/local-catalog-worker.js`
- Test: `packages/server/src/acp-task-titles-store.test.ts`
- Modify: `desktop/src-tauri/src/infrastructure/local_catalog/acp_task_titles.rs`
- Test: `desktop/src-tauri/src/infrastructure/local_catalog/acp_task_titles_tests.rs`
- Modify: `desktop/src-tauri/src/infrastructure/local_catalog/operations.rs`
- Modify: `desktop/src-tauri/src/application/claude_host/workers.rs`

**Interfaces:**

- Consumes: `task.patch`、`acp.title.finish`、已持久化会话绑定。
- Produces: `acp.title.agent` 和带来源的有效目录标题。

**Behavior:**

- 自动标题可被当前会话上报覆盖。Agent 清空后回退到已生成名称。同名手动保存也取得最高优先级。
- 旧目录无来源的已有名称按手动名称保护。过期绑定、归档及跨作用域写入不得修改标题。

**Stop Conditions:**

- 共享 SQL 不能在两端安全执行，或事务损害旧目录兼容性时重新核对实现边界。

- [x] **Task Status:** completed

Run: `pnpm test packages/server/src/acp-task-titles-store.test.ts`

Expected: 标题优先级、来源持久化及目录并发回归通过。

### Task 2: 实时路由和双端展示

**Files:**

- Modify: `.superwork/spec/core/shared/index.md`
- Modify: `docs/acp-integration-audit.md`
- Modify: `packages/provider-acp/src/provider.ts`
- Modify: `packages/provider-acp/src/provider-session-events.ts`
- Modify: `packages/provider-acp/src/task-management.ts`
- Test: `packages/provider-acp/src/provider.test.ts`
- Test: `packages/provider-acp/src/provider.test-support.ts`
- Modify: `packages/frontend-core/src/task-view-selectors.ts`
- Test: `packages/frontend-core/src/testing/task-event-replay.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-shell-runtime.tsx`

**Interfaces:**

- Consumes: `session_info_update`、`acp.title.agent`。
- Produces: `task.metadata_changed` 的有效标题与任务快照。

**Behavior:**

- 当前绑定会话上报或清空标题时更新目录和界面。忽略子会话和临时辅助会话的标题写入。
- 只展示已按优先级求值的标题，统一实时事件和快照。

**Stop Conditions:**

- ACP 协议读取发生串行锁回等待，或快照可能吞掉标题事件时先修正交付顺序。

- [x] **Task Status:** completed

Run: `pnpm test packages/provider-acp/src/provider.test.ts apps/web/src/features/conversation/runtime/task-store-event-replay.test.ts`

Expected: SDK 对端通知、目录回写和共享实时展示通过。

## 验证结果

- Web 目录事务 5 项通过。桌面原生目录 4 项和宿主反向目录请求回归通过。覆盖 Agent 覆盖自动名称、清空回退、同名手动锁定与旧记录保留。
- ACP、Web 目录和事件回放共通过 345 项，桌面事件回放通过 18 项，编译 ACP 宿主通过 12 项。
- 双端类型检查、静态检查、改动文件格式及架构校验通过。两端共享的标题行为收录在工程规范。
