# Click Action Single-Flight Implementation Plan

**Goal:** 所有会触发异步副作用的主要点击操作在前一次结果未确定前只执行一次，并同步进入禁用或忙碌状态。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束请求期间禁用重复操作及 Composer、项目打开、任务操作的交互。
- `.superwork/spec/frontend/state-management.md` — 约束 Mutation 状态、幂等键复用和瞬时 UI 状态边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 要求使用 Vitest 与 Playwright 覆盖用户可观察行为。
- `docs/web-design.md` — 定义工作台按钮、Composer、审批和项目打开的完整交互。

**Architecture:** 在 Web 共享层提供同步抢占、Promise 完成后释放的单飞锁；各异步用户入口在读取旧 React Query/React 状态前先抢占锁，现有 `isPending`、`isSubmitting` 与错误状态继续负责视觉反馈。按操作域隔离锁，避免无关命令互相阻塞，不引入固定时间窗口。

**Tech Stack:** TypeScript、React 19、TanStack Query、Vitest、Playwright、pnpm。

## Global Constraints

- 只保护触发网络请求、宿主应用或持久化副作用的点击，不影响展开、选择、导航等纯本地交互。
- 单飞锁必须在同一事件循环内同步生效，并在成功或失败后释放；不得使用固定毫秒 debounce。
- 同一次失败重试继续遵循现有 `Idempotency-Key` 规则，输入或目标变化后才能生成新 Key。
- 保留现有错误提示、焦点管理和可访问名称；锁定期间让现有按钮禁用态及时可见。
- 关键逻辑添加简短、明确的中文注释，不保留冗余旧判断路径。
- 不启动开发服务器。

### Task 1: 建立异步点击单飞锁

**Files:**

- Create: `apps/web/src/shared/utils/async-action-lock.ts`
- Test: `apps/web/src/shared/utils/async-action-lock.test.ts`

**Interfaces:**

- Consumes: 返回 Promise 的异步用户操作。
- Produces: `createAsyncActionLock()` 与同步拒绝重复进入、完成后释放的 `run()` 契约。

**Behavior:**

- 首次调用立即执行并持有锁；Promise 未结束前的连续调用不再次执行；成功、失败后均允许下一次调用。

**Stop Conditions:**

- 若锁无法在不引入新依赖的前提下保持类型安全和同步抢占，则停止并重新确认接口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/utils/async-action-lock.test.ts`

Expected: 单飞、成功释放和失败释放测试全部通过。

### Task 2: 保护项目与宿主打开操作

**Files:**

- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/hooks/use-background-terminals.ts`
- Test: `apps/web/src/features/workbench/components/project-open-menu.test.tsx`
- Test: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`
- Test: `apps/web/src/features/workbench/hooks/use-background-terminals.test.ts`
- Test: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `addProject`、Project/Task Mutation、`openProject`、`terminateBackgroundTerminal` 及其现有 pending 状态。
- Produces: 添加目录、Zed/目标路径打开、固定/重命名/归档/删除与停止终端的单飞点击行为。

**Behavior:**

- 对相同操作快速连击时只发出一次请求；不同目标按现有操作域执行；请求完成或失败后允许用户重试。

**Stop Conditions:**

- 若某个入口没有可观察的 Promise 生命周期，或锁会阻断无关 Project/Task 操作，则停止该入口并缩小锁作用域。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-open-menu.test.tsx apps/web/src/features/workbench/components/project-sidebar.test.tsx apps/web/src/features/workbench/hooks/use-background-terminals.test.ts`

Expected: 项目、打开方式与终端相关目标测试通过，快速重复操作只调用一次异步接口。

### Task 3: 保护 Composer 与其他命令操作

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/pending-request.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-dialog.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Test: `apps/web/src/features/workbench/components/commit-changes-dialog.test.tsx`
- Test: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Test: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: Prompt start/steer/interrupt、Command、Review、Feedback、Pending Request resolve、fork/rollback、Git generate/commit 与 settings save 回调。
- Produces: 发送、停止、审批、回答、复制任务、撤销、生成提交信息、提交/推送和保存设置的单飞行为。

**Behavior:**

- 所有网络命令在首个 Promise 未结束前忽略连续点击，保留现有草稿、错误反馈、幂等键与成功后的状态流转。

**Stop Conditions:**

- 若保护逻辑改变队列消息的 FIFO 自动发送、审批队首规则或 Turn 终态语义，则停止并恢复到对应行为边界重新实现。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-composer.test.tsx apps/web/src/features/workbench/components/commit-changes-dialog.test.tsx apps/web/src/features/workbench/components/task-timeline.test.tsx`

Expected: Composer、审批、Timeline、提交和设置相关目标测试通过，失败重试仍可执行。

### Task 4: 执行完整质量门禁

**Files:**

- Modify: `.superwork/plans/2026-08-02-click-action-single-flight.md`
- Test: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: 前三项完成后的 Web 构建、单元测试与浏览器行为。
- Produces: `pnpm check` 与 `pnpm test:e2e` 的最终验证证据。

**Behavior:**

- 确认类型、格式、依赖边界、单元测试、生产构建及快速连击浏览器流程全部通过。

**Stop Conditions:**

- 若失败来自本次改动则修复后重跑；若失败明确来自独立环境或既有问题，则记录完整证据并停止。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 两个完整质量门禁均以退出码 0 完成。
