# Project Git Status Coordinator Implementation Plan

**Goal:** 将 Git 状态刷新收敛为每个 Project 一个调度器，在任意 Task 运行时使用 10 秒兜底刷新，并在文件变更与 Turn 终态执行合并后的权威刷新。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/hook-guidelines.md` — 约束 Query 取消、Timer 清理和浏览器副作用。
- `.superwork/spec/frontend/state-management.md` — 约束 Project Runtime、Task Activity、Git Query 和终态刷新。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束后台子进程生命周期和 Git 读取。
- `.superwork/spec/backend/quality-guidelines.md` — 约束子进程安全、错误和验证范围。

**Architecture:** 在 `ProjectProvider` 生命周期内创建 Project 级 Git 状态协调器，由共享 Project Runtime 的 `turn.started`、`item.completed(file_change)` 与 `turn.completed` 事件驱动；协调器按 Project 维护活动 Task、单一 10 秒 Timer、in-flight Promise 和一次 pending refresh。Workbench 仅消费共享 Query Cache 和提供手动刷新，不再自行拥有轮询或终态 Effect。后台 `git status` 禁用 optional locks，避免与用户 Git 操作争锁。

**Tech Stack:** TypeScript、React 19、TanStack Query 5、Vitest、Node.js `child_process`

## Global Constraints

- 每个 Project 最多一个轮询 Timer，不按 Task 或 Query Observer 创建 Timer。
- 首个活动 Task 开始时立即刷新；`file_change` 完成事件合并刷新；每个 Turn 终态强制刷新。
- 最后一个 Task 完成后等待最终刷新结束，再停止该 Project 的轮询状态。
- 同一 Project 的刷新不得并发；刷新期间的新触发最多形成一次后续刷新。
- 页面隐藏时跳过周期刷新，但不跳过文件变更、终态或手动刷新。
- 保持现有 `ProjectGitStatus` 协议和完整 diff 行为，本次不引入 watcher 或新 HTTP 端点。
- 关键生命周期与并发逻辑添加简短、明确的中文注释。

### Task 1: 扩展 Project Runtime Git 生命周期信号

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/project-runtime.ts`
- Test: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`

**Interfaces:**

- Consumes: `AgentEvent`, `ProjectRuntimeManagerOptions`
- Produces: `onProjectGitActivity(projectId, taskId, reason)`，其中 reason 为 `turn_started | file_changed | turn_completed`

**Behavior:**

- 在乐观 `markTaskRunning`、实时 `turn.started`、完成的 `file_change` Item 与 `turn.completed` 上发出 Project 级 Git 生命周期信号；重复的实时 `turn.started` 不得破坏后续协调器的 Set 幂等语义。

**Stop Conditions:**

- 如果 Provider 不会通过现有 `item.completed` 交付 `file_change`，停止并重新确认事件契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/project-runtime.test.ts`

Expected: Project Runtime 的文件变更和 Turn 生命周期信号测试通过。

### Task 2: 实现 Project 级单一 Git 状态协调器

**Files:**

- Create: `apps/web/src/features/projects/project-git-status-coordinator.ts`
- Create: `apps/web/src/features/projects/project-git-status-coordinator.test.ts`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`

**Interfaces:**

- Consumes: `QueryClient`, `CodeAgentGitStatusClient`, Project Git 生命周期信号
- Produces: `ProjectGitStatusCoordinator`、`PROJECT_GIT_STATUS_POLL_INTERVAL_MS = 10_000`

**Behavior:**

- 每个 Project 维护一个活动 Task Set 和一个 Timer；首个 Task 开始时刷新，周期刷新遵守页面可见性，文件事件合并刷新，终态刷新后在无活动 Task 时释放状态；所有刷新按 Project 串行并合并 pending 请求，失败后停止周期刷新直至新生命周期或手动恢复。

**Stop Conditions:**

- 如果 Query Cache 无法在无 Observer 时执行可取消的权威刷新，停止并改用单一 `QueryObserver`，不得恢复组件级 Timer。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/project-git-status-coordinator.test.ts apps/web/src/features/projects/project-queries.test.tsx`

Expected: 10 秒间隔、同 Project 单 Timer、跨 Task 生命周期、并发合并和失败恢复测试通过。

### Task 3: 将 Workbench 改为共享 Git Query 消费者

**Files:**

- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Test: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `ProjectRuntimeManagerOptions.onProjectGitActivity`, `ProjectGitStatusCoordinator`, `projectGitStatusQueryOptions`
- Produces: ProjectProvider 统一调度与 Workbench 只读共享 Git Query

**Behavior:**

- ProjectProvider 在自身生命周期创建并释放协调器；Workbench 不再根据当前 Task 创建轮询或本地终态刷新，但保留首次查询、手动刷新、回滚刷新和提交成功失效行为。

**Stop Conditions:**

- 如果现有 Query 消费者依赖 `isTaskRunning` 改变 Query Key 或响应结构，停止并修正消费者，不保留旧轮询参数。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-inspector.test.tsx && pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "project file tree opens diffs"`

Expected: Inspector Git 状态展示和关键文件交互不回归，Workbench 不再拥有 Task 级 Git Timer。

### Task 4: 优化后台 Git 状态子进程锁行为

**Files:**

- Modify: `packages/server/src/git-working-tree.ts`
- Test: `packages/server/src/git-working-tree.test.ts`

**Interfaces:**

- Consumes: `execFile`, Git `GIT_OPTIONAL_LOCKS`
- Produces: 不获取可选索引锁的只读后台 Git 命令

**Behavior:**

- 所有 Git Working Tree 只读命令继承现有环境并固定设置 `GIT_OPTIONAL_LOCKS=0`，保持参数数组、输出上限、超时和 Windows 隐藏窗口配置。

**Stop Conditions:**

- 如果测试无法在不暴露内部执行器的情况下验证环境，保留真实 Git 行为测试并由代码审查确认 env 装配，不扩大公开接口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/git-working-tree.test.ts`

Expected: Git Working Tree 全部真实与注入测试通过，后台命令保持只读行为。

### Task 5: 固化生命周期规范并完成质量门禁

**Files:**

- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/plans/2026-08-01-project-git-status-coordinator.md`

**Interfaces:**

- Consumes: 已验证的 Project Git 调度行为和后台 Git 命令约束
- Produces: 可持续执行的工程规范和完成状态

**Behavior:**

- 记录每 Project 单协调器、10 秒兜底、文件事件刷新、Turn 最终刷新、最后活动 Task 后停止，以及后台状态命令禁用 optional locks；运行完整质量门禁。

**Stop Conditions:**

- 如果 `pnpm check` 或相关 E2E 出现本次改动导致的失败，停止完成标记并修复后重跑。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全部格式、Lint、架构、单元测试、构建、打包检查与 E2E 通过。
