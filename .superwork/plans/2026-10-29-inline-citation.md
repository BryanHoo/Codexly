# Feature Implementation Plan

**Goal:** 将官方 Inline Citation 接入 Web、移动浏览器与桌面共用的流式正文。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 全局工程约束。
- `.superwork/spec/ui/shared/index.md` — 共享 UI、增量 Markdown 与平台回调。
- `.superwork/spec/web/frontend/index.md` — Web 与移动浏览器交互。
- `.superwork/spec/desktop/frontend/index.md` — 原生外链与 Chromium/WebKit 回归。

**Architecture:** 复用现有 Radix HoverCard 与 Button 实现官方组合，在两端 MarkdownLink 的本地文件分支之后识别 HTTP(S) 来源。由两端注入新窗口文案与桌面打开回调。不增加 AI SDK 或传输协议，不抓取来源网页。

**Tech Stack:** React、TypeScript、Radix UI、Streamdown、pnpm、Vitest。

## Global Constraints

- 两端共用 UI，通过 props 注入翻译与原生动作，不反向导入平台。
- 保留持久化分块树及纯文本快速路径，不逐 token 全文扫描。
- 保留本地文件、指令、代码、图片与非 HTTP(S) 链接语义。
- 关键逻辑添加中文注释；桌面文件不超过 500 行。
- 公告：inline-citation-20261029，owner codex-inline-citation-20261029。

### Task 1: 接入共享来源引用

**Files:**

- Create: `packages/ui/src/agent/inline-citation.tsx`
- Modify: `apps/web/src/shared/components/agent/message-response.tsx`
- Modify: `desktop/src/shared/components/agent/message-response.tsx`
- Test: `apps/web/src/shared/components/agent/message-response-inline-citations.test.tsx`
- Test: `apps/web/src/shared/components/agent/agent-components-markdown.test.tsx`
- Test: `desktop/src/shared/components/agent/message-response-inline-citations.test.ts`

**Interfaces:**

- Consumes: MarkdownLink 的 href、children、title 与桌面 openMarkdownLink。
- Produces: InlineCitation 共享来源组件；HTTP(S) 域名按钮与标题、完整 URL 预览。

**Behavior:**

- 静态与增量回复中的 HTTP(S) 来源显示域名引用，标题保留原标签，缺省回退域名。
- 无效地址与其他协议保持原链接，代码和本地文件不成为网络来源。

**Stop Conditions:**

- 若需要改动传输协议或来源元数据契约，先修订计划。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/components/agent/message-response-inline-citations.test.tsx`

Expected: 两种渲染模式、安全协议及原有文件语义通过。

### Task 2: 验证交互与流式稳定性

**Files:**

- Test: `desktop/src/shared/components/agent/inline-citation.browser.test.tsx`
- Test: `tests/e2e/app-shell-inline-citation.spec.ts`
- Test: `tests/e2e/app-shell-composer-review.spec.ts`
- Test: `tests/e2e/app-shell-runtime-queue.spec.ts`
- Test: `desktop/src/shared/components/agent/message-response-bold.browser.test.tsx`
- Modify: `packages/ui/src/agent/inline-citation.tsx`

**Interfaces:**

- Consumes: InlineCitation、AppendOnlyTextBuffer 与 MessageResponse。
- Produces: Chromium/WebKit 下悬停、键盘、点击及流式追加回归证据。

**Behavior:**

- 按钮可通过焦点和点击打开来源，Escape 关闭；来源链接复用宿主回调。
- 窄屏长链接不撑开浮层，流式分片闭合后出现引用，历史节点保持挂载。

**Stop Conditions:**

- 若底层浮层的跨端行为不一致，先确认差异再扩大改动。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/agent/inline-citation.browser.test.tsx`

Expected: Chromium 与 WebKit 的来源交互和流式稳定性通过。

## Final Verification

执行相关单元与浏览器回归、两端类型检查、lint、架构检查及构建预算。按改动范围核对性能和 Legacy 构建；未运行的平台明确记录。

## Evidence Ledger

- 官方依据：已读取 shadcn 的 Base 与 Radix Inline Citation 文档；两者均规定 HoverCard + Button、10ms/100ms 延迟、缺省域名和安全新窗口链接。项目沿用现有 Radix 基础组件与 Codex/Claude Markdown 协议，无新增依赖。
- RED：Web 新测试在静态和流式模式缺少来源按钮而失败；浏览器测试确认 Radix 移出 Tab 顺序、图片被隐藏及快速 Escape 后延迟重新展开的问题。
- GREEN：`pnpm exec vitest run packages/ui/src apps/web/src/shared/components/agent`，33 文件 / 234 项通过；`pnpm --dir desktop test:run src/shared/components/agent/message-response src/shared/components/agent/markdown-link-navigation.test.ts`，6 文件 / 66 项通过。
- GREEN：桌面 `inline-citation`、`message-response-bold`、`message-response`、`streaming-interaction` 的 Chromium/WebKit 浏览器回归，8 文件 / 50 项通过，包含焦点恢复、系统浏览器回调、长 URL、缺省标题、图片及历史节点稳定性。
- `pnpm lint`、`pnpm lint:architecture`、桌面 `lint` 与 `source:lines` 通过；两端构建内的类型检查通过。
- `pnpm build`、`pnpm bundle:check`、`pnpm package:check` 通过；Web 首屏 314.04 KiB / 320 KiB，工作台就绪 469.19 KiB / 500 KiB。桌面现代构建与 `performance:budget` 通过。
- `pnpm test:performance`，9 文件 / 17 项通过。
- 最终 E2E：`pnpm exec playwright test tests/e2e/app-shell-inline-citation.spec.ts tests/e2e/app-shell-composer-review.spec.ts tests/e2e/app-shell-runtime-queue.spec.ts --grep '流式来源引用|routes assistant links|does not show a tooltip' --workers=2`，8 项通过；覆盖三种浏览器、390px 真实触屏及 1280px 鼠标交互，检查真实新窗口、图片/系统文件和历史节点身份。
- `pnpm --dir desktop build:legacy` 通过；最后一次两端 lint、桌面 typecheck 与 `git diff --check` 通过。
- 格式检查首次仅发现本任务临时公告 JSON 的格式问题；格式化后重跑 `pnpm format:check` 已通过，输出 All matched files use Prettier code style。
- 简化审查：no-change；平台仅注入翻译和打开回调，来源识别与交互由一个共享组件维护；原链接安全属性统一由共享组件设置。
- 规范决定：update；更新 Web 与桌面前端索引，记录来源边界和 Radix 键盘兼容契约，不修改其他任务占用的共享 UI 索引。
- 证据复用：上述结果均来自本次执行和当前工作区，生产代码最后一次语义修改后通过；后续只有测试格式和规范更新，不影响代码证据。全部命令从仓库根目录执行。
- 未覆盖范围：未运行全仓测试、原生 Rust 套件与 Windows/Ubuntu 真机；本任务只修改共享 React 与两端 Markdown 适配，未修改原生、后端或公开协议。
