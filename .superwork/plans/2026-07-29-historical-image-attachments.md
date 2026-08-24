# Feature Implementation Plan

**Goal:** 让 Task Snapshot 只携带历史图片附件元数据，并通过受控本地端点按需读取二进制，避免 Base64 放大 Snapshot、缓存和解码内存。

**Suggested Spec Reads:**

- `.superwork/spec/backend/runtime-lifecycle.md` — 约束历史图片校验、Provider 生命周期和所有缓存预算。
- `.superwork/spec/backend/quality-guidelines.md` — 约束受控 HTTP 路由、安全校验和 Fastify 测试。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Timeline 图片、长历史和稳定渲染尺寸。
- `.superwork/spec/frontend/state-management.md` — 约束 Snapshot 缓存与非活动 Runtime 内存预算。
- `.superwork/spec/shared/quality-guidelines.md` — 约束协议变更、附件契约和调用方同步。

**Architecture:** 将 `AgentMessageAttachment` 改为不含 `url` 的随机 ID 元数据；Codex Provider 在映射历史消息时建立有界、短生命周期的 Task 作用域授权记录，并通过新 Provider 端口按 ID 读取经签名复验的二进制；Server 先验证 Project/Task 归属再返回图片，Client 统一生成受控 URL；Timeline 使用该 URL 延迟加载、异步解码并固定缩略图尺寸。删除历史 Data URL 输出路径，不保留旧协议兼容分支。

**Tech Stack:** TypeScript、TypeBox、Fastify、React、Vitest、Testing Library、pnpm。

## Global Constraints

- 保持 `protocol <- core <- provider-codex <- server` 与 `protocol <- client <- web` 的依赖方向。
- 历史图片仍只允许 GIF、JPEG、PNG、WebP，单图不超过 `2 MiB`，内容签名是最终类型依据。
- 所有新增 Task 附件状态必须同时具备总字节预算、Entry 上限、TTL 和 Task 释放清理触发点。
- 浏览器和 Snapshot 不得再接收历史图片 Base64 Data URL 或 Codex 本地绝对路径。
- 关键协议、授权校验、缓存清理和图片加载位置添加简短、明确的中文注释。
- 不启动开发服务器；最终运行 `pnpm check`，页面行为再运行 `pnpm test:e2e`。

### Task 1: 定义历史附件元数据与 Provider 读取端口

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/protocol/src/agent-event.ts`
- Modify: `packages/protocol/src/agent-event.test.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `AgentMessageAttachment`: 现有 `{ mediaType, name, url }` Schema。
- Produces: `AgentMessageAttachment`: `{ id, mediaType, name, size }`。
- Produces: `AgentProviderAttachment`: `{ content: Uint8Array, mediaType, name, size }`。
- Produces: `AgentProvider.readTaskAttachment(taskId, attachmentId)`: `Promise<AgentProviderAttachment | undefined>`。
- Produces: `AgentEvent.version`: 升级后的单一事件版本。

**Behavior Slice:**

协议边界接受受控附件元数据并拒绝 Data URL/额外字段；Core 明确 Provider 二进制读取能力，不向 Protocol 泄漏 Codex 路径。

**Proof Intent:**

先让协议测试因旧 `url` 结构和旧事件版本失败，再更新 Schema 与端口类型使测试通过。

**Verification:**

- Command: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/protocol/src/agent-event.test.ts packages/core/src/agent-provider.test.ts`
- Expected: 相关 Vitest suites 全部通过。

**Stop Conditions:**

- 若统一事件无法在不并存旧版本的前提下升级，或已有公开消费者不在仓库中，停止执行并修订计划。

### Task 2: 建立 Codex 历史附件授权存储

- [x] **Task Status:** completed

**Files:**

- Create: `packages/provider-codex/src/historical-attachment-store.ts`
- Create: `packages/provider-codex/src/historical-attachment-store.test.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `AgentMessageAttachment`: `{ id, mediaType, name, size }`。
- Consumes: `AgentProvider.readTaskAttachment(taskId, attachmentId)`: `Promise<AgentProviderAttachment | undefined>`。
- Produces: `CodexHistoricalAttachmentStore`: 注册随机 ID 元数据，并按 `taskId + attachmentId` 读取内容。
- Produces: `CodexAgentProvider.readTaskAttachment(taskId, attachmentId)`: 实现 Task 归属校验与受控读取。
- Produces: `CodexAgentProvider.unsubscribeTask(taskId)`: 清理对应历史附件授权记录。

**Behavior Slice:**

Snapshot 映射只注册元数据；读取端点调用时才读取本地文件正文，Data URL 二进制仅在有界 Store 内保留；缺失、超限、签名不符、容量不足或过期图片降级为 `[图片]` 或不可用，不使整个 Snapshot 失败。

**Proof Intent:**

覆盖 Data URL 不进入 Snapshot、本地图片延迟读取、随机 ID、签名校验、总预算、Entry 上限、TTL、跨 Task 拒绝和 unsubscribe 清理。

**Verification:**

- Command: `pnpm exec vitest run packages/provider-codex/src/historical-attachment-store.test.ts packages/provider-codex/src/agent-provider.test.ts`
- Expected: 历史图片与 Provider 生命周期测试全部通过。

**Stop Conditions:**

- 若 Codex `localImage` 在读取时无法可靠复验文件身份，或并发 Snapshot 会产生不可消除的授权错配，停止执行并修订存储契约。

### Task 3: 暴露 Project/Task 作用域二进制端点

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/server/src/agent-event-stream.ts`
- Modify: `packages/server/src/agent-event-stream.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `packages/client/src/event-client.ts`
- Modify: `packages/client/src/event-client.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-activity.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-runtime.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store.test.ts`
- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `AgentProvider.readTaskAttachment(taskId, attachmentId)`: `Promise<AgentProviderAttachment | undefined>`。
- Consumes: `AgentEvent.version`: 升级后的单一事件版本。
- Produces: `GET /v1/projects/:projectId/tasks/:taskId/attachments/:attachmentId`: 返回声明媒体类型的受控二进制。
- Produces: `buildTaskAttachmentUrl(baseUrl, projectId, taskId, attachmentId)`: `string`。

**Behavior Slice:**

浏览器可使用随机附件 ID 按需读取图片；响应禁止 MIME sniffing，并使用受控缓存头；所有路径参数与 Provider 返回媒体类型均经过固定边界校验。

**Proof Intent:**

使用 Fastify `inject` 验证成功二进制、Project/Task/附件不存在、跨 Task 拒绝、响应头；Client 测试验证特殊字符编码和新事件版本。

**Verification:**

- Command: `pnpm exec vitest run packages/server/src/app.test.ts packages/server/src/agent-event-stream.test.ts packages/client/src/http-client.test.ts packages/client/src/event-client.test.ts`
- Expected: 路由和客户端契约测试全部通过。

**Stop Conditions:**

- 若 Fastify 响应 Schema 会把 Buffer JSON 化，或现有 `baseUrl` 不能安全构造资源 URL，停止执行并先修订交付接口。

### Task 4: 延迟加载 Timeline 图片并更新稳定规范

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: `AgentMessageAttachment`: `{ id, mediaType, name, size }`。
- Consumes: `buildTaskAttachmentUrl(baseUrl, projectId, taskId, attachmentId)`: `string`。
- Produces: `TimelineHistoricalImage`: 使用受控 URL、`loading="lazy"`、`decoding="async"`、`width` 和 `height` 的稳定缩略图。

**Behavior Slice:**

可视区外历史图片不主动解码，图片加载前后不改变缩略图布局；点击预览仍只打开受控端点；Snapshot、内存估算和文档不再描述历史 Data URL。

**Proof Intent:**

静态渲染测试断言 URL 编码、无 Base64、lazy/async 与显式尺寸；现有附件可访问名称和新窗口行为保持可观察一致。

**Verification:**

- Command: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx apps/web/src/app/snapshot-memory.test.ts && pnpm check && pnpm test:e2e`
- Expected: Timeline、Snapshot 内存、仓库门禁和浏览器流程全部通过。

**Stop Conditions:**

- 若 Timeline 当前身份模型无法无复制地提供 `projectId/taskId`，或端到端测试发现固定缩略图尺寸造成窄屏溢出，停止执行并修订组件边界或尺寸 Token。
