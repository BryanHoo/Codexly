# Task History Ownership Implementation Plan

**Goal:** Task Snapshot 注入归一化 Store 后释放 Query 大型历史，并避免常驻兼容快照。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/state-management.md` — 约束 Snapshot、Task Store、缓存预算和按需重建边界
- `.superwork/spec/frontend/hook-guidelines.md` — 约束 HTTP Snapshot、取消和 Runtime 清理
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Timeline 与 Inspector 的 Store 消费路径
- `.superwork/spec/frontend/quality-guidelines.md` — 约束长历史性能与 Vitest 验证

**Architecture:** 将 HTTP Snapshot 定义为一次性传输载荷；TaskStore 完成 reconcile 和事件接入后删除对应 Query 数据。Runtime 只暴露轻量元数据、归一化 Store 和显式兼容快照读取函数，常用 UI 通过 Store selector 读取所需实体，Inspector 等低频消费者才重建完整 Snapshot。

**Tech Stack:** TypeScript、React、TanStack Query、Zustand、Vitest、pnpm

## Global Constraints

- 遵守 `.superwork/spec/frontend/state-management.md` 的 Task Store 单一完整历史、缓存容量和恢复语义。
- 生产 TypeScript 文件不得超过 500 行；关键所有权转移与并发清理位置添加简短中文注释。
- 不保留旧的常驻 `runtime.snapshot` 兼容路径。

### Task 1: 转移 Snapshot 数据所有权

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/use-task-runtime.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime-events.ts`
- Modify: `apps/web/src/features/projects/project-provider.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Test: `apps/web/src/features/conversation/runtime/use-task-runtime.test.ts`

**Interfaces:**

- Consumes: `AgentTaskSnapshotResponse`、`TaskStore`、TanStack Query task snapshot key
- Produces: 归一化 Store 水合后的 Query Payload 释放和显式 Runtime Snapshot 同步入口

**Behavior:**

- 初始或刷新 Snapshot 完成 Store reconcile 后立即移除对应 Query Cache 完整历史；恢复读取直接返回一次性响应，不建立第二份长期所有权。

**Stop Conditions:**

- 如果 Query 移除会破坏 Snapshot 恢复、Task 身份隔离或设置刷新语义，则停止并先补齐显式 Runtime 同步接口。

- [x] **Task Status:** completed

Run: `pnpm --filter @codexly/web exec vitest run src/features/conversation/runtime/use-task-runtime.test.ts`

Expected: Snapshot 归一化后 Query Cache 不再持有完整响应，Runtime 身份隔离测试通过。

### Task 2: 移除常驻兼容快照消费者

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/task-store-core.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-factory.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-active-task.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-session.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/hooks/use-composer-queue.ts`
- Test: `apps/web/src/features/conversation/runtime/task-store-reconciliation.test.ts`
- Test: `apps/web/src/features/workbench/components/prompt-history.test.ts`

**Interfaces:**

- Consumes: `TaskStoreState.snapshotMetadata`、Turn/Item Store selectors、`reconstructSnapshot()`
- Produces: 轻量 `TaskRuntimeView` 和只在 Inspector/兼容边界调用的完整快照读取

**Behavior:**

- Timeline、Composer、标题与队列状态不再依赖常驻 `runtime.snapshot`；仅 Inspector 或提交兼容边界按需重建完整 Snapshot。

**Stop Conditions:**

- 如果某消费者必须稳定持有完整协议 Snapshot 才能满足公开契约，则停止并将其明确标记为低频兼容边界后再实现。

- [x] **Task Status:** completed

Run: `pnpm --filter @codexly/web exec vitest run src/features/conversation/runtime/task-store-reconciliation.test.ts src/features/workbench/components/prompt-history.test.ts`

Expected: Store selector 与按需重建测试通过，现有 Timeline/Composer 行为不变。

### Task 3: 固化约束并完成门禁

**Files:**

- Modify: `.superwork/spec/frontend/state-management.md`
- Test: `apps/web/src/features/conversation/runtime/use-task-runtime.test.ts`

**Interfaces:**

- Consumes: 完成后的 Snapshot 所有权与低频重建行为
- Produces: 可持续检查的前端状态管理规范和完整质量门禁结果

**Behavior:**

- 明确 HTTP Snapshot 在 Store 接管后释放，验证类型、测试、Lint 和仓库规范均通过。

**Stop Conditions:**

- 如果 `pnpm check` 暴露与本次修改无关的既有失败，记录完整失败命令与首个根因，不修改无关代码。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 仓库完整质量门禁通过。
