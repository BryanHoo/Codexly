# 长任务的 ACP 接续附件

**Goal:** 长对话接续时将宿主保留的聊天正文作为 Markdown 附件发送，首轮优先使用原始需求与近期回合。

**Suggested Spec Reads:**

- `.superwork/spec/core/shared/index.md` — 历史附件、正文续文和缓存租约
- `.superwork/spec/guides/cross-layer-thinking-guide.md` — 两端共用 ACP 路径

**Architecture:** 在共享 ACP 宿主读取来源历史，按需流式生成 Markdown 文件。复用现有任务文件仓储与 ACP 资源链接。

**Tech Stack:** TypeScript、ACP、pnpm、Vitest。

## Global Constraints

- 首条用户提示词和用户选中的附件保留；生成内容服从现有文件及传输预算。
- 长历史达到文件预算或来源历史有缺口时标注省略，原始任务仍可供回查。
- 同一宿主实现服务 Web 与桌面。正文读取按任务归属校验，暂存文件在准备完成或失败后回收。

### Task 1: 交付长任务的聊天记录

**Files:**

- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/task-attachments.ts`
- Modify: `packages/provider-acp/src/provider.ts`
- Modify: `packages/provider-acp/src/task-continuation.ts`
- Create: `packages/provider-acp/src/task-continuation-file.ts`
- Modify: `packages/provider-acp/src/turn-input.ts`
- Test: `packages/provider-acp/src/task-continuation.test.ts`
- Modify: `docs/agent-engines.md`
- Modify: `.superwork/spec/core/shared/index.md`

**Interfaces:**

- Consumes: `AcpHistory`
- Produces: 供 Agent 按需读取的 Markdown 文件与有界摘录

**Behavior:**

- 多页历史以及已保存的回答续文写入可在重启后下载的附件，原始需求与近期回合随首轮直接发送。短对话沿用现有文本附件。

**Stop Conditions:**

- 文件与短摘要预算耗尽时给出明确结果，不能假称已发送完整历史。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-acp/src/task-continuation.test.ts`

Expected: 模拟 Agent 收到原提示词、摘录和可读资源链接，重启后可以读回历史文件。

## 验证记录

- 扩展多页历史测试前，首轮只有原文和摘录，缺少文件资源链接。修复后 5 项接续测试通过，覆盖旧回合、近期回合、回答续文、重启读取以及文件超过预算和暂存清理。
- Core、Provider 与 Web ACP 提交测试 414 项通过，11 项跳过。类型、根静态检查、依赖边界和编译宿主 10 项检查通过。
- 桌面类型检查及 Chromium / WebKit 聊天输入与 ACP 专项 10 项通过。Web 性能测试 14 项通过，1 项跳过。目标 Agent 读取文件的验证使用模拟 ACP Agent。
