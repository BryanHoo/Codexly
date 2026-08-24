# Bug Fix Implementation Plan

**Goal:** 让用户选择并发送的图片在消息列表中持续回显且可查看，同时不向 Web 暴露 Codex 本地文件路径。

**Suggested Spec Reads:**

- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex Item 到统一消息协议的映射与资源边界。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Task Timeline 用户消息和附件展示。
- `.superwork/spec/backend/quality-guidelines.md` — 约束本地路径、响应数据与测试安全边界。

**Architecture:** 统一消息协议增加受限图片附件；Codex Provider 将 `image` Data URL 或 `localImage` 本地文件校验为 GIF、JPEG、PNG、WebP，并在 2 MiB 上限内转换为 Data URL，原生路径不越过 Provider 边界。Web Timeline 渲染可点击缩略图，首轮运行时优先复用 Provider 返回的用户消息以支持纯图片回显。

**Tech Stack:** TypeScript、TypeBox、React 19、Codex App Server JSON-RPC、Vitest。

## Global Constraints

- 不新增任意本地文件 HTTP 暴露接口，也不向浏览器返回 Codex 原生路径。
- 只允许现有附件白名单格式并验证真实内容签名，图片大小固定不超过 2 MiB。
- 本地临时图片不可读时保留文本降级，不阻断完整任务历史。
- 在 Provider 转换与 Web 渲染边界保留简短清晰的中文注释。

### Task 1: Carry browser-renderable images in message protocol

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`

**Behavior Slice:** 用户消息可携带最多 4 个白名单 Data URL 图片附件，协议拒绝 SVG 和超限数据。

### Task 2: Convert Codex image references at provider boundary

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`

**Behavior Slice:** `image` 与 `localImage` 转换为统一消息附件；本地路径经文件类型和大小检查后转为 Data URL，响应不保留路径。

### Task 3: Render and preserve submitted image messages

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Modify: `apps/web/src/features/conversation/runtime/task-runtime.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-runtime.test.ts`

**Behavior Slice:** 用户消息显示可点击图片缩略图；纯图片 Turn 在 Snapshot 追平前复用 Provider 用户 Item，不再因空文本而消失。

**Verification:**

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/provider-codex/src/agent-provider.test.ts apps/web/src/features/conversation/runtime/task-runtime.test.ts apps/web/src/features/workbench/components/task-timeline.test.tsx`

Run: `pnpm typecheck`

Expected: 协议、Provider、运行时与 Timeline 聚焦测试通过，类型检查无错误。
