# Feature Implementation Plan

**Goal:** 在双端使用 ACP v2 发送确认、恢复、后台工作和结构化差异。

**Suggested Spec Reads:**

- `.superwork/spec/core/shared/index.md` — 会话、历史和持久化。
- `.superwork/spec/protocol/shared/index.md` — 双端数据契约。
- `.superwork/spec/ui/shared/index.md` — 共用界面。

**Architecture:** 共享 Provider 处理官方消息，会话状态经现有事件通道交付，变更数据进入聊天历史。

**Tech Stack:** TypeScript、React、ACP SDK、Vitest、Tauri。

## Global Constraints

- 持久化完成后发布回合终态并允许队列续发。
- Web 和桌面共用运行时及视图，历史读取和实时更新使用有界增量处理。

### Task 1: 交付消息确认与回放边界

**Files:**

- Modify: `packages/provider-acp/src/connection.ts`
- Modify: `packages/provider-acp/src/provider.ts`
- Modify: `packages/provider-acp/src/provider-connection.ts`
- Create: `packages/provider-acp/src/provider-session-events.ts`
- Modify: `packages/provider-acp/src/history.ts`
- Modify: `packages/provider-acp/src/replay-anchor.ts`
- Modify: `packages/provider-acp/src/replay.ts`
- Modify: `packages/provider-acp/src/task-snapshot.ts`
- Modify: `packages/provider-acp/src/turn-persistence.ts`
- Modify: `packages/provider-acp/src/turn-submission.ts`
- Modify: `packages/server/src/task-submission-service.ts`
- Test: `packages/provider-acp/src/replay.test.ts`
- Modify: `packages/provider-acp/src/session-metadata.ts`
- Modify: `packages/protocol/src/acp-session.ts`
- Test: `packages/provider-acp/src/connection.test.ts`

**Interfaces:**

- Consumes: ACP v2 SDK 会话、工具和消息契约。
- Produces: 双端共享会话状态和聊天条目。

**Behavior:**

- 处理已插入回执和 replay_complete 边界，保护原始提交身份。

**Stop Conditions:**

- 官方消息无法可靠对应本地会话及实体时暂停相应操作。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-acp/src/connection.test.ts`

Expected: 切片回归通过。

### Task 2: 交付后台状态及单项停止

**Files:**

- Modify: `packages/provider-acp/src/connection.ts`
- Modify: `packages/provider-acp/src/provider.ts`
- Modify: `packages/provider-acp/src/session-metadata.ts`
- Modify: `packages/protocol/src/acp-session.ts`
- Modify: `packages/provider-acp/src/host-dispatch.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/server/src/routes/acp-routes.ts`
- Modify: `packages/client/src/http-client-acp.ts`
- Modify: `desktop/src-tauri/src/application/acp_task_commands.rs`
- Modify: `desktop/src/platform/tauri/acp-task-client.ts`
- Modify: `desktop/src/platform/tauri/acp-composer-client.ts`
- Modify: `packages/frontend-core/src/acp-session-state.ts`
- Create: `packages/ui/src/core/acp-activity.tsx`
- Modify: `packages/ui/src/core/use-acp-session.tsx`
- Modify: `packages/core/src/engine-router.ts`
- Test: `packages/client/src/http-client-acp.test.ts`
- Test: `desktop/src/platform/tauri/acp-task-client.test.ts`
- Create: `desktop/tests/browser/acp-activity.browser.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-acp-composer.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-acp-composer.tsx`
- Test: `packages/provider-acp/src/session-metadata.test.ts`

**Interfaces:**

- Consumes: ACP v2 SDK 会话、工具和消息契约。
- Produces: 双端共享会话状态和聊天条目。

**Behavior:**

- 从同一会话投影后台工作和控制能力，通过 HTTP 或桌面宿主发出停止请求。

**Stop Conditions:**

- 官方消息无法可靠对应本地会话及实体时暂停相应操作。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-acp/src/session-metadata.test.ts`

Expected: 切片回归通过。

### Task 3: 渲染结构化文件变更

**Files:**

- Modify: `packages/provider-acp/src/event-projection.ts`
- Modify: `packages/protocol/src/project-git.ts`
- Modify: `desktop/src/protocol/project-git.ts`
- Modify: `apps/web/src/features/workbench/components/task-timeline-file-changes.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-file-changes.tsx`
- Create: `packages/provider-acp/src/file-changes.ts`
- Create: `packages/protocol/src/acp-file-change.ts`
- Modify: `packages/protocol/src/acp.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `desktop/src/i18n/locales/en/conversation.ts`
- Modify: `desktop/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `desktop/src-tauri/src/application/acp_view.rs`
- Modify: `desktop/src-tauri/src/application/claude_host.rs`
- Test: `packages/provider-acp/src/event-projection.test.ts`

**Interfaces:**

- Consumes: ACP v2 SDK 会话、工具和消息契约。
- Produces: 双端共享会话状态和聊天条目。

**Behavior:**

- 保留官方文件操作、类型和可用补丁，复用聊天变更组件。

**Stop Conditions:**

- 官方消息无法可靠对应本地会话及实体时暂停相应操作。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-acp/src/event-projection.test.ts`

Expected: 切片回归通过。

## 验证结果

- 根目录单元和集成测试通过 4587 项。最后调整重放身份匹配后，重放、Provider 和任务快照再验通过 29 项。
- 桌面单元测试通过 841 项。Chromium 和 WebKit 的共享状态组件及双端输入框回归通过 10 项。
- 真实 Codex 与 Claude 适配器冒烟检查通过 2 项。原生任务命令和视图规范化通过 7 项，编译后的 ACP 宿主通过 12 项。
- Web 与桌面类型、静态检查和生产构建通过。Web 依赖边界、格式、发布包和构建预算通过，桌面构建预算通过。
- 更新共享 Core 规范，记录提交身份、回放、后台工作及文件变更契约。
