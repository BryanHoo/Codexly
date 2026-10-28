# Feature Implementation Plan

**Goal:** 工具、命令、文件编辑从第一条起进入折叠容器，展开最多显示五行，新增活动仅内部跟随。

**Suggested Spec Reads:**

- `.superwork/spec/ui/shared/index.md` — Trace、动画、滚动与共享组件边界。
- `.superwork/spec/web/frontend/index.md` — Web 与移动浏览器。
- `.superwork/spec/desktop/frontend/index.md` — 桌面与真实 CSS 浏览器验证。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 两端共用 UI。
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 性能及跨平台验证。

**Architecture:** 两端保留 store 订阅和摘要生成，共享 OperationGroup 管理 Trace 折叠、五行滚动窗口和暂停跟随。运行时默认展开，后续正文自动收起，手动选择优先。

**Tech Stack:** React、TypeScript、Radix Trace、CSS、Vitest、Playwright。

## Global Constraints

- 共用组件不导入应用；不新增依赖、不更改协议或传输。
- 使用中文注释；不逐帧更新 React，不逐 token 重建时间线；遵循减少动态效果偏好。
- 保留后续回复自动收起、失败计数、详情按需挂载和完成回合执行过程。
- 协作登记：operation-viewport-20261028 / codex-operation-viewport。

### Task 1: 统一活动容器与五行内部跟随

**Files:**

- Create: `packages/ui/src/agent/operation-group.tsx`
- Modify: `packages/ui/src/agent/agent-ui.css`
- Modify: `apps/web/src/features/workbench/components/task-timeline-operation-groups.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store-operation-groups.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-operation-groups.test.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-operation-groups.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-store-operation-groups.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-operation-groups.test.ts`
- Modify: `desktop/src/features/workbench/components/task-timeline-operation-groups.browser.test.tsx`
- Modify: `tests/e2e/app-shell-trace-motion.spec.ts`
- Modify: `.superwork/spec/ui/shared/index.md`

**Interfaces:**

- Consumes: `TimelineOperationGroupDisclosure` 的 children、itemKeys、后续正文与运行状态，以及两端已有摘要翻译。
- Produces: 共享 `OperationGroup`；所有单项归组；固定五行内部滚动、暂停跟随和回到最新按钮。

**Behavior:**

- 第一条起显示摘要入口，运行默认展开且可手动收起，后续正文可自动折叠。
- 展开区最多五行摘要高度；旧记录可滚动，新增不推动外层页面；详情限制曾在初版应用，后续修复以 Task 2 为准。
- 阅读旧记录或详情时不抢滚动；新记录有返回最新入口；键盘、窄屏和减少动态效果可用。

**Stop Conditions:**

- 若现有滚动器无法隔离内部活动窗口，先修订此计划。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/features/workbench/components/task-timeline-operation-groups.browser.test.tsx`

Expected: Chromium 与 WebKit 中五行限制、内外滚动隔离、手动折叠及回到最新通过；两端类型、相关单元测试与 Web E2E 通过。

## 最终证据与交接

- 2026-10-28，macOS 本工作区；依赖及配置未修改。Superwork route: superwork-writing-plans，清晰的共享 UI 与两端接入；按 executing-plans / TDD / check 连续执行。
- RED：`pnpm --dir desktop test:browser src/features/workbench/components/task-timeline-operation-groups.browser.test.tsx`，Chromium / WebKit 宽窄屏因首条活动没有 data-operation-group 失败；补充平滑滚动证明后因没有原生 smooth 调用失败。
- GREEN：同一浏览器用例在最终代码后通过。加上 trace-entry、trace-polish、task-timeline-completed-spacing 浏览器文件，合计 8 文件、26 测试通过。
- `pnpm exec playwright test tests/e2e/app-shell-trace-motion.spec.ts --workers 2`：最终代码后 12/12 通过，覆盖 Chromium / Firefox / WebKit、390/1280px、明暗色及减少动态效果；超五行外层高度和位置不变，内部跟随/暂停/返回、手动折叠保持有效。测试结果目录含 activity-window.png 和视频供复核。
- `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline-operation-groups.test.tsx apps/web/src/features/workbench/components/task-timeline-reasoning.test.tsx packages/ui/src`：14 文件、97 测试通过。
- `pnpm --dir desktop test:run src/features/workbench/components/task-timeline`：6 文件、39 测试通过。
- 扩大 Web 时间线测试：26 文件 187/188 通过；唯一失败为原有 task-timeline-basics.test.tsx 的文件路径 title 预期。该测试直接渲染未修改的文件操作组件，HEAD 中已存在 title={change.path}，不属于本次活动窗口行为，保留原实现。
- `pnpm typecheck`、`pnpm --dir desktop typecheck`、`pnpm lint`、`pnpm --dir desktop lint`、`pnpm --dir desktop source:lines`、变更文件 Prettier 与 `git diff --check` 通过。
- `pnpm test:performance`：9 文件、17 测试通过。Web 构建、桌面构建、`pnpm bundle:check` 与 `pnpm --dir desktop performance:budget` 通过；Web 初始 314.01/320 KiB，工作台 464.89/500 KiB，未引入依赖和额外请求。
- `pnpm lint:architecture`：0 错误，1 个已有 no-orphans 警告 packages/server/src/sqlite-journal.d.ts；该文件不在本次修改范围。未运行不相关的 Rust、协议、发布及完整全库套件；本次不修改原生和协议。
- 证据复用：当前会话最终相关源码之后的以上类型、构建、单元、性能及浏览器通过结果直接复用，不因进入最终检查而重复运行。
- Simplification: no-change；共用滚动、手动覆盖和动画已集中至 UI 包，两端只保留订阅与翻译。
- Spec: update `.superwork/spec/ui/shared/index.md`，记录五行、内部事件隔离、手动优先和原生动效约束；现有索引内可直接发现，新增内容不包含外部链接。
- 共享影响：工具、命令、文件操作从首条起保持组身份；运行时默认展开，后续正文收起，手动选择优先；已完成执行过程展开也受五行限制。单独思考摘要保留原入口。

### Task 2: 将操作详情移出五行窗口并消除嵌套滚动

**Files:**

- Create: `packages/ui/src/agent/tool-details.tsx`
- Modify: `packages/ui/src/agent/tool.tsx`
- Modify: `packages/ui/src/agent/operation-group.tsx`
- Modify: `packages/ui/src/agent/agent-ui.css`
- Modify: `apps/web/src/features/workbench/components/task-timeline-operation-groups.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store-operation-groups.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-operation-groups.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-store-operation-groups.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-operation-groups.browser.test.tsx`
- Modify: `tests/e2e/app-shell-trace-motion.spec.ts`
- Modify: `.superwork/spec/ui/shared/index.md`

**Interfaces:**

- Consumes: `Tool`、`ToolHeader`、`ToolBody`、`OperationGroupViewport` 和共享 `Dialog`。
- Produces: 按需挂载的独立详情弹层；列表只包含摘要行，详情单一纵向滚动。

**Behavior:**

- 活动窗口内的命令、工具与思考详情由用户点击打开 Portal Dialog，不受五行高度和中栏宽度限制；组外原有折叠行为保留。
- 复用既有文件 Diff 独立入口；命令日志、输入和结果在详情内使用同一个纵向滚动区。
- 流式运行不自动打开弹层；新助手正文到达不关闭正在查看的详情；关闭及 Escape 恢复焦点，详情关闭后卸载。
- 两端翻译通过 props 注入，共享组件不引入平台依赖；继续保持动画与低渲染开销。

**Stop Conditions:**

- 如果文件 Diff 入口仍受滚动容器裁剪，须补充该边界的复现与修复。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/features/workbench/components/task-timeline-operation-groups.browser.test.tsx`

Expected: Chromium / WebKit 中详情超出五行高度、独立宽度、单纵向滚动、阅读期间持续挂载与关闭通过；Web 三浏览器 E2E 通过。

## Task 2 修复证据与交接

- 根因：初版将 ToolBody 与命令 TerminalContent 的独立滚动区一起放进 156px 活动窗口，形成高度裁剪及嵌套纵向滚动。用户后续要求覆盖 Task 1 的详情高度约束。
- 协作登记：operation-details-20261028 / codex-operation-details；修复沿用 debugging → TDD → check，保留 Task 1 的现有修改。
- RED：`pnpm --dir desktop test:browser src/features/workbench/components/task-timeline-operation-groups.browser.test.tsx`，Chromium / WebKit 在 320/960px 下均找不到独立 dialog，确认详情仍处于五行窗口内。
- 最终 GREEN：同一命令 14/14 通过；验证按需弹层、100 行长日志、独立宽度与高度、唯一正文纵向滚动、运行中不自动打开、后续正文不卸载详情、关闭后焦点恢复。最终源码后执行，退出码 0。
- Web：`pnpm exec playwright test tests/e2e/app-shell-trace-motion.spec.ts tests/e2e/app-shell-runtime-activity.spec.ts --workers 2` 最终 14/14 通过，覆盖 Chromium / Firefox / WebKit 的宽窄屏、减少动态效果及活动列表、独立长日志弹层、焦点恢复、文件 Diff 独立打开；退出码 0。截图 operation-detail.png 已检查宽屏及移动端，长日志可完整滚动且标题/关闭入口保持可见。
- `pnpm exec vitest run packages/ui/src apps/web/src/features/workbench/components/task-timeline-operation-groups.test.tsx apps/web/src/features/workbench/components/task-timeline-tools.test.tsx apps/web/src/features/workbench/components/task-timeline-reasoning.test.tsx`：15 文件 110/110 通过。组外原有折叠及详情卸载行为仍通过。
- `pnpm test:performance`：9 文件 17/17 通过；`pnpm typecheck`、根及桌面 lint、桌面构建（含 tsc）、Web 构建、两端包体预算、500 行检查和相关格式 / diff 检查均通过。Web 初始 314.01/320 KiB，工作台 465.30/500 KiB、37 个请求，未新增依赖。
- 架构检查仍为 0 错误及原有 sqlite-journal.d.ts 孤立声明警告。未运行无关 Rust / 协议 / 完整全库套件，变更仅涉及共享 UI 及平台文案适配。
- Simplification: changed；将弹层上下文和详情挂载集中在 tool-details.tsx，稳定 onOpen 回调，减少组状态更新导致的上下文刷新；最终相关单元、浏览器、类型和构建结果已重新验证。
- Spec: update UI shared 索引，撤销详情受五行窗口限制的旧规则，记录按需 Portal、单滚动区、手动打开与阅读期间保持挂载。
- 共享影响：closeLabel 由两端现有 workbench.actions.close 注入；Tool 仅在活动窗口上下文中使用 Dialog，组外行为保留；Diff 和源文件预览继续沿用既有独立入口。

## 后续调整：移除活动窗口回到底部按钮

- 用户要求移除五行容器的回到底部按钮，阅读位置由用户自行滚动控制；新活动原有跟随和上翻暂停保留，手动滚到底部后恢复跟随。
- Superwork route: superwork-tdd，范围明确的共享按钮删除。登记 remove-operation-latest-20261028 / codex-remove-operation-latest。
- 删除按钮、图标、showLatest React 状态、相关 CSS 和两端已无用途的 scrollLabel 参数；无新增依赖，独立详情弹层行为保留。
- RED：更新现有浏览器回归为不出现返回按钮，在 Chromium / WebKit 宽窄容器下均因按钮仍存在失败。
- GREEN：桌面同一浏览器文件 14/14 通过；Web `pnpm exec playwright test tests/e2e/app-shell-trace-motion.spec.ts --grep 'true,' --workers 2` 6/6 通过，覆盖三浏览器宽窄屏下自行滚动、五行窗口和详情。
- 最终源码后的 `pnpm typecheck`、`pnpm --dir desktop typecheck`、两端 lint、Web 构建、相关 Prettier 与 git diff 检查通过；此纯删除不重复执行完整性能和原生套件。
- Simplification: changed，移除按钮及其独有状态、参数与样式；以上回归在最终删除后完成。
- Spec: update UI shared 索引，明确活动窗口不显示回到底部按钮；会话外层滚动器不在本次修改范围。
