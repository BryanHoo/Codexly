# Subagent Context Inspector Implementation Plan

**Goal:** 每个子代理在右侧“上下文”页签的“子代理”栏目中独立展示，单击后通过弹窗查看实时或历史输出；中间 Task Timeline 只保留不可点击的简洁协作状态。

## Constraints

- 子代理详情继续按子线程 `taskId` 挂载独立 Runtime，不能使用父协作 Item 的摘要替代完整输出。
- 运行中、待处理、失败和完成状态沿用现有映射与优先级。
- 当前 Task Snapshot 是子代理列表的唯一来源，不新增 Protocol 或 Server 字段。
- Timeline 不再持有子代理弹窗选择，也不提供详情入口。
- 关键状态衔接处添加简短、清晰的中文注释。

### Task 1: 固化 Timeline 与 Inspector 的展示边界

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

**Behavior Slice:** Timeline 只展示简洁协作状态；Inspector 的上下文页签按子代理逐项展示任务、模型、状态和详情弹窗入口。

**Verification:**

`pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

### Task 2: 提取子代理视图模型并移动详情交互

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/features/workbench/components/subagent.ts`
- Create: `apps/web/src/features/workbench/components/subagent-output-dialog.tsx`
- Create: `apps/web/src/features/workbench/components/subagent.test.ts`
- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`

**Behavior Slice:** 从活动 Snapshot 派生稳定的子代理列表；Workbench Shell 管理选择并挂载详情弹窗；Timeline 删除详情状态和旧入口。

### Task 3: 更新稳定规范并完成验证

- [x] **Task Status:** completed

**Files:**

- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Verification:**

- 运行定向 Vitest。
- 运行 `pnpm check`。
- 运行 `pnpm test:e2e`。
- 检查最终 Diff 与工作树状态。

## Verification Result

- 定向 Vitest：3 个文件、25 个测试通过。
- `pnpm check`：通过，包含格式、Lint、依赖边界、293 个 Vitest、类型检查、Web/Node 构建和打包校验；依赖检查保留仓库既有的 2 个 orphan warning。
- 子代理浏览器流程：单独运行通过，确认 Inspector 默认进入上下文、打开/关闭详情并重新订阅子线程输出。
- 完整 Playwright：目标流程和其余 45 个流程通过；`realtime delta buffer overflow` 与 `WebSocket reconnect` 两个既有实时恢复用例因 Snapshot 请求计数未增加而失败，单独复跑仍可复现，与本次子代理展示边界无关。

## Stop Conditions

- 当前 Snapshot 无法稳定提供子线程 Task ID 或状态。
- 详情迁移要求为同一子线程建立多个并行 Runtime 订阅。
