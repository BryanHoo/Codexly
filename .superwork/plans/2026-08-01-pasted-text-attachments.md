# Pasted Text Attachments Implementation Plan

**Goal:** 将超过 1,000 字符的纯文本粘贴转换为 `Pasted text.txt` 附件，并通过受控附件链路完整提交而不写入 Composer 正文。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Composer 粘贴、附件、草稿和 IME 行为。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束浏览器交互与 Playwright 验证。
- `.superwork/spec/shared/quality-guidelines.md` — 约束附件协议、Schema 和消费者同步。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束附件 Store、Provider 输入和生命周期。
- `docs/web-design.md` — 定义 PromptInput、附件上传与提交边界。

**Architecture:** 扩展统一附件契约以支持 `text/plain`，Server 在既有有界 TTL Store 中保存文本 Data URL 并将图片与文本分别解析；Codex Provider 将文本附件映射为带完整 UTF-8 字节范围和文件占位名称的独立 `text` UserInput。Web 在 paste capture 阶段把超过阈值的纯文本转换为本地 File 附件，保持普通文本与图片粘贴逻辑不变。

**Tech Stack:** TypeScript、React 19、TypeBox、Fastify、Vitest、Playwright、Codex App Server JSON-RPC。

## Global Constraints

- 仅当纯文本字符数严格大于 `1,000` 时生成 `Pasted text.txt`；等于阈值仍按普通文本粘贴。
- 文本附件沿用最多 4 个、单个最多 2 MiB、总容量和 TTL 限制，不允许浏览器提交本地路径。
- 粘贴转换不得重建编辑器 DOM、破坏 IME、吞掉图片粘贴或改变短文本的光标插入行为。
- Turn 成功后消费附件，上传或 Turn 失败时保留草稿与附件供幂等重试。
- 按新逻辑更新全部消费者，不保留仅支持图片的冗余分支。

### Task 1: 贯通文本附件协议与 Provider 输入

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/agent-provider.test.ts`
- Modify: `packages/server/src/attachment-store.ts`
- Modify: `packages/server/src/attachment-store.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `AgentAttachmentUploadRequest`, `AgentPromptInput`, Codex `UserInput.Text.text_elements`
- Produces: 支持 `text/plain` 的 `AgentAttachment`、可区分 `images` 与 `textAttachments` 的 `AgentProviderTurnInput`

**Behavior:**

- 接受受限 Base64 文本附件并校验实际 UTF-8 字节；Server 按附件类型解析，Provider 将文本附件内容作为独立 `text` part 提交，`text_elements` 覆盖完整 UTF-8 字节范围并以文件名作为占位符；重复、过期和非法附件继续返回稳定错误。

**Stop Conditions:**

- 如果当前 Codex `UserInput.Text` 不支持 `text_elements` 字节范围或文本附件无法保持有界存储，则停止并修订协议设计。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/core/src/agent-provider.test.ts packages/server/src/attachment-store.test.ts packages/server/src/app.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: 文本附件 Schema、存储、Server 解析和 Codex RPC 映射测试全部通过。

### Task 2: 将大段粘贴转换为 Composer 文件附件

**Files:**

- Modify: `apps/web/src/shared/ai-elements/prompt-input.tsx`
- Modify: `apps/web/src/shared/ai-elements/attachments.tsx`
- Modify: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`

**Interfaces:**

- Consumes: `PromptInputAttachment`, `PromptInput` paste event、`CodexlyMutationClient.uploadAttachment`
- Produces: `LARGE_PASTE_CHARACTER_THRESHOLD`、`Pasted text.txt` 本地附件和按媒体类型上传的 Data URL

**Behavior:**

- 捕获超过 1,000 字符的纯文本粘贴并生成可移除的 `text/plain` 附件，不把正文插入编辑器；短文本、图片粘贴、附件数量/大小限制、草稿切换和失败重试保持可观察行为正确。

**Stop Conditions:**

- 如果 capture 阶段会重复处理图片或无法阻止编辑器插入长文本，则停止并改为在 `PromptSkillEditor` 边界显式上交粘贴内容。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/ai-elements/ai-elements.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx`

Expected: PromptInput 附件结构与 Composer 提交辅助逻辑测试全部通过。

### Task 3: 覆盖浏览器粘贴与真实提交链路

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `docs/web-design.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`

**Interfaces:**

- Consumes: 工作台 Fake Server 路由、浏览器 `ClipboardEvent`、附件上传与 Turn HTTP 契约
- Produces: 大段粘贴附件 UI、上传请求和 Turn 附件引用的浏览器级证据及更新后的架构约束

**Behavior:**

- Playwright 验证 1,001 字符粘贴显示 `Pasted text.txt`、编辑器保持为空、提交上传 `text/plain` Data URL 并仅向 Turn 发送附件 ID；文档同步记录阈值、命名、生命周期和 Provider 映射。

**Stop Conditions:**

- 如果浏览器无法稳定构造带纯文本的 ClipboardEvent，则使用已显式授权的系统 Clipboard API，不降低用户可观察断言。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "large pasted text"`

Expected: 大段文本粘贴附件化和真实 Client 提交流程在 Chromium 中通过。
