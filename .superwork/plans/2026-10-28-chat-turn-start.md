# Feature Implementation Plan

**Goal:** 用户消息顶部被裁切一点即吸顶；发送新消息后旧对话滚出屏幕，新问题靠顶部、回复从下方展开。

**Suggested Spec Reads:**

- `.superwork/spec/ui/shared/index.md` — 共享 Message Scroller、无逐 token React 状态、两端布局回归。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 共用 UI，平台能力不变。
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 性能与跨浏览器要求。
- `.superwork/spec/desktop/frontend/index.md` — 真实 CSS、500 行限制。
- `.superwork/spec/web/frontend/index.md` — 窄屏和工作流验证。

**Architecture:** 使用现有用户节点注册与提交信号。顶部裁切按消息 top 判断；发送时动态补齐消息内容与视口之间的尾部空间，让新问题靠顶部，输出增长消耗空间并回到 1/3 基础留白；跟随及历史阅读锚点继续使用已有共享逻辑和官方命令。

**Tech Stack:** React、TypeScript、ResizeObserver、Tailwind、Vitest browser、Playwright、pnpm。

## Global Constraints

- 所有行为在 packages/ui 共享，不改平台传输或业务提交顺序。
- 顶部裁切即吸顶，最多一条、两行省略，保持不透明 hover 与柔和阴影。
- 新提交只锚定新用户消息，不能把旧问题当新问题；pending 到正式用户消息接管时保持位置。
- 短回复维持问题靠顶；长回复恢复基础 1/3 留白；手动历史阅读不被后续输出抢走。
- 不逐 token 扫描全部历史或更新 React 滚动状态；关键逻辑中文注释。
- 当前任务登记 chat-turn-start-20261028 / codex-chat-turn-start，保留既有未提交改动。

### Task 1: 提前触发用户问题吸顶

**Files:**

- Modify: `packages/ui/src/agent/conversation-sticky-prompt.tsx`
- Create: `desktop/src/shared/components/agent/conversation-turn-start.browser.test.tsx`

**Interfaces:**

- Consumes: 现有注册用户节点及 viewport 顶边。
- Produces: 顶部裁切即显示当前问题的唯一摘要。

**Behavior:**

- 用户消息只裁掉 1px 即吸顶，回到未裁切位置隐藏，长消息不必等待整条离屏。

**Stop Conditions:**

- 出现滚动时全量重渲染或需要引入新依赖则修正方案。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/agent/conversation-turn-start.browser.test.tsx -t '裁切'`

Expected: Chromium / WebKit 的 1px 裁切、恢复和唯一摘要断言通过。

### Task 2: 发送后从顶部展开新一轮

**Files:**

- Modify: `packages/ui/src/agent/conversation.tsx`
- Modify: `packages/ui/src/agent/conversation-reading-space.tsx`
- Modify: `packages/ui/src/agent/conversation-sticky-prompt.tsx`
- Test: `desktop/src/shared/components/agent/conversation-turn-start.browser.test.tsx`
- Test: `desktop/src/shared/components/agent/conversation-focus.browser.test.tsx`
- Test: `desktop/src/features/workbench/components/workbench-submission.browser.test.tsx`
- Test: `tests/e2e/app-shell-conversation-focus.spec.ts`

**Interfaces:**

- Consumes: scrollToBottomSignal、用户消息注册、现有 follow / pause 和 viewport。
- Produces: 动态 --conversation-reading-space；新用户消息距离顶部约 12px，历史位于可视区上方。

**Behavior:**

- 同步/延迟 pending、正式消息接管、短回复、连续发送、长回复、视口变化和手动翻阅历史稳定。
- 真实 Composer 新提交后新问题靠顶，流式回复依次向下展开。

**Stop Conditions:**

- 平台消息顺序差异或不明确的身份切换需先查明，不引入计时猜测或后台轮询。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/agent/conversation-turn-start.browser.test.tsx src/features/workbench/components/workbench-submission.browser.test.tsx`

Expected: 两浏览器验证新问题靠顶及 pending 接管稳定；补充 Web 三浏览器、既有滚动用例、类型与构建。

## Evidence

- fast-context 当前工具目录未提供，按现有已知源码位置结合 rg 追踪；未调用不可用工具。
- 已确认两端 onSubmissionStarted 在同一回调设置 pendingPrompt 并递增 scrollToBottomSignal，可在共享层接收稳定的主动提交边界。
- RED：新增真实 CSS 浏览器测试在 Chromium/WebKit 共 6 失败；新问题发送后距顶部约 354px、延迟 pending 约 282px，均不是预期 12px；原实现也会在新问题已进入顶部时残留旧摘要。
- Task 1 GREEN：顶部裁切条件改为用户节点 top 越过 viewport top 即显示；顶部留白内的新问题替代旧摘要，回看原文保留 12px 间距以避免小数像素触发再次吸顶。
- 共享实现：ConversationReadingSpace 读取注册节点与主动提交信号，等待新用户节点，pending 接管跟随最新节点；测量新问题到内容末行的高度，仅调整尾部 CSS 留白，最低为视口 1/3，不引入逐帧 React 状态。
- `pnpm --dir desktop test:browser src/shared/components/agent/conversation-turn-start.browser.test.tsx src/shared/components/agent/conversation-focus.browser.test.tsx src/shared/components/agent/conversation.browser.test.tsx src/shared/components/agent/conversation-submission.browser.test.tsx src/features/workbench/components/workbench-submission.browser.test.tsx`：10 文件、58 测试通过，退出 0。真实 Composer 覆盖四种响应顺序、1280/1920px，新增断言 pending 问题距顶部 12px 且旧聊天完全离屏。
- `pnpm exec playwright test tests/e2e/app-shell-conversation-focus.spec.ts --workers=2 --output=/tmp/codexly-turn-start-e2e`：三浏览器 × 宽窄屏共 6 通过，退出 0；包含 1px 裁切、明暗主题悬停底色、真实点击发送与分屏输入框显隐。仅随后补充 Promise 回调的显式 void 类型，运行时行为相同。
- 已人工查看宽窄屏新一轮截图，旧对话完全离屏，用户气泡靠顶、处理提示在其下方，输入框及历史回看仍保留。
- 共享 UI 单元测试 12 文件、72 测试通过；Web/Node 与桌面现代构建均通过。架构检查退出 0，保留既有 sqlite-journal.d.ts orphan 警告。

## Final Verification

- 新执行完整桌面 `pnpm --dir desktop test:browser`：218 文件、822 测试通过，退出 0，包含 Chromium/WebKit、207 回合历史性能和全部原有滚动验证。
- 新执行 `pnpm test:performance`：9 文件、17 测试通过。Web 预算 initial 314.01 / 320 KiB、workbench ready 466.19 / 500 KiB；桌面现代包体预算通过，随后 Legacy 构建通过，均退出 0。
- `pnpm lint`、`pnpm --dir desktop lint`、`pnpm typecheck`、两端现代构建及桌面 Legacy 构建通过。只改共享 React 交互，不改 Rust、协议、传输或引擎，未重新运行原生跨系统验证。
- 简化审查 `no-change`：复用原有提交信号、用户节点注册与官方滚动命令，新增空间计算只读取新问题和末行；不增加轮询、传输或逐 token React 状态。
- Spec 判定 `update`：在已有 `.superwork/spec/ui/shared/index.md` 修订原先“完全离屏才吸顶”的旧规则，并记录新提交靠顶、动态留白、pending 接管和 1px 边界验证入口；索引可达，相关源码与测试存在。
- 上一轮记录中的范围外全量单元/E2E 基线失败保持记录，本轮针对新交互运行以上专项、完整桌面浏览器、共享单元与构建；不将局部通过表述为旧全量套件已修复。现有历史测试主体和本轮用户新增要求分别记录在两个计划中。
- 当前任务身份 `chat-turn-start-20261028` / `codex-chat-turn-start`；以上验证均在本轮生产代码最后编辑后执行，后续仅修改类型注解、规范和证据记录，不改变运行时行为。

## Follow-up: 将基础留白缩小为四分之一

- 用户要求把底部留白从 1/3 缩小为 1/4；修改共享 ConversationReadingSpace 的基础值与中文注释，两端共用。同步已有用例的实际像素期望和共享 UI 规范；主动发送靠顶所需的额外空间继续按内容高度消耗。
- RED：`pnpm --dir desktop test:browser src/shared/components/agent/conversation-focus.browser.test.tsx -t '阅读留白随'`，两浏览器均测得旧值 200px，预期新值 150px，退出 1。
- GREEN：`pnpm --dir desktop test:browser src/shared/components/agent/conversation-focus.browser.test.tsx src/shared/components/agent/conversation-turn-start.browser.test.tsx src/shared/components/agent/conversation-submission.browser.test.tsx src/shared/components/agent/conversation.browser.test.tsx src/features/workbench/components/workbench-submission.browser.test.tsx`，10 文件、58 测试通过，退出 0；600/360/480px 视口留白分别为 150/90/120px，新消息靠顶和接管验证继续通过。
- `pnpm exec playwright test tests/e2e/app-shell-conversation-focus.spec.ts --workers=2 --output=/tmp/codexly-quarter-e2e`：三浏览器、明暗主题、宽窄屏共 6 通过，退出 0。
- `pnpm build`、相关文件 Oxlint/Prettier、`git diff --check`、Web 包体预算均通过，退出 0。预算 initial 314.02 / 320 KiB、workbench ready 466.20 / 500 KiB。
- 简化结果 `no-change`，仅调整共享比例；Spec 判定 `update`，现行规范记录 1/4，前文 1/3 为历史验证证据。本轮无协议、传输、Rust 或依赖变更，不重复运行与比例无关的完整套件。
- 本轮登记 `chat-quarter-space-20261028` / `codex-chat-quarter-space`，验证均在生产修改后执行；最后仅追加记录和清理本轮失败截图。
