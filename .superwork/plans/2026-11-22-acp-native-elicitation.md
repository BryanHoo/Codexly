# ACP v1 原生交互实施计划

**Goal:** 在 Web 和桌面接通 ACP v1 会话问卷与外部 URL 交互。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 跨包、共享与验证约束。
- `.superwork/spec/protocol/shared/index.md` — 公开请求和事件契约。

**Architecture:** 通过原生 ACP SDK 注册请求与通知，复用待办请求的快照、增量事件和幂等回传。应用只注入各平台的浏览器打开方式。

**Tech Stack:** TypeScript、React、ACP SDK、Tauri、Vitest。

## Global Constraints

- 保留已有项目、任务和会话绑定，实时交互复用已有增量通道。
- 仅在明确同意后打开 URL，展示完整地址与目标域名，凭据输入留在外部浏览器。
- 关键执行路径使用中文注释。

### Task 1: 连接和任务回传

**Files:**

- Modify: `packages/provider-acp/src/connection.ts`
- Modify: `packages/provider-acp/src/provider-connection.ts`
- Modify: `packages/provider-acp/src/provider-session-events.ts`
- Modify: `packages/provider-acp/src/provider.ts`
- Create: `packages/provider-acp/src/elicitation.ts`
- Modify: `packages/core/src/mcp-elicitation.ts`
- Modify: `packages/protocol/src/pending-request.ts`
- Modify: `packages/protocol/src/mcp-elicitation.ts`
- Modify: `packages/protocol/src/acp.ts`
- Test: `packages/provider-acp/src/provider.test.ts`

**Interfaces:**

- Consumes: ACP v1 `elicitation/create` 和 `elicitation/complete`。
- Produces: 现有待办请求中的 ACP 交互及完成状态。

**Behavior:**

- 校验请求作用域与表单答案，区分接受、拒绝、取消和外部完成。

**Stop Conditions:**

- 会话归属无法验证时结束交互。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-acp/src/provider.test.ts`

Expected: ACP Agent 能通过应用待办机制收到原生响应。

### Task 2: 双端交互及桌面回传

**Files:**

- Create: `packages/ui/src/core/elicitation-request.tsx`
- Modify: `packages/ui/src/core/mcp-questionnaire-field.tsx`
- Modify: `apps/web/src/features/workbench/components/mcp-elicitation-request.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-pending-requests.tsx`
- Modify: `apps/web/src/features/workbench/components/pending-request-dock.tsx`
- Modify: `apps/web/src/features/workbench/components/pending-request.tsx`
- Modify: `desktop/src/features/workbench/components/mcp-elicitation-request.tsx`
- Modify: `desktop/src/features/workbench/components/pending-request-dock.tsx`
- Modify: `desktop/src/features/workbench/components/pending-request.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `desktop/src/protocol/mcp-elicitation.ts`
- Modify: `desktop/src/protocol/pending-request.ts`
- Modify: `desktop/src/platform/tauri/sidebar-client.ts`
- Modify: `desktop/src/platform/tauri/acp-permission-client.test.ts`
- Modify: `desktop/src-tauri/src/application/pending_resolution.rs`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `desktop/src/i18n/locales/en/workbench.ts`
- Modify: `desktop/src/i18n/locales/zh-CN/workbench.ts`
- Test: `apps/web/src/features/workbench/components/pending-request.test.tsx`
- Test: `desktop/src/features/workbench/components/mcp-elicitation-request.browser.test.tsx`

**Interfaces:**

- Consumes: 待办请求、问卷字段与现有解析命令。
- Produces: 双端 URL 同意页面和共享问卷交互。

**Behavior:**

- 展示请求来源、目标域名和完整 URL，回传原生交互结果。

**Stop Conditions:**

- 外部浏览器无法打开目标时保留可重试的请求。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/pending-request.test.tsx`

Expected: Web 交互回归通过，桌面用例在浏览器验证阶段补充执行。

会话外的独立认证与配置交互仍使用既有流程。

## 验证记录

- ACP Provider 回归覆盖原生问卷的快照和答复校验，以及 URL 的无内容回应、会话归属、非法地址和回合结束后的去重完成通知。
- 根目录单元测试 4215 项通过、20 项跳过，桌面单元测试 841 项通过。桌面交互浏览器回归 10 项通过，Web 工作台 Chromium 端到端回归 2 项通过。
- 两端类型、静态检查、构建、架构检查及产物预算通过。Web 首屏和工作台 gzip 为 356.02 KiB 和 499.72 KiB。桌面首屏为 469417 字节。
- ACP 编译宿主测试 12 项通过，桌面原生待办解析 9 项通过。已有性能回归 15 项通过。
- 全仓 Prettier 会扫描本地协作记录。改动文件的格式和差异检查单独核对。
