# Feature Implementation Plan

**Goal:** 补齐 Codex App Server 0.146.0 与聊天主链路相关的流式事件、状态展示和显式事件覆盖分类。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、验证和注释规则。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex Notification 映射、诊断和 Snapshot 生命周期。
- `.superwork/spec/frontend/state-management.md` — 约束 Snapshot、实时事件和高频 Delta Store。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Timeline 组件职责和渲染边界。
- `.superwork/spec/shared/quality-guidelines.md` — 约束严格 Schema 与事件契约测试。

**Architecture:** 在 `packages/protocol` 增加 Provider 无关的流式 Delta、Item 更新和运行状态事件；在 `provider-codex` 完成官方 Notification 的严格映射与显式忽略分类；Server 延续按 Item Key 合并高频 Delta；Web 只订阅目标 Item Store 并展示计划、Reasoning Summary、MCP 进度、实时文件变化、Hook 和模型状态。最终 Item 继续覆盖中间 Delta，原始 Reasoning Content 不展示。

**Tech Stack:** TypeScript、TypeBox、Zustand、React 19、Vitest、pnpm。

## Global Constraints

- 保持 Agent Event `version: 2`，新增事件必须使用严格可判别 Schema 并同步全部消费者。
- 不向 Web 透传 Codex 原始对象、宿主绝对路径、Reasoning 原始 Content 或未受限错误详情。
- 高频 Delta 必须按 `taskId + turnId + itemId + field` 保序合并，最终 Item 是权威状态。
- 不实现与当前聊天主链路无关的 Realtime Audio、Fuzzy Search、Remote Control 或 Windows Sandbox UI。
- 所有 Python 命令使用 `python3`，项目命令使用 `pnpm`，不启动开发服务器。

### Task 1: 扩展统一事件与 Item 契约

**Files:**

- Modify: `packages/protocol/src/agent-event.ts`
- Modify: `packages/protocol/src/agent-task.ts`
- Modify: `packages/protocol/src/agent-attachments.ts`
- Test: `packages/protocol/src/agent-event.test.ts`

**Interfaces:**

- Consumes: `AgentEventSchema`、`AgentItemSchema`、Codex 0.146.0 Notification 字段。
- Produces: 计划 Delta、MCP Progress、File Change Update、Reasoning Summary Section、Task Notice 与结构化运行状态契约。

**Behavior:**

- 新事件通过严格 Schema 校验，并为 Web 提供足够但不泄漏 Provider 原始结构的数据。

**Stop Conditions:**

- 如果新增事件无法保持 Provider 无关或必须泄漏绝对路径，则停止并缩减字段。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/agent-event.test.ts`

Expected: 新增事件的合法样例通过，额外字段和非法状态被拒绝。

### Task 2: 映射 Codex 流式事件并建立覆盖分类

**Files:**

- Modify: `packages/provider-codex/src/codex-mapping-common.ts`
- Modify: `packages/provider-codex/src/codex-event-mapping.ts`
- Modify: `packages/provider-codex/src/codex-item-mapping.ts`
- Modify: `packages/provider-codex/src/codex-tool-mapping.ts`
- Modify: `packages/provider-codex/src/agent-provider-runtime.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`
- Test: `packages/provider-codex/src/codex-protocol-mapping.test.ts`
- Create: `packages/provider-codex/src/codex-notification-coverage.test.ts`
- Test: `tests/codex-schema-drift.test.ts`

**Interfaces:**

- Consumes: Codex `ServerNotification`、`ThreadItem` 与 Task 1 的统一事件。
- Produces: 严格映射的 Provider Event、显式消费/忽略 Notification 分类和结构化错误信息。

**Behavior:**

- 映射 plan、MCP、diff/patch、Reasoning Section、Hook、模型状态和线程 Warning；所有官方 Notification 必须归类为映射、专门消费或明确忽略。

**Stop Conditions:**

- 如果锁定 Schema 与生成结果漂移，则停止并先处理 Codex 版本升级。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts packages/provider-codex/src/codex-protocol-mapping.test.ts tests/codex-schema-drift.test.ts`

Expected: 每类 Notification 生成预期统一事件，覆盖矩阵没有未分类方法。

### Task 3: 扩展实时聚合与 Task Store

**Files:**

- Modify: `packages/server/src/agent-event-stream.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-core.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-events.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-snapshot.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-factory.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-registry.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-runtime.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.ts`
- Modify: `apps/web/src/features/notifications/browser-task-notifier.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Test: `packages/server/src/agent-event-stream.test.ts`
- Test: `apps/web/src/features/conversation/runtime/task-store.test.ts`

**Interfaces:**

- Consumes: Task 1 的新增 Agent Event。
- Produces: 保序合并的高频 Delta、按 Item 替换的进度/文件更新和有界 Task Notice 状态。

**Behavior:**

- Delta 只更新目标 Item Store；最终 Item 覆盖临时内容；Notice 有界保留；Snapshot 重建不持久化瞬时提示。

**Stop Conditions:**

- 如果实现导致每个 Delta 重建 Turn 或整条 Timeline，则停止并调整为细粒度 Item Store 更新。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/agent-event-stream.test.ts apps/web/src/features/conversation/runtime/task-store.test.ts`

Expected: Delta 保序合并、Item 更新和 Notice 容量测试通过。

### Task 4: 展示流式计划、摘要和运行状态

**Files:**

- Create: `apps/web/src/shared/components/agent/reasoning.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-items.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Test: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Test: `apps/web/src/features/projects/project-queries.test.tsx`

**Interfaces:**

- Consumes: Task 3 的细粒度 Store 与 Provider 无关 Item。
- Produces: 适配项目设计令牌的 AI Elements 风格 Reasoning 组件，以及可访问的 Plan、Reasoning Summary、MCP Progress、实时文件变更、Hook、模型状态和 Warning 展示。

**Behavior:**

- 运行中逐步展示可读进度，完成后折叠过程；Reasoning 只展示 Summary；原始 Content 永不进入 DOM。

**Stop Conditions:**

- 如果状态文案需要暴露 Provider 名称、原始路径或内部 Reasoning，则停止并改用通用文案。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx`

Expected: 流式状态可见、完成态正确替换，原始 Reasoning Content 不出现在 HTML。

### Task 5: 固化规范并完成全量验证

**Files:**

- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/plans/2026-08-08-codex-streaming-event-coverage.md`

**Interfaces:**

- Consumes: 完成后的事件生命周期和验证结果。
- Produces: 稳定工程约束、完成状态和最终验证证据。

**Behavior:**

- 文档明确最终 Item 权威性、Summary 展示边界、事件覆盖分类和高频合并规则，并通过项目完整门禁。

**Stop Conditions:**

- 如果 `pnpm check` 或 `pnpm test:e2e` 失败，保持任务未完成并修复本次变更引起的问题。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 完整门禁与浏览器流程通过，工作树只包含本计划相关改动。
