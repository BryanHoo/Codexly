# Feature Implementation Plan

**Goal:** 将所有用户操作结果统一交给应用根级 toast 展示，并确保 Codex、Git 底层原始错误可到达前端，同时让内部循环诊断仅写日志。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、验证命令和日志安全边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex/Git 子进程错误传播、重试和内部循环日志。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Fastify 错误响应、Pino 日志和契约测试。
- `.superwork/spec/frontend/component-guidelines.md` — 约束根级 toast 宿主及组件内动作反馈边界。
- `.superwork/spec/frontend/state-management.md` — 区分用户 Mutation、查询状态与内部后台循环。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Protocol、Client、Server 和 Web 的错误契约同步。

**Architecture:** 在应用根节点建立唯一动作通知服务，由 TanStack MutationCache 和少量非 Mutation 控制器发布成功/失败 toast；组件只保留输入校验、数据加载和领域执行状态。服务端对 Codex/Git 已知边界保留原始错误文本，Protocol 为 Git 部分成功补充底层 push 错误，Client 原样构造 Error。内部轮询、清理和事件隔离错误仅写受控日志，不进入动作通知通道。

**Tech Stack:** TypeScript、React、TanStack Query、Sonner、Fastify、TypeBox、Vitest、Playwright、Pino。

## Global Constraints

- 所有用户主动触发的成功与失败结果必须使用根级 toast，功能组件不得渲染动作结果错误或成功文案。
- 查询加载失败、表单输入校验、Timeline 领域错误和待审批状态不是动作通知，继续在其所属视图表达。
- Codex 与 Git 底层调用的原始 `Error.message`/Git stderr 必须通过 Server、Protocol、Client 到达 toast，不得替换为通用错误。
- 内部轮询、事件隔离、best-effort 清理和后台重试不得触发 toast，只通过受控日志记录。
- 不新增旧逻辑兼容层；删除冗余组件错误状态与 Props。
- 生产代码文件不得超过 500 行，关键错误边界保留简短中文注释。
- 项目使用 `pnpm`，Python 命令只使用 `python3`；完成后不启动开发服务器。

### Task 1: 建立根级动作通知通道

**Files:**

- Create: `apps/web/src/features/notifications/action-notifications.ts`
- Create: `apps/web/src/features/notifications/action-notifications.test.ts`
- Modify: `apps/web/src/app/providers.tsx`
- Modify: `apps/web/src/app/providers.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/common.ts`
- Modify: `apps/web/src/i18n/locales/en/common.ts`

**Interfaces:**

- Consumes: TanStack Query `MutationCache` callbacks、Sonner `toast`、任意 `unknown` 错误。
- Produces: 唯一根级 `ActionNotificationService`、统一成功文案和保留 `Error.message` 的失败 toast。

**Behavior:**

- 所有 `useMutation` 用户动作默认在成功时发送一次成功 toast、失败时发送一次包含原始错误信息的错误 toast；通知宿主只在根 Provider 挂载，内部代码可显式标记静默 Mutation。

**Stop Conditions:**

- 如果 TanStack Query 当前版本无法从全局 MutationCache 区分显式静默操作，则停止并改为经过类型约束的统一 Mutation option helper，不在组件中直接导入 Sonner。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/notifications/action-notifications.test.ts apps/web/src/app/providers.test.tsx`

Expected: 动作成功、原始错误失败、静默 Mutation 和根级 Toaster 行为测试全部通过。

### Task 2: 移除组件内用户动作结果提示

**Files:**

- Modify: `apps/web/src/features/projects/project-provider.tsx`
- Modify: `apps/web/src/features/projects/project-context-state.tsx`
- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: `apps/web/src/features/projects/project-context.test.tsx`
- Modify: `apps/web/src/features/projects/components/project-directory-picker-dialog.tsx`
- Modify: `apps/web/src/features/projects/components/project-directory-picker-dialog.test.tsx`
- Modify: `apps/web/src/features/access/access-context.tsx`
- Modify: `apps/web/src/features/access/access-context.test.tsx`
- Modify: `apps/web/src/features/access/pairing-gate.tsx`
- Modify: `apps/web/src/features/access/pairing-gate.test.tsx`
- Modify: `apps/web/src/features/provider-connection/components/provider-connection-panel.tsx`
- Modify: `apps/web/src/features/provider-connection/components/provider-connection-panel.test.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-about.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-access.tsx`
- Modify: `apps/web/src/app/routes/index-route.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-launcher.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-dialog.test.tsx`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `apps/web/src/features/workbench/components/commit-changes-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-dialogs.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-task-list.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-task-list.test.tsx`
- Modify: `apps/web/src/features/workbench/components/project-rename-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/project-remove-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/task-rename-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/create-branch-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/composer-branch-switcher.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-commands.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-session.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-submission.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Modify: `apps/web/src/features/workbench/hooks/use-workbench-composer-controller.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-dialogs.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-sections.tsx`
- Modify: `apps/web/src/features/workbench/components/host-attachment-picker-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/pending-request.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-status.tsx`
- Modify: `apps/web/src/features/workbench/hooks/use-background-terminals.ts`
- Modify: `apps/web/src/features/workbench/hooks/use-workbench-branch-switch.ts`
- Test: `apps/web/src/features/workbench/components/commit-changes-dialog.test.tsx`
- Test: `apps/web/src/features/workbench/components/create-branch-dialog.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

**Interfaces:**

- Consumes: Task 1 的 `ActionNotificationService` 与全局 MutationCache。
- Produces: 不再接收或渲染动作结果 Error Props 的纯视图组件，以及由控制器发布的非 Mutation 动作 toast。

**Behavior:**

- Project、Task、设置、Provider 连接、分支、提交、系统打开、MCP 重载和终端停止等用户动作统一 toast；组件只保留本地输入校验、加载错误和领域状态，动作失败时保留表单/草稿以便重试。

**Stop Conditions:**

- 如果某个错误同时决定业务状态而不仅是通知，则保留该状态但删除重复文案，并补充测试证明 toast 与业务状态职责不同。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/project-context.test.tsx apps/web/src/features/provider-connection/components/provider-connection-panel.test.tsx apps/web/src/features/workbench/components/commit-changes-dialog.test.tsx apps/web/src/features/workbench/components/create-branch-dialog.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: 用户动作只通过通知服务反馈，相关组件不再渲染动作结果文案，失败后必要输入状态仍保留。

### Task 3: 透传 Codex 与 Git 底层原始错误

**Files:**

- Modify: `packages/protocol/src/project-git.ts`
- Create: `packages/protocol/src/project-git.test.ts`
- Modify: `packages/server/src/idempotency-runner.ts`
- Create: `packages/server/src/error-message.ts`
- Modify: `packages/server/src/server-runtime.ts`
- Modify: `packages/server/src/git-command.ts`
- Modify: `packages/server/src/git-branch.ts`
- Modify: `packages/server/src/git-commit.ts`
- Modify: `packages/server/src/git-history.ts`
- Modify: `packages/server/src/git-commit-review.ts`
- Modify: `packages/server/src/routes/project-git-routes.ts`
- Modify: `packages/server/src/server-delivery.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/server/src/git-command.test.ts`
- Modify: `packages/server/src/git-branch.test.ts`
- Modify: `packages/server/src/git-commit.test.ts`
- Modify: `packages/server/src/git-history.test.ts`
- Modify: `packages/server/src/git-commit-review.test.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `packages/client/src/http-client-transport.ts`
- Modify: `apps/web/src/features/workbench/components/commit-changes-controller.tsx`

**Interfaces:**

- Consumes: Codex Provider `Error.message`、simple-git/child_process 错误与 stderr、`AgentMutationError`。
- Produces: 保留原始文本的 `PROVIDER_ERROR`/Git 错误响应，以及携带可空 `pushError` 的 `CommitProjectChangesResponse`。

**Behavior:**

- Codex RPC、Git 状态/历史/审核/分支/提交/push 的底层失败文本原样进入 HTTP 错误或部分成功响应，Client 不改写，Web 错误 toast 展示同一文本；内部校验错误仍使用稳定业务文案。

**Stop Conditions:**

- 如果错误对象不含可用文本，则仅使用现有通用 fallback；不得猜测或拼接虚构的第三方输出。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project-git.test.ts packages/server/src/app.test.ts packages/server/src/git-command.test.ts packages/server/src/git-branch.test.ts packages/server/src/git-commit.test.ts packages/server/src/git-history.test.ts packages/server/src/git-commit-review.test.ts packages/client/src/http-client.test.ts`

Expected: Codex 原始 RPC 消息、Git stderr 和 push 部分失败消息在协议链路中保持一致，所有契约测试通过。

### Task 4: 限制内部循环诊断并完成规范校准

**Files:**

- Create: `apps/web/src/features/notifications/internal-diagnostics.ts`
- Create: `apps/web/src/features/notifications/internal-diagnostics.test.ts`
- Modify: `apps/web/src/features/notifications/browser-task-notifier.ts`
- Modify: `apps/web/src/features/projects/project-git-status-coordinator.ts`
- Modify: `apps/web/src/features/projects/project-git-status-coordinator.test.ts`
- Modify: `apps/web/src/features/projects/project-provider.tsx`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime-recovery.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime-events.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`
- Modify: `packages/provider-codex/src/agent-provider-notifications.ts`
- Create: `packages/provider-codex/src/agent-provider-diagnostics.ts`
- Modify: `packages/provider-codex/src/agent-provider-runtime.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 后台轮询、事件隔离、重连、best-effort 清理中的内部异常与 Provider logger。
- Produces: 不触发 toast 的受控终端/控制台诊断记录，以及明确的持久工程规范。

**Behavior:**

- 内部循环错误和警告只记录诊断码及安全上下文，不进入用户动作通知；通知测试明确证明查询重试、后台循环和 Provider 未知事件不会产生 toast。

**Stop Conditions:**

- 如果某条错误会直接导致用户发起的动作失败，则返回 Task 2/3 的动作错误链路处理，不得把动作失败误归为内部诊断。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/notifications/internal-diagnostics.test.ts apps/web/src/features/projects/project-git-status-coordinator.test.ts apps/web/src/features/conversation/runtime/project-runtime.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: 内部循环只产生日志证据且不触发 toast，相关规范与实现一致。
