# Host Attachment Picker Implementation Plan

**Goal:** 让 Composer 的“添加图片”和“添加文件”通过 Codexly 宿主文件选择器导入附件，使已配对 LAN 浏览器可以选择运行设备上的文件。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Composer、Dialog 与功能组件边界。
- `.superwork/spec/frontend/type-safety.md` — 约束 Web 只消费经过 Client 校验的 Protocol 契约。
- `.superwork/spec/backend/directory-structure.md` — 约束宿主文件浏览和附件导入的 Server 路由职责。
- `.superwork/spec/shared/quality-guidelines.md` — 约束附件类型、大小、受控引用和传输安全。
- `docs/web-design.md` — 说明 Project 选择器、Composer 和附件工作流。

**Architecture:** 新增严格校验的宿主文件列表与导入契约；Server 仅列出真实目录及当前附件类型支持的普通文件，并将选中文件流式写入现有 `AttachmentStore`；Client 校验列表和导入响应；Web 复用 FileTree/Dialog 交互，在 Composer 草稿中保存受控附件引用，提交时跳过重复上传。拖拽和粘贴仍沿用浏览器文件输入处理，但按钮不再调用原生文件选择器。

**Tech Stack:** TypeScript、TypeBox、Fastify、React 19、TanStack Query、AI Elements、shadcn/ui、Vitest、pnpm。

## Global Constraints

- 保持所有 HTTP 输入和响应使用 Protocol Schema 严格校验，拒绝额外字段、相对路径、符号链接和不支持的文件类型。
- 保持文件内容只进入有大小、容量和 TTL 限制的 `AttachmentStore`，列表及 Composer 状态不保存文件正文。
- 保持图片和普通文件的既有单项/总量限制；Server 导入后返回现有 `AgentAttachment`，Turn 仍只提交附件 ID。
- 为关键路径解析、宿主文件过滤和受控附件复用添加简短、清晰的中文注释。
- 不保留按钮原生文件选择的旧兼容逻辑；拖拽和粘贴能力不受影响。
- 不启动开发服务器。

### Task 1: 定义宿主文件选择协议

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/project.test.ts`

**Interfaces:**

- Consumes: `ProjectDirectoryPathSchema`、`AgentAttachmentKindSchema`
- Produces: `HostFileQuerySchema`、`HostFileListingSchema`、`ImportHostAttachmentRequestSchema` 及对应公开类型

**Behavior:**

- 定义只允许 `file | image` 的选择种类、绝对路径查询、目录/文件判别条目和宿主附件导入请求，并验证额外字段、相对路径及非法种类会被拒绝。

**Stop Conditions:**

- 若现有绝对路径约束不能覆盖 macOS、Linux 与 Windows 宿主路径，则停止并先修正共享路径契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts`

Expected: 宿主文件列表与导入请求的合法/非法 Schema 用例全部通过。

### Task 2: 实现 Server 宿主文件浏览与受控导入

**Files:**

- Create: `packages/server/src/host-file-browser.ts`
- Create: `packages/server/src/host-file-browser.test.ts`
- Modify: `packages/server/src/attachment-store.ts`
- Modify: `packages/server/src/attachment-store.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/project-routes.ts`
- Modify: `packages/server/src/routes/schemas.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `HostFileQuery`、`ImportHostAttachmentRequest`、`AttachmentStore.add`
- Produces: `GET /v1/host-files`、`POST /v1/projects/:projectId/attachments/:kind/host`、`GET /v1/projects/:projectId/attachments/:attachmentId`、`HostAttachmentSource`

**Behavior:**

- 从宿主主目录或指定绝对目录开始，只列出真实直接子目录和当前种类支持的普通文件；导入时重新解析并校验文件身份、类型和路径，再以流式输入写入 `AttachmentStore`，并保持幂等响应。待提交图片通过 Project 作用域的随机附件 ID 读取预览，不暴露宿主路径。

**Stop Conditions:**

- 若导入无法复用 `AttachmentStore` 的签名、大小、容量或 TTL 校验，则停止，不创建第二套附件存储。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/host-file-browser.test.ts packages/server/src/app.test.ts`

Expected: 浏览过滤、路径拒绝、图片签名、Project 归属、幂等导入和错误映射用例通过。

### Task 3: 暴露类型安全的 Client 调用

**Files:**

- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/index.ts`
- Test: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `HostFileListingSchema`、`AgentAttachmentUploadResponseSchema`
- Produces: `CodexlyClient.listHostFiles`、`CodexlyClient.importHostAttachment`、`buildProjectAttachmentUrl`

**Behavior:**

- 为宿主文件按需浏览和幂等附件导入提供经过 Schema 校验的 Client 方法，并正确编码绝对路径、种类和 Project ID。

**Stop Conditions:**

- 若 Client Mutation 无法发送严格 JSON 请求或幂等键，则停止并先修正公共传输方法。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/client/src/http-client.test.ts`

Expected: 请求 URL、Body、幂等头和响应 Schema 测试通过。

### Task 4: 接入 Composer 宿主附件选择器

**Files:**

- Create: `apps/web/src/features/workbench/components/host-attachment-picker-dialog.tsx`
- Create: `apps/web/src/features/workbench/components/host-attachment-picker-dialog.test.tsx`
- Modify: `apps/web/src/shared/ai-elements/prompt-input.tsx`
- Modify: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Test: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`

**Interfaces:**

- Consumes: `CodexlyClient.listHostFiles`、`CodexlyClient.importHostAttachment`、`FileTree`、`PromptInputAttachment`
- Produces: `HostAttachmentPickerDialog`、受控宿主附件草稿、`PromptInputActionAddAttachments.onSelectKind`

**Behavior:**

- “添加图片”和“添加文件”打开可向上导航、懒加载目录、显示错误/重试状态的宿主选择 Dialog；确认后导入并显示附件 Chip/图片预览，提交和排队复用返回的附件 ID；按钮不渲染或触发原生文件输入，拖拽与粘贴仍可添加浏览器文件。

**Stop Conditions:**

- 若受控附件引用无法跨 Task 草稿和排队项保持到实际发送，则停止，不以空 `File` 或易失 Map 代替持久草稿数据。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/ai-elements/ai-elements.test.tsx apps/web/src/features/workbench/components/host-attachment-picker-dialog.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx`

Expected: 菜单回调、无原生文件输入、Dialog 可访问性、懒加载文件树和受控引用展示用例通过。

### Task 5: 更新稳定工程约束并完成全量验证

**Files:**

- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: 已实现的宿主附件选择和导入行为
- Produces: 与实现一致的安全边界、API 与 LAN 使用说明

**Behavior:**

- 记录宿主选择器仅列出受支持真实文件、导入仍进入统一附件 Store、LAN 浏览器与本地浏览器使用同一受控链路，并通过项目全量门禁。

**Stop Conditions:**

- 若任何文档描述与最终 Protocol 或路由不一致，则停止并先同步契约名称和安全边界。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 格式、Lint、架构、单元测试、性能测试、类型检查、构建和发布包检查全部通过。
