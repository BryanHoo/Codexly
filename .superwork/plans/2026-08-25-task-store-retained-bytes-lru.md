# Feature Implementation Plan

**Goal:** 让 Task Store 的非活动内存预算使用增量字节统计和有序 LRU，避免 acquire/release 深度读取 Item 或排序全部 Store。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/state-management.md` — 规定非活动 Task Store 的 UTF-8 字节 LRU、流式 Chunk 热路径和输出淘汰约束。
- `.superwork/spec/frontend/quality-guidelines.md` — 规定状态逻辑与性能回归的 Vitest 验证范围。
- `.superwork/spec/guides/index.md` — 规定项目命令、文件规模和完整质量门禁。

**Architecture:** 在 Task Store 内维护可 O(1) 读取的 `retainedBytes`，Item Store 按新增 Chunk 或权威替换更新自身字节数，Task 级 hydrate/reconcile 建立基线并在历史前插、事件合并和命令输出淘汰时应用差值。Registry 使用 Map 插入顺序维护空闲 Store LRU，并同步维护空闲总字节。

**Tech Stack:** TypeScript、Zustand Vanilla、Vitest、pnpm。

## Global Constraints

- 流式 Delta 不得读取或物化既有 Item 完整字符串，也不得重新编码既有 Chunk。
- Registry 的 acquire/release/remove 不得排序、深度遍历 Store 或二次估算 Payload。
- 生产 TypeScript 文件不得超过 500 行，关键增量统计与 LRU 边界保留简短中文注释。

### Task 1: 建立 Task Store 增量保留字节契约

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/task-store-core.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-events.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-factory.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-snapshot.ts`
- Test: `apps/web/src/features/conversation/runtime/task-store-hydration.test.ts`
- Test: `apps/web/src/features/conversation/runtime/task-store-output.test.ts`

**Interfaces:**

- Consumes: `TaskStoreHydrationResponse`、`AgentEvent`、`TaskItemStore` 流式 Chunk 与命令输出预算。
- Produces: `TaskStoreState.retainedBytes` 和 `TaskItemStore.retainedBytes` 的增量统计契约。

**Behavior:**

- Hydrate/reconcile 建立完整基线；历史前插只增加新 Turn/Item 差值；Delta 只编码新增文本；权威 Item 替换和命令输出淘汰按前后值更新差额。

**Stop Conditions:**

- 若现有 Item 生命周期无法在不扫描完整 Timeline 的前提下识别新增、替换和移除实体，则停止并重新固定 Item 变更接口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-store-hydration.test.ts apps/web/src/features/conversation/runtime/task-store-output.test.ts`

Expected: 增量字节断言通过，Delta 热路径测试确认未调用 `read()` 且只编码新增 Chunk。

### Task 2: 使用空闲总字节和有序 Map 实现 Registry LRU

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/task-store-registry.ts`
- Test: `apps/web/src/features/conversation/runtime/task-store-registry.test.ts`
- Test: `apps/web/src/features/conversation/runtime/task-store.performance.test.ts`

**Interfaces:**

- Consumes: `TaskStoreState.retainedBytes`、`TaskStoreRegistryOptions` 和最后消费者 release 生命周期。
- Produces: O(1) 空闲 Store 登记/移除、空闲总字节维护和从最旧端逐项淘汰的 Registry 行为。

**Behavior:**

- acquire 从空闲 LRU 摘除 Store，release 到零时以当前增量字节登记到最新端；超出 Entry 或字节预算时只从最旧端淘汰，不调用 Item `read()`、不排序全部候选。

**Stop Conditions:**

- 若 Store 在无消费者时仍可被异步修改，则停止并为 Registry 增加显式字节变化订阅后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-store-registry.test.ts && pnpm test:performance`

Expected: LRU、字节预算和无深度读取回归通过，固定性能负载保持在预算内。
