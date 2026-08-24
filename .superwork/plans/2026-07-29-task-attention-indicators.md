# Feature Implementation Plan

**Goal:** 在左栏 Task 行展示未查看的审批与 AI 回复完成标记，并在用户进入对应 Task 后清除标记。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/state-management.md` — 约束 Sidebar Activity 按 `projectId + taskId` 保存且不复制完整 Timeline。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Task 行稳定状态位、可访问状态与图标优先级。
- `.superwork/spec/frontend/quality-guidelines.md` — 要求用 Vitest 与 Playwright 验证可观察行为。

**Architecture:** 扩展现有 Project Runtime 的轻量 Task Activity 记录，独立保存未查看的 `approval` 或 `completed` 提醒；事件只为非当前 Task 产生提醒，路由进入 Task 时通过 Runtime Manager 清除。Sidebar 在原有稳定状态位中按审批、运行、完成、更新时间的优先级渲染。

**Tech Stack:** TypeScript、React 19、Zustand 风格外部 Store、Vitest、Playwright、pnpm workspace。

## Global Constraints

- 保持 Task Activity 仅保存轻量状态，并始终以 `projectId + taskId` 隔离。
- 不修改 Protocol 或 Server，不持久化提醒状态，不从 Task 历史推断所有旧回复为未查看。
- 当前 Task 仍可保留真实运行状态，但审批/完成提醒在进入后必须清除。
- 图标必须具有可访问名称，并复用现有 Task 行右侧稳定状态位置。

### Task 1: 建立可消费的 Task 待关注状态

- [x] **Task Status:** completed

**Files:**

- 修改 `apps/web/src/features/conversation/runtime/task-activity.ts`、`apps/web/src/features/conversation/runtime/project-runtime.ts`、`apps/web/src/features/projects/project-context.tsx`、`apps/web/src/features/workbench/components/workbench-shell.tsx`。
- 测试 `apps/web/src/features/conversation/runtime/task-activity.test.ts`、`apps/web/src/features/conversation/runtime/project-runtime.test.ts`。

**Interfaces:**

- Consumes: `TaskActivityMap: ReadonlyMap<string, TaskActivityRecord>`
- Produces: `TaskActivity.attention: "approval" | "completed" | null`
- Produces: `ProjectRuntimeManager.viewTask(projectId: string, taskId?: string): void`

- **Behavior Slice:** `pending_request.created` 为非当前 Task 记录 `approval`，`turn.completed` 为非当前 Task 记录 `completed`，审批优先于运行状态；进入对应 Task 立即清除提醒，后续离开后发生的新事件仍可重新产生提醒。
- **Proof:** 单元测试覆盖完成提醒、审批提醒、进入清除、当前 Task 事件不重复提醒，以及其他 Task 状态不受影响。

**Verification:**

- Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-activity.test.ts apps/web/src/features/conversation/runtime/project-runtime.test.ts`
- Expected: 相关 Vitest 用例全部通过，且新增断言覆盖提醒产生与清除。

**Stop Conditions:**

- 若现有测试脚本不支持文件过滤，则修订为仓库实际 Vitest 命令。
- 若进入 Task 的路由层无法稳定通知 Runtime Manager，则先修复计划接口，不在 Link 点击前乐观清除。

### Task 2: 渲染并验证 Sidebar 提醒图标

- [x] **Task Status:** completed

**Files:**

- 修改 `apps/web/src/features/workbench/components/project-sidebar.tsx`、`tests/e2e/app-shell.spec.ts`。
- 按稳定规范更新 `.superwork/spec/frontend/component-guidelines.md`。

**Interfaces:**

- Consumes: `TaskActivity.attention: "approval" | "completed" | null`
- Produces: `TaskStatusIndicator.attention: "approval" | "completed" | null`

- **Behavior Slice:** 非当前 Task 等待审批时显示审批图标，AI 回复完成时显示完成图标；进入 Task 后提醒消失并回到运行或更新时间状态；Pinned 与 Projects 两处使用一致状态。
- **Proof:** 组件/E2E 断言可访问名称“任务等待审批”和“AI 回复已完成”，并验证点击对应 Task 后标记消失。

**Verification:**

- Run: `pnpm test:e2e`
- Expected: Sidebar 提醒流程与既有工作台流程全部通过。

**Stop Conditions:**

- 若 E2E Fake Server 无法发出目标 Task 的实时事件，先补充受控场景，不用定时等待或实现细节断言替代用户行为。
- 若图标导致状态位布局变化，则先修正稳定尺寸再继续。

### Task 3: 完成仓库级验证

- [x] **Task Status:** completed

**Files:**

- 检查本计划涉及的全部修改文件。

**Interfaces:**

- Consumes: `TaskStatusIndicator.attention: "approval" | "completed" | null`
- Produces: `VerificationResult: pnpm check + pnpm test:e2e`

- **Behavior Slice:** 确认提醒状态不影响 Project Runtime 的运行/审批保活判定，归档仍清理完整 Task Activity，且没有引入跨包依赖。
- **Proof:** 基础门禁与完整 E2E 均成功，无新增格式、类型、Lint 或依赖错误。

**Verification:**

- Run: `pnpm check`
- Run: `pnpm test:e2e`
- Expected: 两个命令退出码均为 0。

**Stop Conditions:**

- 任一失败若与本改动相关则返回对应 Task 修复。
- 若确认是既有或环境失败，记录完整证据并停止宣称通过。
