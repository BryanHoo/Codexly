# ACP 子会话与审批归属实施计划

**Goal:** 在 Web、移动浏览器和桌面端展示 ACP 子会话并保留审批归属。

**Suggested Spec Reads:**

- `.superwork/spec/protocol/shared/index.md` 中的公开契约和 ACP 原生用户交互
- `packages/provider-acp/README.md` 中的 ACP v1 连接与重放边界

**Architecture:** 复用 ACP v1 增量事件和历史投影，按子会话限定条目、审批与问卷的身份。两端在原聊天内提供共享的子会话入口。

**Tech Stack:** TypeScript、ACP SDK、React、Vitest

## Global Constraints

- Web 与桌面共用协议、ACP 宿主与界面组件。
- 流式更新仅修改目标条目，历史响应保持现有分页和字节边界。
- ACP 原始许可选项和应用任务归属同时保留。

### Task 1: 接入子会话路由和交互归属

**Files:**

- Modify: `packages/provider-acp/src/connection.ts`, `packages/provider-acp/src/provider.ts`, `packages/provider-acp/src/provider-connection.ts`, `packages/provider-acp/src/provider-session-events.ts`, `packages/provider-acp/src/event-projection.ts`, `packages/provider-acp/src/replay.ts`, `packages/provider-acp/src/replay-anchor.ts`, `packages/provider-acp/src/task-snapshot.ts`, `packages/provider-acp/src/turn-content.ts`, `packages/provider-acp/src/permissions.ts`, `packages/provider-acp/src/elicitation.ts`, `packages/protocol/src/acp.ts`, `packages/protocol/src/agent-task.ts`, `packages/protocol/src/agent-event.ts`, `packages/protocol/src/pending-request.ts`, `desktop/src/protocol/agent-event.ts`, `desktop/src/protocol/agent-task.ts`, `desktop/src/protocol/pending-request.ts`
- Create: `packages/provider-acp/src/subagent-sessions.ts`, `packages/provider-acp/src/subagent-background.ts`, `packages/protocol/src/acp-subagent.ts`
- Test: `packages/provider-acp/src/provider-subagents.test.ts`, `desktop/src/protocol/acp-session.test.ts`

**Interfaces:**

- Consumes: ACP v1 session update、permission 和 elicitation。
- Produces: 子会话条目、会话范围内的工具身份和来源字段。

**Behavior:**

- 登记后独立投影子会话，交错的同名工具和审批分别归属正确的子会话，历史回放保留子会话关联。父回合结束后继续接收子会话输出与审批。

**Stop Conditions:**

- 至少验证同名工具并发、未登记请求取消与原始选项回传。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-acp/src/provider-subagents.test.ts`

Expected: 子会话更新和审批完整通过 ACP 对端连接测试。

### Task 2: 展示子会话及审批来源

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline-store.tsx`, `desktop/src/features/workbench/components/task-timeline-store.tsx`, `packages/ui/src/core/acp-permission-request.tsx`, `packages/frontend-core/src/task-event-reducer.ts`, `packages/frontend-core/src/timeline-turn-groups.ts`, `packages/provider-acp/README.md`, `CHANGELOG.md`, `.superwork/spec/protocol/shared/index.md`
- Create: `packages/ui/src/agent/acp-subagent-transcript.tsx`
- Test: `apps/web/src/features/workbench/components/task-timeline-acp-subagent.test.tsx`, `apps/web/src/features/workbench/components/pending-request-acp.test.tsx`, `desktop/tests/browser/acp-subagent-transcript.browser.test.tsx`

**Interfaces:**

- Consumes: 共享协议条目、待办请求和平台条目 Store。
- Produces: 两端统一的子会话详情与审批来源。

**Behavior:**

- 按会话展开记录，子会话内容不参与根答复及主执行过程推断。审批卡显示来源。

**Stop Conditions:**

- 验证同名子会话仍保持各自的条目索引及展开状态。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline-acp-subagent.test.tsx`

Expected: 根会话和子会话内容按身份显示。

## 验证记录

- ACP 对端回归复现了早期实现取消未知子会话审批的问题。修复后验证并发同名工具、未知会话、嵌套回放、委派正文替换以及父回合结束后的审批和流式输出。
- `pnpm exec vitest run packages/provider-acp/src packages/protocol/src packages/frontend-core/src apps/web/src/features/workbench/components/task-timeline-acp-subagent.test.tsx apps/web/src/features/workbench/components/pending-request-acp.test.tsx` 通过 917 项。
- 桌面单测通过 842 项。定向 Chromium 和 WebKit 双端浏览器回归通过 12 项。
- ACP 宿主通过 12 项。两款官方适配器的本地握手测试通过 2 项。
- Web 和桌面构建、性能预算、发布包、依赖边界、类型检查与 Codex Schema 基线均通过。
- 根目录全量测试最终通过 4223 项。版本管理范围格式检查和 Git 差异检查通过。
