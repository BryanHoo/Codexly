# 归一化 Task Runtime Store 实施计划

**Goal:** 将高频 Agent Delta 从完整 Snapshot React State 迁移到 `zustand/vanilla` Task Store，使已完成 Turn 和未变化 Item 保持引用稳定，Timeline 只订阅结构变化与当前流式 Item，并按 LRU 回收未选中的 Store。

## Global Constraints

- Store 身份必须同时包含 `projectId` 与 `taskId`。
- 保留现有 Snapshot checkpoint、Sequence 去重、Delta 动画帧合并、关键事件前冲刷、重连和溢出恢复语义。
- `turn.completed` 与 `item.completed` 继续作为权威终态；非重试 Provider Error 不得被缺失错误字段的终态覆盖。
- Turn、Item 与 Pending Request 按 ID 归一化；只替换发生变化的实体引用。
- Timeline 根节点不订阅 Item 内容；Turn 订阅自身结构，Item 组件按 `itemId` 原子订阅。
- LRU 只能回收没有消费者的 Store；最后一个消费者释放时关闭实时传输，重新选中后从权威 Snapshot 校准，因此冻结在运行中、待处理或未 Hydrate 状态的非活动 Store 也必须可回收。
- 不保留新的全量 Snapshot 高频渲染兼容路径。
- 关键状态边界和顺序逻辑使用简短清晰的中文注释。

### Task 1: 建立归一化纯状态与 Vanilla Store

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/features/conversation/runtime/task-store.ts`
- Create: `apps/web/src/features/conversation/runtime/task-store.test.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-workspace.yaml`

**Behavior Slice:** Snapshot 原子归一化为 Task 元数据、`turnIds`、`turnsById`、`itemIdsByTurnId`、`itemsById`、`pendingRequestIds` 与 `pendingRequestsById`；事件按 ID O(1) 定位，只替换受影响实体。

**Proof:** 测试证明 Delta 不改变已完成 Turn、其他 Item 和 Item 顺序数组引用；终态、错误、Usage 与 Pending Request 行为保持一致。

### Task 2: 建立共享 Store 注册表与 LRU

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/task-store.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store.test.ts`

**Behavior Slice:** 使用 `projectId + taskId` 获取 Store；消费者 acquire/release；超过容量时按最近访问顺序回收安全的未选中 Store。

**Proof:** 测试覆盖同 Task 复用、跨 Project 隔离、仍有消费者不回收、不同 Hydration 状态的非活动 Store 均可进入 LRU，以及重新打开已回收 Task 时创建新 Store。

### Task 3: 迁移实时 Hook 到共享 Store

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/use-task-runtime.ts`
- Modify: `apps/web/src/features/conversation/runtime/use-task-runtime.test.ts`

**Behavior Slice:** Hook 保留 Query、WebSocket、Delta Buffer 与恢复控制器职责，状态写入共享 Vanilla Store；React 只订阅连接、错误、加载、Task 状态和标题等低频字段。

**Proof:** 测试覆盖活动 Task 身份隔离、共享 Store 和释放行为；现有实时 reducer/buffer 测试继续通过。

### Task 4: Timeline 使用 Turn/Item 原子订阅

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`

**Behavior Slice:** Timeline 根节点只订阅 Turn ID 与 Pending Request ID；Turn 组件订阅自身与 Item ID 顺序；具体 Item 按 ID 订阅。完成态聚合仅在该 Turn 实体变化时运行，流式 Delta 只更新对应 Item 子树。

**Proof:** 保留现有可见行为测试，并增加 Store 引用/订阅隔离测试作为渲染性能契约。

### Task 5: 收敛 Workbench 消费与文档

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/subagent-output-dialog.tsx`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `docs/web-design.md`

**Behavior Slice:** Workbench 使用低频 Task 字段和按需快照读取，不再因文本 Delta 重渲染；子代理输出复用相同 Store 渲染边界；文档记录实际 Store 生命周期与 LRU 安全条件。

**Proof:** 聚焦组件测试、`pnpm typecheck`、`pnpm check` 和 `pnpm test:e2e` 全部通过。

## Stop Conditions

- 若同一 Task 的多个 Hook 无法共享单一网络控制器，停止并先明确注册表的控制器所有权，不能接受重复 WebSocket。
- 若 Timeline 仍需要在每个 Delta 上反归一化完整 Snapshot，停止并继续拆分消费边界，不能以兼容适配器掩盖性能回归。
- 若最后一个消费者释放时无法可靠关闭实时传输，停止回收该 Store，优先保证运行时正确性。
