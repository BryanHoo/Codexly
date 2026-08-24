# Feature Implementation Plan

**Goal:** 在 Codex Provider 边界限制实时 File Patch 与 Turn Diff 事件载荷，避免超大事件进入 WebSocket 和浏览器长期状态。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、边界适配和验证方式。
- `.superwork/spec/backend/runtime-lifecycle.md` — 定义 Codex 通知映射和事件流资源边界。
- `.superwork/spec/frontend/state-management.md` — 定义 File Change、Turn Diff 的快照替换与浏览器内存边界。
- `.superwork/spec/shared/quality-guidelines.md` — 要求协议 Schema、消费者和契约测试同步更新。

**Architecture:** 在 `packages/protocol` 声明实时 Diff 的数组与字节预算及必填截断元数据；在 `packages/provider-codex` 将原生通知映射为受 UTF-8 聚合预算约束的统一事件。Server、Client 和 Web 继续消费同一严格协议，状态层只接收已受限载荷。

**Tech Stack:** TypeScript、TypeBox、Vitest、pnpm workspace

## Global Constraints

- 使用 UTF-8 字节数而非 JavaScript 字符数执行 512 KiB 聚合预算，且截断结果不得包含损坏字符。
- File Patch 最多保留 100 个变更，并以原始全部 diff 的 UTF-8 字节总数填写 `originalByteLength`。
- `truncated` 在数组数量或聚合字节任一预算生效时为 `true`；不保留旧协议分支。
- 不改变 Server 的事件顺序、合并和反压语义，不启动开发服务器。

### Task 1: 收紧实时 Diff 协议

**Files:**

- Modify: `packages/protocol/src/agent-event.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/agent-event.test.ts`

**Interfaces:**

- Consumes: `AgentFileChangeSchema`
- Produces: `FileChangeUpdatedEventSchema`、`TurnDiffUpdatedEventSchema`、公开实时 Diff 限制常量

**Behavior:**

- 要求两个实时 Diff 事件携带 `truncated` 和 `originalByteLength`，并通过 Schema 拒绝超出变更数量上限或缺失元数据的事件。

**Stop Conditions:**

- 协议字段无法在 Provider 与所有现有消费者间保持严格一致时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/agent-event.test.ts`

Expected: Agent Event 契约测试通过，并覆盖新增边界字段与数组上限。

### Task 2: 在 Codex Provider 边界限制实时载荷

**Files:**

- Create: `packages/provider-codex/src/codex-diff-mapping.ts`
- Modify: `packages/provider-codex/src/codex-event-mapping.ts`
- Test: `packages/provider-codex/src/codex-protocol-mapping.test.ts`

**Interfaces:**

- Consumes: Codex `item/fileChange/patchUpdated`、`turn/diff/updated` Notification
- Produces: 有界 `AgentProviderEvent` File Patch 与 Turn Diff 载荷

**Behavior:**

- 计算原始 UTF-8 字节数，在 512 KiB 聚合预算和 100 项数组预算内保留前缀，设置准确截断元数据，并覆盖 ASCII、多字节字符、数组超限和未截断场景。

**Stop Conditions:**

- 无法保证截断后的字符串为有效 UTF-8 或元数据不能表示原始载荷时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/codex-protocol-mapping.test.ts`

Expected: Codex 映射测试通过，所有实时 Diff 输出均满足协议预算。

### Task 3: 同步消费者夹具与工程规范

**Files:**

- Modify: `packages/server/src/agent-event-stream.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store.test.ts`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 更新后的 `AgentEvent` 判别联合
- Produces: Server/Web 类型一致的测试夹具与持久工程约束

**Behavior:**

- 为所有手工构造的实时 Diff 事件补充元数据，证明 Server 合并和 Web 状态更新仍保留受限内容，并记录 Provider 边界预算。

**Stop Conditions:**

- 新字段导致非 Diff 事件或 Snapshot 契约发生无关变化时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/agent-event-stream.test.ts apps/web/src/features/conversation/runtime/task-store.test.ts apps/web/src/features/workbench/components/task-timeline.test.tsx`

Expected: Server 与 Web 定向测试通过，实时事件仍按最新快照替换。

### Task 4: 完成全量门禁

**Files:**

- Verify: `package.json`
- Verify: `tests/e2e/**`

**Interfaces:**

- Consumes: 完整 Workspace 构建、静态检查和测试配置
- Produces: 最终验证证据

**Behavior:**

- 运行项目规定的全量检查，确认严格类型、Schema、依赖边界和既有测试均无回归；该改动不改变页面交互，因此不额外启动开发服务器。

**Stop Conditions:**

- `pnpm check` 出现与本次改动无关且无法安全修复的既有失败时，记录完整阻塞信息并停止。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: Workspace 全量检查通过。
