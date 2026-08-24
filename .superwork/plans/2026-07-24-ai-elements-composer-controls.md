# AI Elements Composer Controls Implementation Plan

**Goal:** 将工作台底部输入框升级为完整 AI Elements Composer，并让图片附件、审批策略、真实模型、思考量与上下文用量贯穿 Web、Client、Server、Core 和 Codex Provider。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 AI Elements 组件基线、可访问性与工作台视觉。
- `.superwork/spec/frontend/state-management.md` — 约束 Composer 状态、草稿和幂等重试。
- `.superwork/spec/frontend/type-safety.md` — 约束 Web 只消费 Protocol 契约。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex RPC、审批和资源清理。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Fastify Schema、安全边界与测试。
- `.superwork/spec/shared/directory-structure.md` — 约束跨包依赖方向。
- `.superwork/spec/shared/quality-guidelines.md` — 约束运行时 Schema、Provider 输入和 API。
- `docs/architecture-design.md` — 定义 `model/list`、`turn/start` 和 Provider 边界。
- `docs/web-design.md` — 定义 PromptInput、附件和模型选择交互。

**Architecture:** Protocol 定义 Provider 无关的模型、附件上传和 Turn 选项契约；Core 将浏览器附件引用与 Provider 可消费输入分离；Server 以有界、带过期时间的内存附件存储将 Data URL 转成受控引用；Codex Adapter 映射 `model/list`、图片 `UserInput`、`approvalPolicy` 与 `model`；Client 校验全部响应；Web 使用项目内 AI Elements `PromptInput` 组合附件、审批策略和模型控件。

**Tech Stack:** TypeScript 6、TypeBox、Fastify 5、React 19、TanStack Query、AI Elements、Vitest、Playwright、pnpm。

## Global Constraints

- 浏览器只提交 Server 生成的附件 ID，不得提交本地绝对路径或任意 Provider 原生输入。
- 附件仅接受 Codex 当前稳定支持的图片类型，并限制单文件大小、数量、存储容量和有效期。
- 模型列表必须来自 Codex `model/list`；页面不保留硬编码模型作为成功态回退。
- 审批策略只暴露统一协议支持的 `untrusted`、`on-request`、`never`，并由 Server Schema 再校验。
- 思考量必须来自所选模型的 `supportedReasoningEfforts`，默认使用 `defaultReasoningEffort`，不得硬编码不存在的模型能力。
- 当前上下文用量必须来自 `thread/tokenUsage/updated`，使用最近一次调用的总 Token 与模型上下文窗口计算，不用累计账单 Token 冒充上下文占用。
- Turn 提交失败必须保留文本、附件和选项；成功后才清空 Composer。
- 关键逻辑添加简短、清晰的中文注释，删除被新逻辑取代的禁用占位实现。

### Task 1: 定义模型、附件与 Turn 选项契约

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: existing `AgentProvider` and `StartAgentTurnRequestSchema`
- Produces: `AgentModelPage`, `AgentAttachmentUploadRequest`, `AgentAttachment`, `AgentPromptInput`, `AgentApprovalPolicy`, `AgentTurnOptions`
- Produces: `AgentProvider.listModels`
- Produces: `AgentProvider.startTurnOptions`

**Behavior Slice:** 用 TypeBox 严格定义模型列表、图片上传、附件引用和 Turn 选项；空文本且无附件、未知附件类型、非法 Data URL、空模型和未知审批策略必须在运行时 Schema 边界失败，Core 端口不得暴露浏览器附件 ID 给 Provider。

**Proof Intent:** Protocol 测试覆盖合法与非法请求/响应，Core Fake Provider 证明模型读取与包含图片的 Turn 输入使用 Provider 无关接口。

**Verification:** Run `pnpm exec vitest run packages/protocol/src/project.test.ts packages/core/src/agent-provider.test.ts`; expect all targeted tests to pass.

Expected: targeted Protocol and Core tests exit 0.

**Stop Conditions:**

若本地 Codex 0.145.0 生成类型不支持稳定的图片 `UserInput`、`model/list` 或 Turn 级审批策略，则先修订契约，不添加页面假能力。

### Task 2: 实现 Codex 模型与 Turn 参数映射

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/test/fixtures/fake-app-server.mjs`

**Interfaces:**

- Consumes: `AgentProvider.listModels`
- Consumes: `AgentProvider.startTurnOptions`
- Produces: paginated `model/list` mapping and `turn/start` text/image/model/approval mapping

**Behavior Slice:** Provider 读取全部非隐藏模型并映射默认模型与展示信息；Turn 将文本和受控图片 URL 转为 Codex `UserInput[]`，同时传递 `model` 与 `approvalPolicy`；畸形模型响应或非法 Provider 输入必须失败。

**Proof Intent:** Fake RPC 精确断言 `model/list` 游标、过滤结果和 `turn/start` 参数，并覆盖图片输入、无文本附件提交及畸形响应。

**Verification:** Run `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts`; expect all Provider mapping tests to pass.

Expected: targeted Codex Provider tests exit 0.

**Stop Conditions:**

若真实生成 Schema 与测试参数不一致，以已安装 Codex 0.145.0 的生成结果为准，先更新接口和计划再继续。

### Task 3: 交付受控附件、模型与 Turn HTTP API

- [x] **Task Status:** completed

**Files:**

- Create: `packages/server/src/attachment-store.ts`
- Create: `packages/server/src/attachment-store.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `packages/client/src/index.ts`

**Interfaces:**

- Consumes: `AgentModelPage`, `AgentAttachmentUploadRequest`, `AgentAttachment`, `AgentPromptInput`, `AgentApprovalPolicy`, `AgentTurnOptions`
- Consumes: `AgentProvider.listModels`
- Consumes: `AgentProvider.startTurnOptions`
- Produces: `GET /v1/models`, `POST /v1/attachments`, expanded `POST /v1/tasks/:taskId/turns`
- Produces: `CodeAgentClient.listModels`
- Produces: `CodeAgentClient.uploadAttachment`
- Produces: `CodeAgentClient.startTurnOptions`

**Behavior Slice:** Server 以有界 TTL Store 保存已验证图片 Data URL，只把随机附件 ID 返回浏览器；启动 Turn 前解析当前 Store 中的全部 ID，并在成功后消费；未知或过期 ID 返回结构化错误；Client 发送并校验真实 API 数据。

**Proof Intent:** `app.inject` 覆盖模型读取、上传限制、幂等上传、过期/未知附件、成功消费、模型与审批透传；Client 测试覆盖 URL、Header、Body 和 Schema 失败。

**Verification:** Run `pnpm exec vitest run packages/server/src/attachment-store.test.ts packages/server/src/app.test.ts packages/client/src/http-client.test.ts`; expect all targeted tests to pass.

Expected: targeted Server and Client tests exit 0.

**Stop Conditions:**

若附件存储不能在 Server 关闭时同步清理，或请求体上限无法在上传路由局部约束，则先修复资源边界，不扩大全局不受限 Body。

### Task 4: 用 AI Elements 完成 Composer 交互

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/shared/ai-elements/attachments.tsx`
- Modify: `apps/web/src/shared/ai-elements/prompt-input.tsx`
- Modify: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`

**Interfaces:**

- Consumes: `CodeAgentClient.listModels`
- Consumes: `CodeAgentClient.uploadAttachment`
- Consumes: `CodeAgentClient.startTurnOptions`
- Produces: attachment picker/preview/remove, approval selector, model selector, loading/error states and structured submit

**Behavior Slice:** Composer 支持点击、拖放和粘贴图片，显示预览并可移除；模型选择来自 Query 的真实 API，默认选中 Server 标记模型；审批策略可选；提交时先上传附件再启动 Turn，失败保留全部输入，成功释放 Blob URL 并清空；IME、Enter/Shift+Enter、运行/重连状态保持正确。

**Proof Intent:** Vitest 覆盖 AI Elements 组合的附件约束和可访问名称，以及 Composer 结构化提交、默认模型、选项切换、失败保留和成功清理。

**Verification:** Run `pnpm exec vitest run apps/web/src/shared/ai-elements/ai-elements.test.tsx apps/web/src/features/projects/project-queries.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx`; expect all targeted tests to pass.

Expected: targeted Web tests exit 0.

**Stop Conditions:**

若现有本地 AI Elements 源码无法提供文件 Provider、表单提交和可访问控件，则按官方组件公开 API 补齐本地源码，不引入 AI SDK Runtime。

### Task 5: 验证完整浏览器链路与稳定规范

- [x] **Task Status:** completed

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `tests/fixtures/fake-realtime-server.mjs`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: `GET /v1/models`, `POST /v1/attachments`, expanded `POST /v1/tasks/:taskId/turns`
- Produces: 浏览器级附件/模型/审批选择证据和更新后的稳定边界说明

**Behavior Slice:** Playwright 从工作台选择真实 Fake Model 与审批策略、添加图片、提交并断言 Fake Server 收到附件引用解析后的结构化 Turn；桌面与窄屏均无溢出、重叠或控制台错误；规范记录受控附件生命周期和模型来源。

**Proof Intent:** E2E 观察模型选项、图片预览、请求 Payload、成功清空和失败保留；最终门禁覆盖所有包构建与协议测试。

**Verification:** Run `pnpm check` then `pnpm test:e2e`; expect both commands to exit 0.

Expected: `pnpm check` and `pnpm test:e2e` both exit 0.

**Stop Conditions:**

若 E2E 暴露跨层契约漂移，返回最早失败的任务修复；不得在浏览器测试中绕过生产 Client 或 Server 边界。

### Task 6: 接入模型思考量与上下文用量协议

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/agent-event.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/protocol/src/agent-event.test.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/test/fixtures/fake-app-server.mjs`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `tests/realtime-path.test.ts`

**Interfaces:**

- Consumes: Codex `Model.supportedReasoningEfforts`, `Model.defaultReasoningEffort`, `TurnStartParams.effort`
- Consumes: Codex `thread/tokenUsage/updated` with `last.totalTokens` and `modelContextWindow`
- Produces: `AgentReasoningEffortOption`, expanded `AgentModel`, expanded `AgentTurnOptions`
- Produces: `AgentContextUsage`, `usage.updated`, and `AgentTaskSnapshot.contextUsage`

**Behavior Slice:** 模型目录保留真实思考量能力与默认值，Turn 将统一 `reasoningEffort` 映射到 Codex `effort`；Provider 将已验证 Task 的 Token Usage 转为统一上下文用量事件，并在后续 Snapshot 中保留最近值；畸形、负数或越界字段在协议边界失败。

**Proof Intent:** Protocol 测试覆盖模型能力、Turn 选项、上下文用量和 usage 事件；Provider Fake RPC 精确断言 `effort`，验证未知 Task 隔离、读取期间事件顺序与 Snapshot 恢复；Server/Client/Realtime 测试覆盖新增必填字段。

**Verification:** Run `pnpm exec vitest run packages/protocol/src/project.test.ts packages/protocol/src/agent-event.test.ts packages/provider-codex/src/agent-provider.test.ts packages/server/src/app.test.ts packages/client/src/http-client.test.ts tests/realtime-path.test.ts`; expect all targeted tests to pass.

Expected: targeted cross-layer contract tests exit 0.

**Stop Conditions:**

若本地 Codex 生成 Schema 不提供模型级思考量、Turn `effort` 或 `thread/tokenUsage/updated`，停止页面接入并修订计划；不得使用静态选项或估算数据伪造能力。

### Task 7: 完成 Composer 紧凑控件与上下文展示

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/task-runtime.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-runtime.test.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Modify: `apps/web/src/shared/ai-elements/prompt-input.tsx`
- Modify: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: `AgentModel.supportedReasoningEfforts`, `AgentModel.defaultReasoningEffort`
- Consumes: `AgentTaskSnapshot.contextUsage` and `usage.updated`
- Produces: compact approval/model/reasoning selectors and far-right context usage status
- Produces: primary-color focused Composer border

**Behavior Slice:** 思考量选择紧邻模型并随模型能力切换；审批、模型和思考量 Select 隐藏原生箭头并按当前文字收缩；Composer 聚焦时显示稳定的主色边框；底部分支/路径行最右显示真实上下文占用百分比和 Token 明细，未知时显示明确占位，窄屏不重叠。

**Proof Intent:** Runtime 测试验证 usage 事件归并；组件测试验证选择默认值和提交参数；Playwright 断言控件样式、聚焦边框、usage 更新、桌面与窄屏布局以及请求中的 `reasoningEffort`。

**Verification:** Run `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-runtime.test.ts apps/web/src/shared/ai-elements/ai-elements.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx` then `pnpm check` and `pnpm test:e2e`; expect all commands to exit 0.

Expected: targeted Web tests, repository checks, and browser E2E all exit 0.

**Stop Conditions:**

若原生 Select 无法在支持浏览器中按当前文字稳定收缩，则保留语义化 Select 并使用项目现有弹层组件实现，不得退回固定大宽度或无键盘支持的自定义菜单。
