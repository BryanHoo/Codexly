# Feature Implementation Plan

**Goal:** 在批准模式中提供 Codex 自动审批选项，并在任务设置、持久化和 Turn RPC 中完整传递审批审核方。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 定义全仓验证与工程约束。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Composer 设置控件、事件驱动更新和可访问性。
- `.superwork/spec/shared/quality-guidelines.md` — 约束严格协议、完整任务设置和消费者同步更新。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Provider RPC 映射、SQLite 持久化和测试范围。
- `docs/architecture-design.md` — 定义统一设置到 Codex App Server 的映射边界。
- `docs/web-design.md` — 定义批准模式在 Composer 中的用户交互。

**Architecture:** 在统一 Protocol 中新增 `AgentApprovalsReviewer`，并将 `approvalsReviewer` 纳入完整 `AgentTaskSettings`/`AgentTurnOptions`。Server 使用 SQLite migration 为已有任务补齐 `user`，Provider 将该字段映射到 Codex `turn/start.approvalsReviewer`。Web 保持一个批准模式 Select，通过组合值把“自动审批”映射为 `on-request + auto_review`，其他模式映射为对应策略与 `user`。

**Tech Stack:** TypeScript、React、Fastify、SQLite、Vitest、Playwright、pnpm。

## Global Constraints

- 保持 `protocol <- core <- provider-codex <- server` 与 `protocol/client <- web` 依赖方向。
- 新任务默认使用 `approvalPolicy: "on-request"` 与 `approvalsReviewer: "user"`。
- `auto_review` 只与 `on-request` 组合暴露，不能把 `never` 误当成自动审批。
- 设置更新继续提交严格完整对象，不增加旧协议兼容分支。
- 不启动开发服务器。

### Task 1: 扩展审批审核方契约与持久化

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/server/src/sqlite-state-repository.ts`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/sqlite-state-repository.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: existing `AgentTaskSettingsSchema`, `AgentTurnOptionsSchema`, `AgentSettingsRepository`
- Produces: `AgentApprovalsReviewerSchema`, `AgentApprovalsReviewer`, complete settings with `approvalsReviewer`, and SQLite migration version 5

**Behavior Slice:** 新旧数据库均读取出合法的 `user | auto_review` 审批审核方；新任务默认 `user`；HTTP 设置与 Turn 请求严格接收、返回并持久化完整字段，缺失或未知值失败。

**Proof Intent:** 先让 Protocol、Repository 和 Server 测试因缺少字段或迁移失败，再实现最小契约与存储变更使测试通过。

**Verification:** Run `pnpm exec vitest run packages/protocol/src/project.test.ts packages/server/src/sqlite-state-repository.test.ts packages/server/src/app.test.ts packages/client/src/http-client.test.ts`; expect all selected tests to pass.

Expected: selected Protocol, Repository, Server, and Client tests exit 0.

**Stop Conditions:**

Codex 的生成类型不包含 `approvalsReviewer`；SQLite 不能通过追加非破坏 migration 为现有记录补齐 `user`；严格完整设置需要无法安全迁移的 API 版本升级。

### Task 2: 映射 Codex RPC 并添加批准模式选项

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-activity.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-runtime.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store.test.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/features/workbench/components/subagent.test.ts`
- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `AgentTurnOptions.approvalsReviewer` and Codex `TurnStartParams.approvalsReviewer`
- Produces: combined Select option `auto-review` mapping to `{ approvalPolicy: "on-request", approvalsReviewer: "auto_review" }`

**Behavior Slice:** 用户可在现有“批准模式”选择“自动审批”，刷新后仍恢复该选择，提交 Turn 时 Provider 收到并发送 `approvalsReviewer: "auto_review"`；切换到按需、仅不受信任或从不询问时恢复人工审核方。

**Proof Intent:** 通过 Provider RPC 精确调用断言、React 组件设置更新断言和 Playwright 请求正文断言覆盖用户可观察行为。

**Verification:** Run `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts apps/web/src/features/workbench/components/workbench-composer.test.tsx`; expect all selected tests to pass. Then run `pnpm test:e2e`; expect the auto-approval selection and existing browser flows to pass.

Expected: selected Provider and Web tests plus Playwright exit 0.

**Stop Conditions:**

当前 Codex 运行时拒绝 `turn/start.approvalsReviewer`；Web 的单 Select 无法无歧义恢复持久化组合；自动审批受运行时能力约束但项目没有可读取的能力来源。

### Task 3: 更新稳定规范并完成全量验证

- [x] **Task Status:** completed

**Files:**

- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `packages/protocol/src/agent-event.test.ts`

**Interfaces:**

- Consumes: implemented `approvalsReviewer` contract and UI mapping
- Produces: stable documentation distinguishing manual approval, automatic review, and never prompting

**Behavior Slice:** 持久规范准确描述默认值、持久化、UI 组合和 Codex RPC 映射，不再把审批策略三值描述为完整批准模式集合。

**Proof Intent:** 用文本搜索确认所有稳定设置说明包含审核方语义，并由全仓门禁验证类型、格式、测试与构建。

**Verification:** Run `pnpm check` and `pnpm test:e2e`; expect both commands to exit 0 with no failed checks.

Expected: repository quality gate and browser suite both exit 0.

**Stop Conditions:**

实现与官方 Codex 0.145.0 生成协议不一致；全量检查发现本变更之外的阻塞且无法在作用域内安全修复。
