# 跨 Agent 接续任务开发计划

**Goal:** Web 与桌面在历史聊天换 Agent 时，经用户确认创建带历史附件的独立任务。

**Suggested Spec Reads:**

- `.superwork/spec/guides/cross-layer-thinking-guide.md`
- `.superwork/spec/guides/code-reuse-thinking-guide.md`
- `.superwork/spec/guides/cross-platform-thinking-guide.md`

**Architecture:** 两端复用 ACP 文本附件、历史记录以及确认流程，借用现有首发提交能力。

**Tech Stack:** TypeScript、React、ACP、Tauri、Rust、Vitest。

## Global Constraints

- 历史与原生会话按现有任务身份保持独立。
- 共享逻辑不得依赖 Web 或桌面交付层，历史只在确认发送后按需读取。
- 提交重试沿用同一个任务创建意图。

### Task 1: 整理可携带历史并持久化首轮附件

**Files:**

- Create: `packages/provider-acp/src/task-continuation.ts`
- Test: `packages/provider-acp/src/task-continuation.test.ts`
- Modify: `packages/provider-acp/src/provider.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/task-attachments.ts`
- Modify: `packages/protocol/src/agent-attachments.ts`
- Modify: `desktop/src/protocol/agent-attachments.ts`

**Interfaces:**

- Consumes: `AcpHistory`、`LocalTask` 和 `AgentProviderTurnInput`。
- Produces: 新 Agent 首轮文本附件。

**Behavior:**

- 有界地保留原始目标、近期对话和文件结果，来源跨项目、活动状态与旧目标会话需拒绝。

**Stop Conditions:**

- 历史校验及附件准备结果无法确认时，在发送前报错。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-acp/src/task-continuation.test.ts`

Expected: 历史整理与提交验证通过。

### Task 2: 打通 Web 与桌面首发

**Files:**

- Modify: `packages/protocol/src/task-submission.ts`
- Modify: `packages/server/src/task-submission-service.ts`
- Modify: `packages/provider-acp/src/host-dispatch.ts`
- Modify: `desktop/src-tauri/src/application/acp_task_commands.rs`
- Modify: `desktop/src/platform/tauri/acp-task-client.ts`
- Test: `desktop/src-tauri/src/application/acp_task_commands_tests.rs`
- Test: `packages/server/src/app-acp-submissions.test.ts`

**Interfaces:**

- Consumes: 现有新任务首发的幂等请求。
- Produces: 带来源任务身份的首发请求。

**Behavior:**

- 两条传输路径保留创建和发送的幂等行为，来源任务只读，项目目录需要匹配已授权的实际工作目录。

**Stop Conditions:**

- 来源任务作用域不一致或存在正在执行的回合时，拒绝交付历史。

- [x] **Task Status:** completed

Run: `pnpm typecheck`

Expected: 各协议和交付接口的类型一致。

### Task 3: 确认及聊天导航

**Files:**

- Create: `packages/ui/src/core/acp-task-continuation.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-acp-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-submission.ts`
- Modify: `desktop/src/features/workbench/components/workbench-acp-composer.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `desktop/src/features/workbench/components/workbench-composer-submission.ts`
- Modify: `packages/ui/src/core/acp-model-selector.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-items.tsx`
- Modify: `apps/web/src/features/workbench/components/message-file-attachment.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-items.tsx`
- Modify: `desktop/src/features/workbench/components/message-file-attachment.tsx`
- Test: `desktop/tests/browser/acp-workbench-composer.browser.test.tsx`
- Modify: `docs/agent-engines.md`

**Interfaces:**

- Consumes: 现有 Agent 模型选择、上传、发送和成功导航。
- Produces: 跨 Agent 发送确认和新任务首发。

**Behavior:**

- 取消保留草稿，确认后发送并打开新任务。正常同 Agent 发送继续使用原会话。

**Stop Conditions:**

- 发送结果未知时保留幂等身份，禁止自动重复提交。

- [x] **Task Status:** completed

Run: `pnpm typecheck`

Expected: 两端确认和提交流程的接口一致。

## 验证记录

- 共享适配器与 Web ACP 提交共 18 项测试通过。模拟 Agent 收到用户原文以及独立的历史文本块。重新创建 Provider 后，附件与来源身份可读，来源历史回合仅保留原记录。Web HTTP 拒绝跨项目来源，并对同一确认执行一次创建和发送。
- 根单测 3649 项通过，19 项跳过。新增 HTTP 与 Provider 专项在最终修订后再次通过。根架构、静态检查、TypeScript、ACP 编译宿主、Web 生产构建及包体预算通过。
- 桌面 `check:web` 通过，包括 837 项单测、静态检查、TypeScript、IPC 权限检查及构建预算。Chromium / WebKit 的 ACP 浏览器专项 14 项通过。Web 原有 ACP 草稿工作流在三种浏览器、390px 和 1280px 下共 6 项通过。
- 桌面 `check:rust` 通过，包含 520 项单测、6 项平台集成测试和 6 项 Release 性能基线。Web 性能测试 14 项通过。
- 交接历史在宿主内读取，附件上限 16 KiB。桌面临时任务沿用独立工作目录分配。验证使用模拟 Agent，实际账号的跨 Agent 模型回复尚未验证。
