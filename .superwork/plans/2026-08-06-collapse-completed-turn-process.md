# Feature Implementation Plan

**Goal:** AI Turn 完成后默认仅展示最终回复，并允许用户点击耗时栏展开或收起该 Turn 的中间执行过程。

**Suggested Spec Reads:**

- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex `commentary` 与 `final_answer` 的 Provider 映射。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Timeline 组件职责与交互边界。
- `.superwork/spec/frontend/state-management.md` — 约束 Snapshot 与实时 Item 的统一渲染。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束可访问性与前端测试。
- `.superwork/spec/frontend/type-safety.md` — 约束 Protocol 类型在前端边界的使用。
- `.superwork/spec/shared/quality-guidelines.md` — 约束共享 Schema 与调用方验证。
- `docs/web-design.md` — 约束工作台 Timeline 和 AI Elements 的视觉策略。

**Architecture:** 在 Provider 边界保留 Codex `agentMessage.phase` 并通过 Protocol 传递；Web 按完成 Turn 内的 `final_answer` 划分最终回复与中间过程，运行中保持全部过程可见，完成后由耗时按钮控制中间过程显隐。

**Tech Stack:** TypeScript、TypeBox、React、Tailwind CSS、Vitest、Testing Library。

## Global Constraints

- 保持 `reasoning` 内容始终不可见，不把原生思维链暴露到 Web。
- 运行中 Turn 必须继续实时展示 `commentary`、命令、工具和活动状态。
- 只有明确标记为 `commentary` 的 Assistant Message 进入可折叠过程；无阶段的旧历史消息按最终可见内容处理。
- 完成态默认收起中间过程，点击耗时栏目展开，再次点击收起，并提供 `aria-expanded` 与本地化名称。
- 不启动开发服务器。

### Task 1: 贯穿 Agent Message 阶段契约

**Files:**

- Modify: `packages/protocol/src/agent-attachments.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/provider-codex/src/codex-item-mapping.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/src/codex-protocol-mapping.test.ts`

**Interfaces:**

- Consumes: Codex `agentMessage.phase` (`commentary | final_answer | null`)
- Produces: `AgentMessagePhase` 与 `AgentMessageItemSchema.phase`

**Behavior:**

- 保留 Assistant Message 的有效原生阶段，User Message 不携带阶段；缺失或 `null` 阶段继续映射为无 `phase` 字段，非法值继续报协议映射错误。

**Stop Conditions:**

- 若官方 App Server 契约不再包含 `commentary` 与 `final_answer`，停止并重新核对映射。
- 若新增字段会造成无法迁移的持久化 Schema 不兼容，停止并确认数据迁移边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/provider-codex/src/codex-protocol-mapping.test.ts`

Expected: 新增阶段 Schema 与 Provider 映射测试通过。

### Task 2: 完成态折叠中间执行过程

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-status.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`

**Interfaces:**

- Consumes: `AgentMessageItemSchema.phase`、`AgentTurn.status`、`TurnProcessingTime`
- Produces: 完成态 Turn 的折叠过程区域与可访问耗时触发器

**Behavior:**

- 运行中显示完整过程；完成后默认隐藏 `commentary` 和最终回复之前的工具/活动，只保留 `final_answer`、文件变更摘要和消息操作，点击耗时栏可展开或收起过程。

**Stop Conditions:**

- 若 Item 顺序无法可靠确定最终回复边界，停止并修正分组契约后再继续。
- 若交互导致最终回复、错误状态或文件变更摘要不可见，停止并修正渲染边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx`

Expected: 运行态、完成态默认折叠、点击展开与再次收起的测试全部通过。
