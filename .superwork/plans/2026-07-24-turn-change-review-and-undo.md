# Feature Implementation Plan

**Goal:** 在每次已完成的 AI 回复末尾展示本次文件变更卡片，支持逐文件 Diff、连续审核上一个/下一个文件，并通过 Codex 会话回滚与本地反向补丁共同撤销最新 Turn。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` - 约束 Timeline 文件入口、Diff 弹窗与可访问交互。
- `.superwork/spec/frontend/state-management.md` - 约束 Mutation 幂等、Snapshot 刷新与瞬时状态归属。
- `.superwork/spec/backend/runtime-lifecycle.md` - 约束 Codex RPC、写入顺序与错误边界。
- `.superwork/spec/backend/quality-guidelines.md` - 约束 Project 路径、子进程与 Fastify Schema。

**Architecture:** Timeline 从每个 AI 回复分组聚合 `file_change`，用独立卡片呈现并继续复用单文件 Diff；Workbench Shell 管理连续审核弹窗和撤销 Mutation。统一协议新增最新 Turn 撤销契约；Server 先用受控 `git apply --reverse --check` 验证补丁，再恢复文件并调用 Codex 0.145 的 `thread/rollback({ threadId, numTurns: 1 })`，Provider 失败时正向补偿文件。只允许撤销当前 Task 的最新已完成 Turn，避免历史 Turn 与后续文件修改产生不确定回滚。

**Tech Stack:** TypeScript 6、TypeBox、Fastify 5、React 19、TanStack Query、Codex App Server 0.145、Vitest。

## Global Constraints

- 撤销只开放给最新已完成且包含文件变更的 Turn；运行中或历史 Turn 不可撤销。
- Codex `thread/rollback` 只处理会话历史；本地文件必须通过 Turn 原始 Diff 反向应用。
- 补丁路径只能来自当前 Project 根目录内；禁止绝对越界、路径穿越、二进制和不可解析补丁。
- 文件预检失败时不得调用 Codex；Codex 失败时必须正向补偿已恢复文件。
- Mutation 使用 `Idempotency-Key`；成功后刷新 Task Snapshot 与 Project Git 状态。
- 单独点击文件继续打开原单文件 Diff；“审核”打开同一组文件的连续审核弹窗。
- 关键聚合、补丁安全、补偿和刷新位置添加简短中文注释。

### Task 1: 定义撤销契约与 Codex Provider 映射

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`

**Behavior Slice:** 新增最新 Turn 撤销请求/响应和能力；Provider 严格调用 `thread/rollback`，固定 `numTurns: 1` 并校验返回的更新 Thread。

**Verification:** Run focused Protocol, Core, and Codex Provider Vitest files.

### Task 2: 实现安全文件恢复与幂等 HTTP/Client Mutation

- [x] **Task Status:** completed

**Files:**

- Create: `packages/server/src/turn-file-rollback.ts`
- Create: `packages/server/src/turn-file-rollback.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`

**Behavior Slice:** Server 验证最新已完成 Turn，安全规范化并反向应用其有序 Diff，调用 Provider 回滚；Provider 失败时正向补偿。Client 暴露类型安全撤销方法。

**Verification:** Run focused Server and Client Vitest files.

### Task 3: 构建回复变更卡片与连续审核弹窗

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/diff/file-change.ts`
- Modify: `apps/web/src/features/diff/file-change.test.ts`
- Create: `apps/web/src/features/diff/file-review-dialog.tsx`
- Create: `apps/web/src/features/diff/file-review-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/shared/styles/globals.css`

**Behavior Slice:** 已完成 AI 回复末尾展示文件总数和增删统计；文件行打开单文件 Diff；审核弹窗支持按钮及左右方向键切换；最新 Turn 撤销时显示提交、失败和完成状态。

**Verification:** Run focused Web Vitest files and typecheck.

### Task 4: 固化规范并完成全量验证

- [x] **Task Status:** completed

**Files:**

- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`

**Behavior Slice:** 稳定规范记录回复变更卡片、连续审核及 Codex/文件双阶段撤销约束。

**Verification:** Run `pnpm check`; run targeted browser/E2E verification if fixture exposes file changes.
