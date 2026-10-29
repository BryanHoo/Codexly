# Feature Implementation Plan

**Goal:** 参考官方 Subagent 示例，在 Web、移动浏览器与桌面时间线共用结构化子代理详情。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 全局性能与跨端约束。
- `.superwork/spec/ui/shared/index.md` — Trace、操作列表 Portal 与懒挂载契约。
- `.superwork/spec/web/frontend/index.md` — Web 与移动浏览器。
- `.superwork/spec/desktop/frontend/index.md` — 桌面浏览器及 500 行限制。

**Architecture:** 共享 Subagent 组件复用现有 Tool 的 Trace/Portal 入口，内容使用嵌套 Trace；两端注入现有 TimelineItemContent 渲染器，按需展示 Claude 内嵌回合，不新增请求或轮询。Codex 仅展示真实返回的代理状态和结果，保留独立子线程查看入口。

**Tech Stack:** TypeScript、React、Radix、pnpm、Vitest、Playwright。

## Global Constraints

- 共享 UI 不依赖应用或平台传输；不引入 AI SDK Runtime。
- 状态图标和可访问名称表达运行状态，保持现有本地化标题。
- 操作列表只在点击时打开 Portal；关闭后卸载详情，不增加逐 token 全局扫描。
- 复用现有 Code Block；元信息使用主题样式标签；长文本不能撑开窄屏。
- 公告身份：subagent-trace-20261029 / codex-subagent-trace-20261029。
- 官方参考：https://ui.shadcn.com/docs/ai-elements/base/subagent.md 。

### Task 1: 实现共享结构化子代理详情并接入双端

**Files:**

- Create: `packages/ui/src/agent/subagent.tsx`
- Test: `apps/web/src/shared/components/agent/subagent.test.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-status.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-status.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-items.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-items.tsx`
- Test: `desktop/src/shared/components/agent/subagent.browser.test.tsx`
- Test: `tests/e2e/app-shell-subagent-trace.spec.ts`

**Interfaces:**

- Consumes: AgentItem、SubagentOperation、getEmbeddedSubagentTurn、Tool/ToolHeader/ToolContent、AgentLocaleProvider。
- Produces: Subagent（共享展示）、renderItem 回调（按需使用两端 TimelineItemContent）。

**Behavior:**

- 默认关闭时不读取/渲染执行详情；打开后显示任务、模型/推理强度、代理状态与结果。
- 内嵌回合按嵌套 Trace 展示真实命令/工具/回复，首批最多 50 条，可加载更早记录，避免重复序列化整个回合。
- 输入输出缺失或非结构化时保留原始内容回退；失败结果明确表达；保留耗时与现有独立详情弹窗。
- 浏览器验证宽窄屏、键盘、焦点恢复、流式刷新、关闭卸载与内嵌记录分页。

**Stop Conditions:**

- 必须修改协议或传输才能展示官方结构时，先调整方案；不得编造嵌套记录。
- 与其他公告产生文件交叉时暂停交叉部分。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/components/agent/subagent.test.tsx`

Expected: 结构化内容、状态与懒挂载测试全部通过，双端类型与交互验证通过。

## Verification

根共享 UI 单元测试、两端类型检查、lint/架构检查、Web 与桌面相关浏览器验证、两端生产构建与预算。不涉及 Rust 或协议变更。

## 实现与交接

- 新增 `packages/ui/src/agent/subagent.tsx`，复用 Tool 已有的 Trace / 独立详情 Portal；任务元数据、代理结果、分页嵌套 Trace 均由两端共用。
- 两端只注入时间线渲染器、平台上下文与翻译。桌面对内嵌思考只映射公开 `summary` 到本端 `text`，不会显示原始 `content`。
- Claude 的内嵌回合直接展示，Codex 真实返回的代理结果结构化展示，完整独立线程在 Task 3 中统一入口。不新增请求、轮询、依赖或协议字段。
- 折叠期间不读取详情；打开后只渲染最近 50 条，可按 50 条加载更早记录。关闭后由既有 Presence / Dialog 生命周期卸载重型内容并恢复焦点。

## 验证证据

工作目录为仓库根目录。使用项目固定的 pnpm 11.22.0、现有 Node 24.19.0 和已安装依赖；命令统一使用环境前缀 `pnpm_config_verify_deps_before_run=false PATH=/tmp/codexly-pnpm-bin:$PATH`，防止 pnpm 11 的默认自动安装因未变更的依赖状态触发不必要的联网安装。无依赖或锁文件修改。

- RED：新增共享组件测试后运行 `node node_modules/vitest/vitest.mjs run apps/web/src/shared/components/agent/subagent.test.tsx`，因预期的共享 Subagent 尚不存在而失败；随后实现组件，3 项行为测试通过。此前测试临时放在 UI 包时缺少 react-dom 的失败属于测试位置问题，已移至有 renderer 依赖的 Web 测试目录，不作为 RED 证据。
- GREEN / 最终单元回归：`pnpm exec vitest run packages/ui/src apps/web/src/shared/components/agent/subagent.test.tsx apps/web/src/features/workbench/components/subagent.test.ts apps/web/src/features/workbench/components/task-timeline*.test.tsx`，28 文件、193 测试通过，退出 0；覆盖关闭懒挂载、50 条窗口、结构化状态/结果、未知输出回退及时间线既有行为。
- 桌面单元：`pnpm --dir desktop test:run src/features/workbench/components/subagent.test.ts src/features/workbench/components/task-timeline-timing.test.ts`，2 文件、11 测试通过，退出 0。后续只有显式类型契约调整，无业务逻辑变化，证据复用有效。
- 桌面交互：`pnpm --dir desktop test:browser src/shared/components/agent/subagent.browser.test.tsx`，Chromium / WebKit 共 6 测试通过，退出 0；覆盖 390/1280px、分页、已打开详情的流式刷新、关闭卸载、焦点恢复及桌面公开摘要投影。最后一次编辑仅 Prettier 排版，没有修改断言或运行行为。
- Web 交互：最终 `pnpm --filter @codexly/web build` 后运行 `pnpm exec playwright test tests/e2e/app-shell-subagent-trace.spec.ts --workers=2`，Chromium / Firefox / WebKit 共 12 测试通过，退出 0；覆盖 390/1280px、独立线程结果、嵌套工具结果、详情按需挂载及焦点恢复。
- `pnpm typecheck`、`pnpm --dir desktop typecheck`、`pnpm lint`、`pnpm --dir desktop lint`、`pnpm lint:architecture`、`pnpm --dir desktop source:lines` 均通过，退出 0。架构检查发现的类型反向引用已替换为显式渲染器契约，最终 1903 模块无依赖违规。
- 对全部新增/修改的非桌面 TS/TSX 运行 `pnpm exec prettier --check`，通过；桌面新测试单独格式化。`git diff --check` 通过。
- `pnpm test:performance`：9 文件、17 测试通过，退出 0。
- `pnpm --filter @codexly/web build`、`pnpm --dir desktop build`、`pnpm --dir desktop build:legacy` 全部通过，退出 0。现代桌面构建后仅类型导入、格式与测试变更，产物行为未变，复用证据有效。
- `pnpm bundle:check`、`pnpm --dir desktop performance:budget` 均通过，退出 0；Web 初始 314.01/320 KiB、工作台 467.05/500 KiB。最终 Web 构建后再次校验预算通过。

## 最终审查

- simplification：changed。复用已有 Tool/Trace/Portal，原始输入单独按需展开；以显式渲染器契约消除组件之间的类型循环引用，不增加独立生命周期或全局订阅。
- spec：no-update。分类器建议更新两端索引，但本次组合严格沿用已有共享 UI、公开思考摘要、增量渲染与操作组 Portal 契约，没有新增项目级规范；具体实现与验证入口保存在本计划，避免重复已有规则，也不改写其他任务声明的 UI 规范。
- 验证边界：本次执行相关单元、浏览器、性能和构建门槛；未运行无关的 Rust、协议、发布与全量应用工作流检查。未生成 macOS/Windows/Ubuntu 原生安装包。

### Task 2: 修复提示词重复并完善详情阅读滚动

**Files:**

- Modify: `packages/ui/src/agent/subagent.tsx`
- Modify: `packages/ui/src/agent/tool.tsx`
- Modify: `packages/ui/src/agent/tool-details.tsx`
- Modify: `packages/ui/src/agent/agent-ui.css`
- Test: `apps/web/src/shared/components/agent/subagent.test.tsx`
- Test: `desktop/src/shared/components/agent/subagent.browser.test.tsx`
- Test: `tests/e2e/app-shell-subagent-trace.spec.ts`
- Modify: `.superwork/spec/web/frontend/index.md`
- Modify: `.superwork/spec/desktop/frontend/index.md`

**Interfaces:**

- Consumes: SubagentProps.prompt、Claude 子代理初始消息及 rendering-omitted 标记、ToolContent / ToolBody / ToolDetailsContent。
- Produces: followOutput 可选展示属性、共用正文滚动容器；不改变协议与传输。

**Behavior:**

- 根因：顶部任务提示词和内嵌回合的初始用户消息重复展示，省略标记可能位于初始消息之前；原弹窗仅限制到视口减 32px，正文没有子代理输出跟随逻辑。
- 只检查第一个或省略标记后的第一个条目，删除内容完全一致且无附件/技能的初始用户消息副本；后续追问保留，不扫描整个历史。
- 详情弹窗最高 `min(80dvh, 48rem)`，固定标题、唯一正文滚动区。Subagent 的 ToolContent 启用 followOutput，普通工具保持现有行为。
- ResizeObserver 观察正文与视口，直接更新内部 scrollTop；初次打开保留底部并将焦点交给正文，上滚、触控、拖动滚动条或选择记录时暂停，手动回到底部恢复。卸载清理观察器，不引入逐 token 滚动状态或全局监听。

**Stop Conditions:**

- 必须删除后续消息或改变真实协议数据才能去重时，停止并重新确认边界。
- 与其他登记产生文件交叉时暂停交叉修改。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/components/agent/subagent.test.tsx packages/ui/src`

Expected: 同文初始消息不重复，省略标记场景保留后续消息，浏览器跟随/暂停/恢复及高度验证通过。

## Task 2 验证与审查

- 公告身份：subagent-scroll-fix-20261029 / codex-subagent-scroll-fix-20261029；复用上述命令环境和 pnpm 版本。
- RED：新增去重用例实际收到 `initial` 副本而失败；新增 Chromium / WebKit 宽窄屏高度/跟随测试在原实现中实际弹窗高度 768px，超出 641px 断言而失败。均为预期行为失败。
- GREEN：根共享 UI 与 Subagent 单元回归 13 文件、77 测试通过（退出 0），包含省略标记前缀、后续同文追问与不同消息保留。
- `pnpm --dir desktop test:browser src/shared/components/agent/subagent.browser.test.tsx src/features/workbench/components/task-timeline-operation-groups.browser.test.tsx`：Chromium / WebKit 共 28 测试通过（退出 0），覆盖首次底部、增长跟随、上滚保留位置、回底恢复、关闭卸载以及原终端/工具滚动兼容性。
- 最终 Web 构建后，`pnpm exec playwright test tests/e2e/app-shell-subagent-trace.spec.ts tests/e2e/app-shell-trace-motion.spec.ts --workers=2`：三浏览器 24 测试通过（退出 0），覆盖省略标记后的真实提示词去重、最大高度、宽窄屏和既有 Trace 过程交互。
- 根和桌面 typecheck、lint、架构检查、桌面 500 行限制、受影响源文件 Prettier 校验和 `git diff --check` 均通过（退出 0）。
- 最终 Web / 桌面生产构建及两端包体预算通过（退出 0），Web 工作台 467.36/500 KiB，初始 314.01/320 KiB；无新增依赖。
- 最终 `pnpm --dir desktop build:legacy` 通过（退出 0）；`pnpm test:performance` 9 文件、17 测试通过（退出 0）。计划 preflight 与两端规范新增测试路径检查通过。
- simplification：no-change。复用操作详情弹窗生命周期，滚动状态仅为局部 ref；去重固定位置判断不改变数据或增加全历史扫描。
- spec：update。两端前端索引新增提示词去重、高度与用户可中断跟随的长期交互契约和测试入口，保留其他任务负责的共享 UI 索引。
- 验证边界仍为前端；不涉及 Rust、协议与原生安装包。

### Task 3: 统一右栏子代理弹窗入口

**Files:**

- Modify: `packages/ui/src/agent/tool-details.tsx`
- Modify: `packages/ui/src/agent/subagent.tsx`
- Modify: `apps/web/src/features/workbench/components/subagent-output-dialog.tsx`
- Modify: `desktop/src/features/workbench/components/subagent-output-dialog.tsx`
- Test: `apps/web/src/features/workbench/components/subagent-output-dialog.test.tsx`
- Test: `desktop/src/shared/components/agent/subagent.browser.test.tsx`
- Test: `desktop/src/features/workbench/components/subagent-output-dialog.browser.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-sections.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-inspector-sections.tsx`
- Test: `tests/e2e/app-shell-subagent-trace.spec.ts`
- Modify: `.superwork/spec/web/frontend/index.md`
- Modify: `.superwork/spec/desktop/frontend/index.md`

**Interfaces:**

- Consumes: useTaskRuntime、目标条目 Store、SubagentSelection、StoredTimelineItemContent、TurnProcessHistory、SubagentContent。
- Produces: OperationDetailsDialogContent（共用弹窗外观/关闭/正文滚动）、公开 SubagentContent / SubagentThreadContent / SubagentExecutionTrace（内嵌与独立来源共用结构化详情及分页）。

**Behavior:**

- 右栏和时间线使用相同弹窗组件、高度上限、关闭与焦点恢复；内嵌子代理使用相同任务元数据、提示词去重、分页及可暂停跟随。
- 内嵌代理只订阅目标父条目 Store，不新增子任务请求或轮询。关闭释放订阅，切换目标重置视图身份。
- 按用户追加要求，独立子线程也使用 SubagentContent / SubagentExecutionTrace，不渲染 TaskTimeline；保留条目 Store 增量更新及回合/过程历史读取，禁止增加嵌套滚动区。
- 桌面思考仍只显示公开 summary；保留加载与错误反馈。

**Stop Conditions:**

- 共用弹窗必须删除独立子线程历史能力时停止并调整方案。
- 修改范围与其他任务交叉时暂停交叉部分。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/subagent-output-dialog.test.tsx`

Expected: 右栏共用弹窗、内嵌详情与独立线程路径的回归测试通过，跨端类型与浏览器验证通过。

## Task 3 最终实现与验证

- 公告身份：subagent-context-dialog-20261029 / codex-subagent-context-dialog-20261029。沿用前述 pnpm 11.22.0 环境前缀，所有命令均从仓库根目录运行。
- 时间线与右栏共用 OperationDetailsDialogContent；右栏两种来源共用 SubagentContent / SubagentExecutionTrace。独立线程使用 SubagentThreadContent 订阅结构和元数据，条目正文仍由两端原有 StoredTimelineItemContent 消费目标 Store 的增量、命令缓冲与 Markdown 快照，不重建完整历史。
- 初始用户任务提升到详情顶部并去重，即使最近 50 条窗口不含首条记录也能保留任务。无附件/技能时才提升，其他消息保留原样。首回合仅剩任务摘要但有 processCursor 时单独保留过程历史入口；历史回合和过程继续按需读取。
- Safari 入口按钮先显式聚焦，外置弹窗捕获实际打开入口，关闭后恢复；切换目标通过稳定任务/条目 key 重置分页、订阅与跟随身份。
- RED：两种右栏路径在旧实现中都未使用 agent-operation-detail-dialog 而失败；新增“只剩初始任务但有过程游标”用例确认旧投影会丢失历史入口，修复后通过。SSR 的大窗口 fixture 使用初始化时即含全部记录的新 Store，避免 Zustand getInitialState 与测试后 hydrate 的状态不一致；这属于 fixture 修正。
- GREEN：`pnpm exec vitest run apps/web/src/features/workbench/components/subagent-output-dialog.test.tsx apps/web/src/shared/components/agent/subagent.test.tsx packages/ui/src`，14 文件、81 测试通过（退出 0）；覆盖两来源、去重、50 条窗口、不重建整个快照和摘要历史入口。额外运行右栏现有 `workbench-inspector-sources.test.tsx`，11 测试通过。
- `pnpm --dir desktop test:browser src/features/workbench/components/subagent-output-dialog.browser.test.tsx src/shared/components/agent/subagent.browser.test.tsx src/features/workbench/components/task-timeline-operation-groups.browser.test.tsx`：Chromium / WebKit 共 32 测试通过（退出 0）；以真实桌面 Store 验证两来源增量正文跟随、上滚暂停、回底恢复、关闭焦点以及既有工具详情兼容性。
- 最终 Web 构建后的 `pnpm exec playwright test tests/e2e/app-shell-subagent-trace.spec.ts --workers=2`：三浏览器共 12 测试通过（退出 0），每项包含时间线和右栏两入口、宽窄屏、高度、去重、统一 Trace 结构、关闭焦点；内嵌模式无独立子任务读取，独立模式读取自身运行时。
- 根/桌面 typecheck、lint、架构检查和桌面 500 行限制均通过（退出 0）；最终架构检查 1904 模块无违规。受影响 Web/共享源文件及测试的 Prettier 校验、git diff --check 通过。
- `pnpm --dir desktop test:run src/features/workbench/components/subagent.test.ts src/features/workbench/components/task-timeline-timing.test.ts`：11 测试通过（退出 0）。
- `pnpm --filter @codexly/web build`、`pnpm --dir desktop build`、`pnpm --dir desktop build:legacy`、两端包体预算均通过（退出 0）。Web 初始 314.01/320 KiB，工作台 468.10/500 KiB，无新增依赖。
- `pnpm test:performance`：9 文件、17 测试通过（退出 0）。
- simplification：changed。将两端原有独立外观及执行列表收敛到共享弹窗、内容、分页和 Store 结构订阅；平台仅保留协议字段适配、图片能力及原生/HTTP 历史加载回调。
- spec：update。两端前端索引补充双入口、双来源统一行为，保留历史入口和 Safari 聚焦契约；新增测试文件路径已核对存在。共享 UI 索引仍由原登记任务负责，未改写。
- 限制：未运行无关 Rust、发布/安装包及全量应用工作流门槛；本次未改变协议、引擎或传输。
