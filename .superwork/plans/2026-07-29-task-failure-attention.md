# Feature Implementation Plan

**Goal:** AI 回复异常中断或遇到不可恢复错误时，在非当前 Task 的左栏行显示“回复未完成”标记，并在进入该 Task 后清除。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Task 行状态优先级、可访问性与进入后消费行为。
- `.superwork/spec/frontend/state-management.md` — 约束 Snapshot、实时事件和本地提醒状态的边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Vitest 与 Playwright 验证范围。

**Architecture:** 扩展现有 `TaskAttention` 派生状态，不新增协议或持久化层。终态 `failed`/`interrupted` 及 `provider.error` 的不可重试分支写入失败提醒；重试中错误保持运行态，新 Turn、成功结束或进入 Task 消费旧提醒。侧栏复用现有稳定状态槽展示单一失败图标。

**Tech Stack:** TypeScript、React、Vitest、Playwright、pnpm。

## Global Constraints

- 保持提醒仅存在于 `ProjectRuntimeManager` 的轻量 Task 活动状态，不从历史 Snapshot 推断旧提醒。
- 当前正在查看的 Task 不重复显示提醒；审批标记继续优先于运行与终态标记。
- 不扩展 `AgentEvent` 协议，不启动开发服务器。

### Task 1: 扩展失败提醒状态归约

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/task-activity.ts`
- Test: `apps/web/src/features/conversation/runtime/task-activity.test.ts`
- Test: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`

**Interfaces:**

- Consumes: `AgentEvent`
- Produces: `TaskAttention: "approval" | "completed" | "failed" | null`

- **Behavior Slice:** 非当前 Task 的 `failed`/`interrupted` Turn 和 `willRetry=false` Provider 错误产生 `failed` 提醒；`willRetry=true` 不产生提醒；进入 Task、新 Turn 或后续成功完成会清除或替换失败提醒；空闲 Snapshot 不误删尚未查看的失败提醒。
- **Proof:** 单元测试分别覆盖中断、失败、不可重试错误、重试中错误、恢复与进入消费。

**Verification:**

- Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-activity.test.ts apps/web/src/features/conversation/runtime/project-runtime.test.ts`
- Expected: 相关状态与 Runtime 测试全部通过。

**Stop Conditions:**

- 若协议状态不含 `failed`/`interrupted`、`willRetry` 不表示终止重试，或现有运行时无法区分当前 Task，则停止并修复计划。

### Task 2: 展示并验证回复未完成标记

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Test: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`
- Test: `tests/e2e/app-shell.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: `TaskAttention: "approval" | "completed" | "failed" | null`
- Produces: `TaskStatusIndicator.attention: "approval" | "completed" | "failed" | null`

- **Behavior Slice:** 失败提醒在 Task 行右侧替代更新时间，审批与运行状态仍按既有优先级展示；受控 WebSocket 触发不可恢复错误后出现标记，点击对应 Task 后标记消失。
- **Proof:** 组件测试验证可访问名称、语义色与图标；Playwright 验证后台 Task 的错误标记及点击消费流程。

**Verification:**

- Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-sidebar.test.tsx`
- Run: `pnpm test:e2e`
- Expected: 组件测试与完整浏览器流程全部通过。

**Stop Conditions:**

- 若失败色 Token 或图标库不存在，或 E2E 无法注入终态事件，则停止并调整界面契约或测试装配。

### Task 3: 完成全量验证

- [x] **Task Status:** completed

**Files:**

- Verify: all files modified by Tasks 1-2

**Interfaces:**

- Consumes: `TaskStatusIndicator.attention: "approval" | "completed" | "failed" | null`
- Produces: `VerificationResult: pnpm check + pnpm test:e2e + git diff --check`

- **Behavior Slice:** 确认新增失败提醒不回归审批、运行、完成提醒及 Task 导航。
- **Proof:** 全量检查与 E2E 均通过，`git diff --check` 无输出。

**Verification:**

- Run: `pnpm check`
- Run: `pnpm test:e2e`
- Run: `git diff --check`
- Expected: 所有命令退出码为 0，且没有失败测试或空白错误。

**Stop Conditions:**

- 任一失败与本变更相关时返回对应任务修复；若是既有无关故障，记录完整证据后停止。
