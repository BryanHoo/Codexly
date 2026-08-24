# Feature Implementation Plan

**Goal:** 移除 Chain of Thought 展示，将 Codex 面向用户的 Commentary 按普通 AI 消息实时流式展示，同时不暴露原生 Reasoning 内容。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Task Timeline 消息、工具和流式状态展示。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex Item 与统一 Agent Event 的映射。
- `docs/web-design.md` — 定义 Web Timeline 的 AI Elements 使用边界。

**Architecture:** Provider 将 `agentMessage.phase=commentary` 与 `final_answer` 统一映射为 Assistant Message，并使用 `message.delta` 实时交付；原生 Reasoning 继续保留在协议快照中供运行时一致性使用，但 Web Timeline 不再渲染其内容。Command、Tool 和其他结构化 Item 保持现有独立展示。

**Tech Stack:** TypeScript、React 19、Codex App Server JSON-RPC、Streamdown、Vitest。

## Global Constraints

- 不向用户展示模型原生 Reasoning 或 Chain of Thought。
- Commentary 与 Final Answer 必须复用现有 `MessageResponse` 流式 Markdown 路径，不新增并行消息协议。
- 保持 `reasoning.delta` 协议能力，供其他 Provider 或运行时状态兼容使用，但 Codex Commentary 不再产生该事件。
- 删除未使用的 Chain of Thought 组件和分组逻辑，不保留旧展示分支。
- 在关键 Provider 映射位置保留简短清晰的中文注释。

### Task 1: Map Codex commentary to normal assistant streaming

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`

**Behavior Slice:** 将 Commentary 的 Delta、完成 Item 和 Turn Snapshot 都映射为普通 Assistant Message，同时保持 Final Answer 行为不变。

**Verification:**

Run: `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts`

Expected: Commentary 通过 `message.delta` 流式交付，完成态为 `type: "message"`。

### Task 2: Remove Chain of Thought UI and update durable guidance

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`
- Delete: `apps/web/src/shared/ai-elements/chain-of-thought.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `docs/web-design.md`

**Behavior Slice:** Timeline 忽略 Reasoning Item，不渲染思考标题、折叠块或内容；普通消息继续通过 `MessageResponse` 增量展示，Command 与 Tool 保持可见。

**Verification:**

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx apps/web/src/shared/ai-elements/ai-elements.test.tsx`

Run: `pnpm check`

Expected: 聚焦测试与完整质量门禁均通过，源码与文档不再引用应用 Chain of Thought 组件。
