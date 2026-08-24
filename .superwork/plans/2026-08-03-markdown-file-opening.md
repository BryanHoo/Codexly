# Feature Implementation Plan

**Goal:** 让中栏 AI Markdown 中的外链、本地文本文件、图片和不可预览文件按各自规则安全打开，并支持 Project 内绝对磁盘路径。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束验证命令和跨包实现方式。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Markdown 与 Dialog 组件职责。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束链接、交互和组件测试。
- `.superwork/spec/backend/directory-structure.md` — 约束宿主文件打开与路径校验边界。
- `.superwork/spec/backend/quality-guidelines.md` — 约束外部路径输入和错误响应。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Protocol Schema 与调用方同步。
- `docs/web-design.md` — 约束 Markdown 链接安全和 Project 文件预览。
- `docs/architecture-design.md` — 约束 Project 根目录与宿主进程能力。

**Architecture:** 在 Web 层对 AI 文件引用按可预览文本、图片和系统文件分类；文本沿用源文件 Dialog，图片通过新增的受控只读图片端点在同一 Dialog 内展示，不可预览文件调用 `system-default`。Server 统一校验相对或绝对文件引用都位于当前 Project 内且不经过符号链接，Protocol 与 Client 只暴露固定能力。

**Tech Stack:** TypeScript、React、Streamdown、TanStack Query、Fastify、TypeBox、Vitest、Playwright。

## Global Constraints

- 外部 Markdown 链接只允许安全协议，并使用新标签页与安全 `rel` 属性。
- 浏览器不得获得任意文件系统或进程透传能力；所有磁盘路径必须由 Server 重新校验 Project 边界。
- `system-default` 只能打开普通文件，不能打开目录。
- 图片预览只允许受支持的 GIF、JPEG、PNG、WebP 内容签名，并设置正确媒体类型与有界文件大小。
- 不保留旧的失败后报错逻辑作为主要路径；明确分类后直接执行新规则。

### Task 1: 定义 Markdown 文件引用分类与链接规则

**Files:**

- Create: `apps/web/src/features/workbench/project-file-reference.ts`
- Create: `apps/web/src/features/workbench/project-file-reference.test.ts`
- Modify: `apps/web/src/shared/ai-elements/message.tsx`
- Test: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`

**Interfaces:**

- Consumes: `MessageFileReference`、Streamdown `Components`
- Produces: `ProjectFileReferenceKind`、`classifyProjectFileReference`、安全外链渲染约束

**Behavior:**

- 将受支持图片识别为弹窗图片预览，将已知 Office、演示、表格、归档等二进制格式识别为系统默认应用打开，其余代码与文本路径保持源文件弹窗预览；外部链接固定在新标签打开并拒绝危险协议。

**Stop Conditions:**

- 如果 Streamdown 无法在组件边界阻止危险协议，停止并先确认其 URL 安全配置接口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/project-file-reference.test.ts apps/web/src/shared/ai-elements/ai-elements.test.tsx`

Expected: 文件类型分类及外链安全属性的目标测试通过。

### Task 2: 扩展受控图片读取与绝对文件引用打开能力

**Files:**

- Create: `packages/server/src/project-image-file.ts`
- Create: `packages/server/src/project-image-file.test.ts`
- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `packages/server/src/project-open.ts`
- Modify: `packages/server/src/project-open.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/project-routes.ts`

**Interfaces:**

- Consumes: 当前 Project 根目录、AI 返回的相对或绝对文件路径、`system-default`
- Produces: `buildProjectImageFileUrl`、`GET /v1/projects/:projectId/files/image`、支持绝对 Project 文件引用的 `OpenProjectRequest`

**Behavior:**

- Server 对图片和系统打开请求逐段拒绝符号链接与越界路径；图片端点只流式返回有界且内容签名匹配的 GIF、JPEG、PNG、WebP；系统打开把绝对 Project 文件引用安全交给宿主默认应用。

**Stop Conditions:**

- 如果 Fastify 响应序列化无法安全返回二进制 Buffer，停止并改用明确的内容流响应 Schema。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts packages/server/src/project-image-file.test.ts packages/server/src/project-open.test.ts packages/server/src/app.test.ts`

Expected: Protocol、Client、路径边界、图片签名和宿主打开测试全部通过。

### Task 3: 接通中栏文件点击工作流并更新规范

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/project-source-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `docs/web-design.md`
- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: `classifyProjectFileReference`、`buildProjectImageFileUrl`、`CodexlyClient.openProject`
- Produces: 中栏 AI 文件引用的文本预览、图片预览与系统默认应用打开完整交互

**Behavior:**

- 点击代码和文本文件继续打开源文件 Dialog；点击图片在 Dialog 中按原始比例预览；点击 doc、ppt 等不可预览文件直接请求 `system-default`；相对路径和 Project 内绝对磁盘路径都遵循同一规则。

**Stop Conditions:**

- 如果宿主打开能力列表不包含 `system-default`，停止直接调用并向用户显示现有 Mutation 错误状态。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-composer.spec.ts`

Expected: 外链新标签、文本 Dialog、图片 Dialog、不可预览文件系统打开和绝对路径场景通过 E2E。
