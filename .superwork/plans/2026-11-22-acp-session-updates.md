# ACP 会话更新实施计划

**Goal:** Web、移动浏览器和桌面展示 ACP 会话通知、上下文压缩进度及摘要。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` 与 `.superwork/spec/protocol/shared/index.md` 约束跨层事件契约。
- `.superwork/spec/frontend-core/shared/index.md` 与 `.superwork/spec/ui/shared/index.md` 约束双端消费和呈现。

**Architecture:** ACP v1 握手声明能力，共用宿主按会话路由通知并按实体 ID 更新压缩条目。两端通过现有任务事件通道消费。

**Tech Stack:** TypeScript、ACP SDK、React、Vitest。

## Global Constraints

- 共用协议、运行时和界面逻辑，同时检查 Web、移动浏览器和桌面端。
- 保持流式更新的字节预算，摘要增量只更新目标条目。

### Task 1: 接入会话更新

**Files:**

- Modify: `packages/provider-acp/src/connection.ts`
- Modify: `packages/provider-acp/src/provider-session-events.ts`
- Modify: `packages/provider-acp/src/event-projection.ts`
- Modify: `packages/provider-acp/src/replay.ts`
- Modify: `packages/provider-acp/src/replay-anchor.ts`
- Modify: `packages/protocol/src/event-common.ts`
- Modify: `packages/protocol/src/agent-task.ts`
- Modify: `packages/protocol/src/agent-event.ts`
- Modify: `packages/protocol/src/acp.ts`
- Modify: `packages/server/src/agent-event-stream.ts`
- Test: `packages/provider-acp/src/event-projection.test.ts`
- Test: `packages/provider-acp/src/connection-v1.test.ts`
- Test: `packages/provider-acp/src/replay.test.ts`

**Interfaces:**

- Consumes: ACP v1 `session/update`。
- Produces: 会话级 `task.notice` 及可恢复的压缩条目。

**Behavior:**

- 通知随所属会话即时发布。压缩条目按首次出现顺序归位，状态和摘要更新使用相同 ID。

**Stop Conditions:**

- 会话身份或回放边界缺失时，先确认路由和历史模型。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-acp/src/event-projection.test.ts packages/provider-acp/src/connection-v1.test.ts packages/provider-acp/src/replay.test.ts`

Expected: 握手、压缩投影和回放通过。

### Task 2: 展示在双端会话中

**Files:**

- Modify: `desktop/src/protocol/agent-task.ts`
- Modify: `desktop/src/protocol/agent-event.ts`
- Modify: `packages/frontend-core/src/task-event-model.ts`
- Modify: `packages/frontend-core/src/project-event-history.ts`
- Modify: `packages/frontend-core/src/turn-process.ts`
- Modify: `packages/frontend-core/src/task-event-reducer.ts`
- Create: `packages/ui/src/agent/acp-session-updates.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-items.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-items.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-notices.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-notices.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-process.ts`
- Modify: `desktop/src/features/workbench/components/task-timeline-process.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-core.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-events.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-factory.ts`
- Modify: `desktop/src/features/conversation/runtime/task-item-store.ts`
- Modify: `desktop/src/features/conversation/runtime/task-store-events.ts`
- Modify: `desktop/src/features/conversation/runtime/task-store-factory.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `desktop/src/i18n/locales/en/conversation.ts`
- Modify: `desktop/src/i18n/locales/zh-CN/conversation.ts`
- Test: `apps/web/src/features/workbench/components/task-timeline-context-compaction.test.tsx`
- Test: `desktop/src/features/workbench/components/task-timeline-context-compaction.browser.test.tsx`

**Interfaces:**

- Consumes: 会话通知及压缩条目。
- Produces: 共享通知行和可展开的压缩摘要。

**Behavior:**

- 让会话用户看到即时通知以及压缩进度和保留摘要。

**Stop Conditions:**

- 两端协议或时间线消费不兼容时，先修复共享契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline-context-compaction.test.tsx`

Expected: 运行状态及保留摘要显示正确。

## 验证记录

- ACP 回放、握手、压缩投影、事件流及 Web 时间线的 50 项定向用例通过。实现前已验证缺少压缩投影与时间线行会触发对应断言。
- `pnpm test` 通过 4,219 项，`pnpm --dir desktop test:run` 通过 841 项。ACP 编译宿主通过 12 项。
- 桌面时间线通过 Chromium 与 WebKit 的 8 项用例。Web Chromium 工作台活动流程通过 2 项。
- 双端类型检查、静态检查与生产构建通过。根依赖边界、Web 包体与发布包校验、桌面源码行数与包体预算通过。
- `pnpm test:performance` 单独复跑通过 15 项。并行构建期间的首次运行触及 WebSocket 时间预算。
- 变更文件及仓库已跟踪文件格式通过，文档本地链接有效。全目录 Prettier 会扫描本地忽略的 Superwork JSON，已保留其他任务的历史记录。
- 共享契约已记录在 `.superwork/spec/frontend-core/shared/index.md`。本轮使用 ACP SDK 对端和应用测试夹具验证，无真实账号模型调用。
