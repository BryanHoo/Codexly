# Feature Implementation Plan

**Goal:** 为 Web、移动浏览器与桌面聊天增加自适应阅读留白和随阅读位置切换的最近用户问题吸顶。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 验证入口和跨包约束。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 两端复用共享 UI。
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 低开销、移动浏览器及跨浏览器验证。
- `.superwork/spec/ui/shared/index.md` — Message Scroller、真实 DOM 和阅读锚点约束。
- `.superwork/spec/desktop/frontend/index.md` — 真实 CSS 的 Chromium/WebKit 验证。
- `.superwork/spec/web/frontend/index.md` — Web 工作流和移动端验证。

**Architecture:** 延续共享 Message Scroller；根据真实 viewport 高度设置尾部 padding，保留官方跟随与已有阅读锚点。独立轻量浮层只展示已越过顶边的最近用户消息，两行截断，点击定位原文；滚动测量通过 requestAnimationFrame 合并，只有消息身份变化时更新浮层 React 状态。

**Tech Stack:** React、TypeScript、Tailwind、ResizeObserver、Vitest browser、Playwright、pnpm。

## Global Constraints

- 不引入新依赖，不更改传输、协议和引擎行为；实现放在 packages/ui，避免两端重复。
- 不逐 token 重扫全部历史或更新 React 滚动状态，保留全部已加载 DOM 和 content-visibility。
- 底部留白为当前聊天 viewport 的 1/3，输入框显隐、视口尺寸变化时重算；手动阅读历史不能被流式输出拉回底部。
- 顶部最多一条用户问题，按滚动位置而非全局最新选择；原文越过顶边才显示，两行截断且可键盘定位原文。
- 关键逻辑使用清晰中文注释；桌面测试文件不超过 500 行。
- 并行登记：chat-reading-focus-20261028 / codex-chat-reading-focus；保留其他发布任务范围。

### Task 1: 增加自适应阅读留白

**Files:**

- Modify: `packages/ui/src/agent/conversation.tsx`
- Create: `packages/ui/src/agent/conversation-reading-space.tsx`
- Test: `desktop/src/shared/components/agent/conversation-focus.browser.test.tsx`

**Interfaces:**

- Consumes: Conversation、MessageScrollerViewport 和真实 viewport 高度。
- Produces: CSS 变量 --conversation-reading-space，供 ConversationContent 使用。

**Behavior:**

- 流式输出底端处于聊天可视区约 2/3 位置；输入框显隐导致高度变化时保持比例，空内容不额外滚出整屏。

**Stop Conditions:**

- 如需替换官方滚动状态机或引入新依赖，先修正计划。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/agent/conversation-focus.browser.test.tsx -t '阅读留白'`

Expected: Chromium / WebKit 中短内容、流式增长和两种可视高度的留白断言通过。

### Task 2: 增加随阅读位置切换的用户问题吸顶

**Files:**

- Modify: `packages/ui/src/agent/conversation.tsx`
- Modify: `packages/ui/src/agent/conversation-anchor.tsx`
- Modify: `packages/ui/src/agent/message.tsx`
- Create: `packages/ui/src/agent/conversation-sticky-prompt.tsx`
- Test: `desktop/src/shared/components/agent/conversation-focus.browser.test.tsx`

**Interfaces:**

- Consumes: 共享 Message 注册的用户节点、bubble-content，现有 follow / pause 和 viewport ref。
- Produces: data-conversation-sticky-prompt 浮层及点击原文定位。

**Behavior:**

- 原用户消息完全越过视口顶边后显示唯一两行摘要；向历史和最新滚动时切换对应最近用户消息。点击摘要暂停跟随并定位原文；后台追加、prepend 和视口变更保留阅读位置。

**Stop Conditions:**

- 用户正文与操作按钮无法可靠区分，或出现跨端契约差异时修正方案。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/agent/conversation-focus.browser.test.tsx`

Expected: 两种浏览器中单一吸顶、两行截断、历史切换、点击原文、流式阅读位置及留白全部通过。

### Task 3: 验证 Web 集成及既有滚动契约

**Files:**

- Create: `tests/e2e/app-shell-conversation-focus.spec.ts`
- Modify: `tests/e2e/app-shell-settings-projects.spec.ts`
- Modify: `desktop/src/shared/components/agent/conversation-submission.browser.test.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-submission.browser.test.tsx`

**Interfaces:**

- Consumes: 既有 E2E fake server、真实 Workbench、共享聊天组件。
- Produces: Web 宽窄屏与跨浏览器验证证据；既有固定 28px 留白断言更新为新设计。

**Behavior:**

- Web 宽窄屏覆盖留白、顶部问题与历史阅读；保留提交、prepend、滚动条暂停及回到底部行为。

**Stop Conditions:**

- 出现范围外环境或既有失败，保留证据并区分报告。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-conversation-focus.spec.ts`

Expected: Chromium、Firefox、WebKit 的宽窄屏验证通过；另运行类型、架构、相关单元测试和两端构建。

## Evidence

- 已实际查看 https://ui.shadcn.com/docs/ai-elements 及 Chat / Message Scroller；复用官方 live-edge follow、手动滚动暂停及回到底部命令。官方不提供该吸顶问题摘要，作为共享轻量增强实现。
- 环境默认 python3 为旧版，Superwork 工具使用 /opt/homebrew/bin/python3.14。
- Task 1 RED：真实浏览器测得旧留白 28px，预期 200px；Task 2 RED：吸顶节点不存在。命令 `pnpm --dir desktop test:browser src/shared/components/agent/conversation-focus.browser.test.tsx`，退出 1。
- Task 1 GREEN：`pnpm --dir desktop test:browser src/shared/components/agent/conversation-focus.browser.test.tsx -t '阅读留白'`，Chromium/WebKit 共 4 通过、2 跳过，退出 0；600/360px 视口及增长验证通过。
- Task 2 使用稳定节点注册替代流式 DOM 扫描，确保新增正文 token 不触发重扫历史。
- Task 2 GREEN：`pnpm --dir desktop test:browser src/shared/components/agent/conversation-focus.browser.test.tsx`，Chromium/WebKit 共 12 通过，退出 0；包括附件消息和用户正文更新。扩展 RED：仅附件消息未出现摘要；通过只观察当前用户节点并提取附件名称修复。
- Web 集成发现窗口恢复高度时 Chromium 有一次保留旧偏移，补充观察 viewport 的阅读锚点同步；已存在的真实 Composer 验证将 28px 固定留白断言更新为当前可视区 1/3。
- Web 输入框收起仅存在于分屏；测试据真实接口调整为窄屏高度变化以及桌面分屏输入框显隐。
- Task 3 GREEN：根目录 `pnpm exec playwright test tests/e2e/app-shell-conversation-focus.spec.ts --workers=2`，三个浏览器 × 两种宽度共 6 通过，退出 0。桌面 `pnpm --dir desktop test:browser src/shared/components/agent/conversation-focus.browser.test.tsx src/shared/components/agent/conversation.browser.test.tsx src/shared/components/agent/conversation-submission.browser.test.tsx src/features/workbench/components/workbench-submission.browser.test.tsx`，52 通过，退出 0。

## Final Verification

- 简化审查：`no-change`。节点注册、单个当前用户节点观察器及零高 sticky 分工明确；保留官方滚动命令和已有布局补偿，未引入新的滚动状态机、依赖或逐 token React 状态。
- Spec：`update` `.superwork/spec/ui/shared/index.md`。分类器建议 no-update，但动态留白、历史位置吸顶、浮层原生滚动和测试定位属于后续实现必须保持的长期交互约束，因此补入现有共享 UI 索引。索引自身可达，相关实现及验证入口均存在。
- 复用当前最终代码后的有效证据：Web 专项 6 通过、桌面滚动专项 52 通过；之后只修改既有 E2E 的正文定位和文档，不改变生产逻辑。
- 新执行 `pnpm --dir desktop test:browser`：216 文件、816 测试全部通过，退出 0，完整覆盖 Chromium/WebKit。
- 新执行 `pnpm test:performance`：9 文件、17 测试全部通过，退出 0。
- 新执行 `pnpm build`、`pnpm --dir desktop build`、`pnpm --dir desktop build:legacy`：均退出 0；包含两端类型检查以及 Web、Node、桌面现代与 Legacy 构建。未改 Rust 或平台原生命令，不运行跨系统原生构建。
- 新执行 `pnpm bundle:check`：通过；initial 314.01 / 320 KiB、workbench ready 465.91 / 500 KiB。`pnpm --dir desktop performance:budget` 和 `pnpm package:check` 均通过，退出 0。
- 新执行根 `pnpm lint`、桌面 `pnpm --dir desktop lint`、根/桌面 typecheck：通过，退出 0。`pnpm lint:architecture` 退出 0，保留已有 `packages/server/src/sqlite-journal.d.ts` orphan 警告。
- `pnpm format:check`：通过，退出 0；Superwork 生成的当前登记 JSON 单独按 Prettier 格式化，未更改其他登记。

## Remaining Baseline Failures

- 根 `pnpm test`：3734 通过、3 失败、28 跳过。失败分别为 `task-timeline-basics.test.tsx` 的原生 title 断言、`task-timeline-plans.test.tsx` 的旧 trace-collapsible 断言、Claude extensions CLI 以 143 退出。日志 `/tmp/codexly-chat-unit.log`。
- 已在临时目录从 Git HEAD 提取完整 `packages/ui`，通过临时 Vitest alias 使用修改前共享组件重复前两个测试：同样 2 失败、17 通过，排除本次 UI 修改引入。日志 `/tmp/codexly-chat-head-baseline.log`。第一次临时验证缺失 tsconfig 依赖不作为基线证据；补全后实际执行测试的结果才有效。
- 桌面 `pnpm --dir desktop test:run`：653 通过、1 失败，`reasoning-item.test.ts` 期待 tool 为单项，实际为 operation_group；单独复跑仍失败，该纯分组逻辑未被本次修改。`pnpm --dir desktop check:web` 因同一失败提前结束，其余需要的类型、浏览器、现代/Legacy 构建和预算已单独执行。日志 `/tmp/codexly-chat-desktop-unit.log`、`/tmp/codexly-chat-desktop-check.log`。
- 全量 `pnpm exec playwright test --workers=2`：327 通过、12 失败、21 因 serial 前置失败未运行，退出 1。其中一项是本次新增摘要导致旧文本选择器同时匹配摘要与原文，已修正 `app-shell-settings-projects.spec.ts` 为 log 内精确原文定位；补跑该项 1 通过，退出 0。
- 剩余 11 个 E2E 失败涉及旧 summary/article/log 选择器、侧栏计划状态计数、移动 Composer 高度和上下文弹窗、终端历史跟随；本次生产代码没有修改这些对应入口。全量日志 `/tmp/codexly-chat-e2e.log`，不得表述为全量验证通过。
- 本次实现、专项回归、桌面完整浏览器套件与构建通过；全局验收保留上述失败。按 Superwork 规则保留当前任务登记，记录为 paused，便于后续明确处理基线后继续验收；无需用户批准本次代码更改。

## Follow-up: 吸顶悬停底色与阴影

- 用户反馈：悬停时底色透明，吸顶层次不够清楚；本轮仅修复共享组件样式并增强现有真实浏览器回归。
- 根因：outline Button 的 `hover:bg-control-hover` 使用透明 ink，覆盖原本不透明的 `bg-panel`。暗色实测从 `rgb(24, 24, 24)` 变成 `rgba(255, 255, 255, 0.1)`。
- 修复：吸顶入口明确使用 `hover:bg-panel`，保持常态与悬停底色一致；将 `shadow-sm` 改为现有柔和双层 `shadow-floating`，不新增主题变量或更改通用按钮。Web、移动浏览器及桌面自动共用。
- RED：`pnpm exec playwright test tests/e2e/app-shell-conversation-focus.spec.ts --project=chromium --workers=2 --output=/tmp/codexly-chat-hover-red`，暗色悬停背景断言失败，退出 1。回归随后等待实际 CSS 过渡结束，避免浅色主题在过渡开始前读取旧颜色而误通过。
- GREEN：`pnpm exec playwright test tests/e2e/app-shell-conversation-focus.spec.ts --workers=2 --output=/tmp/codexly-chat-hover-green`，明暗主题、宽窄屏以及 Chromium / Firefox / WebKit 共 6 通过，退出 0。已人工查看明暗主题悬停截图，正文不透出，阴影保持柔和。
- 新执行 `pnpm --dir desktop test:browser src/shared/components/agent/conversation-focus.browser.test.tsx`，12 通过，退出 0。
- 新执行 `pnpm build`、`pnpm bundle:check`：通过，退出 0；initial 314.01 / 320 KiB、workbench ready 465.93 / 500 KiB。
- 修改文件的 Oxlint、Prettier 与 `git diff --check` 通过。无重构，简化结果 `no-change`；本轮仅恢复原有面板不透明语义及使用已有阴影，Spec 判定 `no-update`。
- 本轮有限视觉修复所需验证全部通过，释放自身登记；上方首轮全量套件基线失败记录保留，不将本轮专项通过表述为全量验收通过。
