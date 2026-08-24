# Feature Implementation Plan

**Goal:** 右侧 Inspector 来源中的附件按现有文件能力打开，可预览内容使用当前页面 Dialog，不可预览文件使用宿主系统默认应用。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector、附件 Dialog 与文件打开交互。
- `.superwork/spec/shared/quality-guidelines.md` — 约束附件随机 ID、Task 归属和受控正文端点。
- `.superwork/spec/backend/directory-structure.md` — 约束宿主打开能力与附件存储边界。

**Architecture:** 保留附件随机 ID 契约；新增 Task 附件系统打开 Mutation，由 Server 授权读取附件、生成有界短期副本并调用既有 `ProjectOpenService`。Web 继续通过既有附件正文端点预览图片和文本，并按既有扩展名分类决定 Dialog 或系统打开。

**Tech Stack:** TypeScript、Fastify、React、TanStack Query、Vitest、Playwright、pnpm。

## Global Constraints

- 不向 Web 返回宿主绝对路径或附件正文 Base64。
- 所有系统打开操作必须验证 Project、Task 和随机附件 ID 归属。
- Timeline 现有图片预览与文件下载行为保持不变。

### Task 1: 添加受控附件系统打开能力

**Files:**

- Modify: `packages/protocol/src/agent-attachments.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/http-client-tasks.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `packages/server/src/routes/task-routes.ts`
- Create: `packages/server/src/routes/task-attachment-routes.ts`
- Modify: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `AgentMessageAttachment`、`ProjectOpenService`、Task 附件读取能力。
- Produces: `OpenTaskAttachmentRequest`、`OpenTaskAttachmentResponse` 和 `CodeAgentClient.openTaskAttachment`。

**Behavior:**

- 对已授权且不可在 Web 预览的 Task 文件附件，使用 `system-default` 打开 Server 管理的短期本地副本；拒绝未知 Project、Task 或附件，且响应不暴露本地路径。

**Stop Conditions:**

- 如果现有附件正文无法安全写入受控短期 Store，停止并返回存储边界证据。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts packages/server/src/app.test.ts`

Expected: 新增附件系统打开契约、Client 请求和 Server 授权测试通过。

### Task 2: 接入 Inspector 附件预览与系统分流

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-inspector-sources.tsx`
- Create: `apps/web/src/features/workbench/components/message-source-attachment.tsx`
- Modify: `apps/web/src/features/workbench/project-file-reference.ts`
- Modify: `apps/web/src/features/workbench/project-file-reference.test.ts`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: `classifyProjectFileReference`、Task 附件正文 URL、`CodeAgentClient.openTaskAttachment`。
- Produces: Inspector 图片 Dialog、源码/文本附件 Dialog、不可预览附件系统打开操作。

**Behavior:**

- 图片附件复用图片 Dialog；文本和源码附件在当前页面 Dialog 打开；系统文件点击后调用附件系统打开 Mutation，不渲染 `download` 链接。

**Stop Conditions:**

- 如果附件元数据不足以稳定区分 Web 可预览格式与系统格式，停止并补充明确契约，不根据 MIME 猜测未知内容。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: Inspector 测试证明图片、源码附件和系统附件分别进入正确打开路径，且不存在下载链接。
