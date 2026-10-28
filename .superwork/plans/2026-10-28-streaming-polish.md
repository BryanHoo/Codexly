# 流式体验优化实施计划

**Goal:** 对照新版 AI Elements，降低共享聊天流式渲染开销并修复追加文本及后台动效。

**Suggested Spec Reads:**

- `.superwork/spec/ui/shared/index.md` — 共享 UI、流式与浏览器验证。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 两端复用边界。
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 有界增量与跨浏览器性能。
- `.superwork/spec/desktop/frontend/index.md` — Chromium/WebKit 回归。
- `.superwork/spec/web/frontend/index.md` — Web/移动端验证。

**Architecture:** 保留 Message Scroller、Trace 和增量 Markdown；用渲染计数保护已有稳定子树隔离，只更新新增正文的动画身份，隐藏页面取消入场动画。

**Tech Stack:** React、TypeScript、Streamdown、WAAPI、pnpm、Vitest Browser、Playwright。

## Global Constraints

- Web/移动与桌面共用实现；不逐 token 全文复制或解析，不增加定时器、依赖及传输延迟。
- 关键边界使用中文注释，减少动态效果继续生效。
- 不修改其他登记任务的滚动、终端、上下文和测试文件。
- 并行身份：`ai-streaming-20261028` / `codex-streaming-review`。

### Task 1: 验证增量树隔离并修复追加文本淡入

**Files:**

- Modify: `packages/ui/src/agent/streaming-markdown.tsx`
- Modify: `packages/ui/src/agent/streaming-markdown.css`
- Create: `desktop/src/shared/components/agent/streaming-polish.browser.test.tsx`

**Interfaces:**

- Consumes: `StreamingMarkdown`、`BlockProps`、`MarkdownBlockTree`。
- Produces: 公共 props 不变，稳定块不重复调用渲染器，追加文字独立淡入。

**Behavior:**

- 上百个完成块后追加内容仅触达尾部；段落 DOM 与历史正文保持稳定。
- 连续追加时新文字获得新动画，完成及减少动态效果时无动画；快速输出不隐藏正文。

**Stop Conditions:**

- 若需修改传输或滚动契约则先修复计划。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/agent/streaming-polish.browser.test.tsx`

Expected: Chromium/WebKit 的稳定块计数、追加动画及结束状态回归通过。

### Task 2: 管理后台入场动画生命周期

**Files:**

- Modify: `packages/ui/src/agent/motion.tsx`
- Modify: `desktop/src/shared/components/agent/streaming-polish.browser.test.tsx`

**Interfaces:**

- Consumes: `AgentMotionProvider`、`AgentEntry`、`visibilitychange`。
- Produces: 隐藏时取消已启动入场，后台新内容立即可读，恢复可见不补播。

**Behavior:**

- 共享 Provider 监听一次可见性，卸载清理监听和动画；不影响消息接收提交。
- 同批入场取消阶梯等待，初始透明度保持可读，移除仅服务阶梯计数的动画帧。

**Stop Conditions:**

- 若涉及其他任务持有文件则保留独立范围。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/agent/streaming-polish.browser.test.tsx`

Expected: 可见性切换、后台追加、恢复和卸载回归通过。

### Task 3: 记录适配审查并验证两端

**Files:**

- Modify: `docs/conversation-performance.md`
- Modify: `.superwork/plans/2026-10-28-streaming-polish.md`
- Create: `tests/e2e/app-shell-streaming-polish.spec.ts`

**Interfaces:**

- Consumes: 官方 Chat、Message、Reasoning、Trace、Message Scroller 与 Streamdown 文档。
- Produces: 已适配/本次修复/条件性后续项与真实验证证据。

**Behavior:**

- Web 宽窄屏验证真实事件追加及减少动态效果；保留代码复制、历史阅读与响应输入。
- 执行共享单元、两端类型、静态与架构、构建预算及性能验证；记录实际限制。

**Stop Conditions:**

- 环境或其他任务占用导致失败时记录原因，不覆盖他人改动。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-streaming-polish.spec.ts`

Expected: Web 多浏览器回归通过，文档与最终代码行为一致。

## 官方依据

- https://ui.shadcn.com/docs/ai-elements/radix/chat
- https://ui.shadcn.com/docs/ai-elements/radix/message
- https://ui.shadcn.com/docs/ai-elements/radix/reasoning
- https://ui.shadcn.com/docs/components/radix/trace
- https://ui.shadcn.com/docs/components/radix/message-scroller
- https://github.com/vercel/streamdown/blob/main/apps/website/content/docs/memoization.mdx

## 验证记录

Task 1 RED：桌面定向浏览器测试，Chromium/WebKit 各有两项失败：追加复用旧动画节点、static 模式仍生成动画包装。128 个稳定 Markdown 块的渲染计数基线已通过，排除最初的 options 身份假设，保留原隔离实现，不进行无证据的重构。

Task 1 GREEN：同命令 6 项通过；最终增加初次确实调用 128 个块渲染器的断言后，定向套件 10 项通过，排除空计数误判。生产正文不重构，仅修正静态动画开关与增量 span 身份，CSS 使用独立可读淡入关键帧。

Task 2 RED：同套件验证隐藏页面后暂停的真实动画仍为 paused，而非 idle；同批入场第一帧透明度为 0。GREEN：共享动效增加一次 visibilitychange 监听并在卸载时移除，隐藏时取消动画，后台不启动；删除阶梯计数与额外 RAF，180ms 从 0.4 淡入。合并定向 Markdown、Trace 入场和流式交互回归共 40 项通过。

### 当前验证证据

命令均从仓库根运行，macOS arm64；依赖、锁文件和平台传输没有变化。

| 命令                                                                                 | 结果                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test`                                                                          | 655 文件通过、6 跳过；3,737 项通过、28 跳过，exit 0。                                                                                                              |
| `pnpm --dir desktop check:web`                                                       | exit 0；含源码行数、lint、类型、654 项单元、Tauri 约束、Legacy、构建与预算。                                                                                       |
| `pnpm --dir desktop test:browser`                                                    | Chromium/WebKit 共 222 文件、838 项通过，exit 0。随后只加强渲染计数断言，相关 10 项定向回归再次通过。                                                              |
| `pnpm exec playwright test tests/e2e/app-shell-streaming-polish.spec.ts --workers=2` | 三浏览器 × 两宽度 × 两种动态效果设置，共 12 项通过。                                                                                                               |
| `pnpm test:performance`                                                              | 9 文件、17 项通过，exit 0。                                                                                                                                        |
| `pnpm exec playwright test --config playwright.performance.config.ts`                | 2 项通过；10,000 条历史分页和 100 回合 soak，记录 `.artifacts/browser-performance-report.json`。这是诊断报告，未声明前后性能改善比例，也不把它表述为强制阈值基准。 |
| `pnpm build`                                                                         | Web 类型、生产构建与 Node 构建通过；之后仅测试类型标注变更，根 `pnpm typecheck` 再次通过。                                                                         |
| `pnpm bundle:check`                                                                  | 初始 314.00 / 320.00 KiB，工作台 466.41 / 500.00 KiB，37 请求，exit 0。                                                                                            |
| `pnpm package:check`                                                                 | 909 文件打包验证通过，exit 0。                                                                                                                                     |
| `pnpm lint` / `pnpm lint:architecture` / `pnpm format:check`                         | 全部通过；架构 1,901 模块、6,164 依赖无违规。最终文档与测试格式另行检查。                                                                                          |
| `pnpm --dir desktop lint` / `pnpm --dir desktop typecheck`                           | 强化测试后再次通过。                                                                                                                                               |

`pnpm exec playwright test --workers=2` 全量 Web 浏览器回归：372 项通过，耗时 7.5 分钟，exit 0。覆盖 Chromium 及 Firefox/WebKit 的跨浏览器用例，包含新增流式宽窄屏/减少动态效果回归。

最终 `pnpm format:check`、桌面新增测试 Prettier 检查和 `git diff --check` 均通过。计划 preflight 无阻塞问题；提示的输入接口均已在源码或官方文档中确认。未提交 Git，未更新依赖，临时 RED 截图已清理。

### 收尾判断

- Simplification: no-change。移除不再需要的阶梯帧调度已经是最小实现，无新依赖和重复跨端逻辑。
- Spec: no-update。沿用已有“流式增量、动效不延迟内容、尊重减少动态效果”的规则；细节和官方适配表补充到现有索引已链接的 `docs/conversation-performance.md`，不重复创建规范。
- 未运行 Rust 编译/测试、真实 Windows/Ubuntu WebView 或签名安装包；本次没有 Rust、平台 IPC 或依赖变更，桌面运行行为由 Chromium/WebKit 共享 UI 与现代/Legacy 构建覆盖。
- 当前通过证据发生在生产代码最后修改后；后续仅强化测试的初始计数断言和整理文档/格式，不使生产构建及不相关套件失效。
