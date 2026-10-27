# Feature Implementation Plan

**Goal:** 参考 shadcn Questionnaire，按现有主题统一两端用户回答卡片并固定在输入框上方。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 验证入口与全局约束。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — UI 共享边界。
- `.superwork/spec/ui/shared/index.md` — 翻译注入、焦点、滚动与共用控件。
- `.superwork/spec/web/frontend/index.md` — Web 与移动交互。
- `.superwork/spec/desktop/frontend/index.md` — 桌面与 Legacy 及 500 行限制。
- `.superwork/spec/frontend-core/shared/index.md` — 异步问答草稿与投递确认不变。

**Architecture:** 在 packages/ui 提供无平台依赖的 Questionnaire 卡片、逐题导航、原生选项及公共问答渲染；业务层保留草稿、提交锁、幂等与传输。Confirmation 适配公共卡片外观，待处理请求移到输入框上方，时间线保留独立使用的默认行为。

**Tech Stack:** React、TypeScript、现有 Tailwind 语义样式、Vitest、Playwright、pnpm。

## Global Constraints

- 使用现有颜色、字号、圆角与按钮，不添加重型组件依赖或轮询。
- Web（包含移动浏览器）与桌面共用 UI；平台提交语义与权限能力不变。
- 保留草稿、失败重试、幂等、密码遮蔽及 MCP 原生字段校验。
- 关键逻辑添加中文注释；桌面源文件及测试不超过 500 行。
- 公告：questionnaire-20261027 / codex-questionnaire-20261027，仅清理自己的记录。

### Task 1: 实现共享 Questionnaire 与两端问答接入

**Files:**

- Create: `packages/ui/src/core/questionnaire.tsx`
- Delete: `packages/ui/src/core/multiple-question-options.tsx` — 消费者全部迁入公共问卷，移除旧重复实现
- Create: `packages/ui/src/core/questionnaire-choice.tsx`
- Create: `apps/web/src/features/workbench/components/questionnaire.test.tsx`
- Create: `packages/ui/src/core/user-input-questionnaire.tsx`
- Create: `packages/ui/src/core/mcp-questionnaire-field.tsx`
- Modify: `apps/web/src/features/workbench/components/async-questions.tsx`
- Modify: `desktop/src/features/workbench/components/async-questions.tsx`
- Modify: `apps/web/src/features/workbench/components/pending-request.tsx`
- Modify: `desktop/src/features/workbench/components/pending-request.tsx`
- Modify: `apps/web/src/features/workbench/components/mcp-elicitation-request.tsx`
- Modify: `desktop/src/features/workbench/components/mcp-elicitation-request.tsx`
- Modify: `apps/web/src/shared/components/agent/confirmation.tsx`
- Modify: `desktop/src/shared/components/agent/confirmation.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `desktop/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `desktop/src/i18n/locales/en/conversation.ts`
- Create: `desktop/src/features/workbench/components/questionnaire.browser.test.tsx`

**Interfaces:**

- Consumes: 现有 QuestionDraft、PendingRequest、McpElicitationField 与平台提交回调。
- Produces: Questionnaire、QuestionnaireCard、QuestionnaireChoice 及公共字段渲染；翻译由 props 注入。

**Behavior:**

- 单选、多选、自定义、自由输入、密码和 MCP 校验统一呈现；多题逐步导航，答案跨步骤保留；仅显式最终提交发送。
- 不可交互、提交中与失败重试保持原语义；隐藏步骤不阻塞当前步骤校验，最终检查全部步骤。

**Stop Conditions:**

- 如复用需要改变协议或平台传输，先修订计划。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/questionnaire.test.tsx apps/web/src/features/workbench/components/pending-request.test.tsx && pnpm --dir desktop exec vitest run --config vitest.browser.config.ts src/features/workbench/components/questionnaire.browser.test.tsx src/features/workbench/components/async-questions.browser.test.tsx src/features/workbench/components/mcp-elicitation-request.browser.test.tsx`

Expected: 公共语义、逐题导航与两端原有回答语义验证通过。

### Task 2: 统一输入框上方的卡片位置并验证两端布局

**Files:**

- Modify: `apps/web/src/features/workbench/components/async-question-dock.tsx`
- Modify: `desktop/src/features/workbench/components/async-question-dock.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-active-task.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-shell-active-task.tsx`
- Create: `desktop/src/features/workbench/components/pending-request-dock.tsx`
- Create: `apps/web/src/features/workbench/components/pending-request-dock.tsx`
- Modify: `tests/e2e/app-shell-async-questions.spec.ts`
- Modify: `tests/e2e/app-shell-runtime-requests.spec.ts`
- Modify: `tests/e2e/app-shell-runtime-activity.spec.ts` — 与输入框上方审批位置同步焦点回归
- Modify: `tests/e2e/app-shell-composer-commit.spec.ts` — 修正既有重复关闭入口选择器
- Modify: `tests/e2e/app-shell-commit-mutation.spec.ts` — 全量回归中修正既有重复“关闭”按钮的选择器
- Modify: `desktop/src/features/workbench/components/async-questions.browser.test.tsx`
- Modify: `desktop/src/features/workbench/components/questionnaire.browser.test.tsx`

**Interfaces:**

- Consumes: TaskStore 与现有 onResolvePendingRequest。
- Produces: PendingRequestDock 与可外置请求卡片的 TaskTimeline 适配。

**Behavior:**

- 两端卡片固定在输入框上方，与输入框同宽；长内容独立滚动，避免时间线重复渲染；审批顺序保持不变。
- 窄屏及键盘可用，草稿在折叠、题目切换与错误后保留。

**Stop Conditions:**

- 如外置会破坏历史页独立呈现，保留默认时间线入口，仅活动工作台外置。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-async-questions.spec.ts tests/e2e/app-shell-async-question-fold.spec.ts && pnpm --dir desktop exec vitest run --config vitest.browser.config.ts src/features/workbench/components/questionnaire.browser.test.tsx src/features/workbench/components/async-question-dock.browser.test.tsx`

Expected: Web 宽窄屏与桌面浏览器均验证卡片位置、回答、焦点和滚动。

## 验证记录

- Task 1：RED 为共享组件缺失；GREEN：Web SSR 9 项通过，桌面 Chromium/WebKit 的问卷、异步问答和 MCP 26 项通过。原生校验、密码、多选、自定义回答与幂等重试均覆盖。

- Task 2：RED 为缺失 PendingRequestDock；GREEN：Web 三浏览器 30 项通过，桌面两浏览器相关套件 48 项通过。布局保留原最大高度约束，单独滚动正文并固定导航。
- 简化复查：changed。删除已无消费者的旧 `MultipleQuestionOptions`，共享字段已消除两端重复渲染；传输、幂等与桌面 URL 处理继续留在业务适配器。
- 规范：更新 `.superwork/spec/ui/shared/index.md`，记录公共问卷、焦点校验和输入框上方位置契约。

- 扩展回归：既有 Git 弹窗用例因两处同名关闭入口而严格选择器失败，定向复现后仅修正测试选择标准 `dialog-close`。第一次全量端到端与重建产物并行造成资源不稳定，构建完成后串行重跑，不复用受影响结果。

- 全量回归补充：恢复公共问卷标题的 h3 语义（先以 SSR 和既有用户输入 E2E 捕获缺失），并将审批焦点测试改为点击独立请求区；任务切换测试捕获新增请求区与 Timeline 的 React key 冲突，已为请求区使用独立的 requests 前缀，另一个 Git 弹窗测试使用标准关闭入口。

- 任务切换回归根因：Web 的 Timeline 与新增 PendingRequestDock 最初使用同一个 taskScope key，导致 React 残留旧时间线。修正为 requests 前缀，保持原路由滚动测试原样验证，禁止用测试等待掩盖结构问题。

## 最终交接与验证证据

工作目录为仓库根目录 `/Users/bryanhu/Develop/person/Codexly`；桌面命令通过 `pnpm --dir desktop` 运行。依赖未变，使用现有 pnpm 工作区、Fake Server、Chromium / Firefox / WebKit 测试环境。

- 最新 Web 构建后执行 `pnpm exec playwright test --workers=4`：**342 passed**，退出码 0；任务切换、卡片位置、实际回答、审批、断线和宽窄屏均包含在完整套件中。构建与该套件串行运行，无中途产物重建。
- 最新源代码执行 `pnpm exec vitest run packages/ui/src apps/web/src/features/workbench/components`：**88 files / 506 tests passed**，退出码 0。
- 完整 `pnpm test`：**651 files / 3707 tests passed**，6 个文件及 28 项按原配置跳过。随后 UI 调整由前述最新 506 项前端套件及完整 E2E 覆盖；未改动的领域、协议、传输与后端结果复用本次运行证据。
- `pnpm --dir desktop test:browser`：**208 files / 762 tests passed**；后续恢复 h3 标题语义后，再执行 Questionnaire、异步问答、Dock、MCP 的 Chromium / WebKit 定向套件，**48 tests passed**。最后仅改变父组件 key 的固定前缀以隔离请求区身份，类型检查与两种构建再次通过。
- `pnpm --dir desktop check:web`：退出码 0，包含 **163 files / 646 unit tests passed**、源码行数、静态检查、Tauri 约束、Legacy 兼容、预算和构建。最终公共 UI 与身份标识调整后另行完成现代 / Legacy 构建、类型与预算检查。
- `pnpm build`、最新 Web 构建、桌面 `build` / `build:legacy` 均退出码 0；`pnpm bundle:check`、桌面 `performance:budget` 和 `pnpm package:check` 通过。没有新增运行时依赖。
- `pnpm test:performance`：**9 files / 17 tests passed**；此次未改动原有流式、状态订阅或调度逻辑，复用该证据。
- `pnpm typecheck`、桌面 `typecheck` / `lint` / `source:lines`、根 `lint` / `format:check` / `lint:architecture`、`git diff --check` 通过。架构检查只有既有 `sqlite-journal.d.ts` orphan 提示，没有错误。
- `pnpm codex:schema:check` 验证 0.164.0 基线通过；没有修改原生 Rust、协议、数据库或传输，不重复执行无关原生编译。
- 规范结果为 update：`.superwork/spec/ui/shared/index.md` 本身为已有导航入口，新增规则与上述真实测试路径已核对。计划 preflight 与最终格式检查通过。
- 简化结果为 changed：删除无消费者的旧多选组件，公共 UI 合并两端重复表单；其后类型、架构、相关测试与构建通过。

交付影响：两端公共 Questionnaire、选项及 MCP 字段；业务适配器保留原提交锁、幂等、原生 URL 和草稿语义。活动任务请求区与时间线使用不同 key，独立时间线默认保留请求入口。未遗留必需的验证或实现工作。

## 紧凑样式迭代（2026-10-27）

- 用户反馈为选项垂直对齐和整体密度；本次只调整公共视觉与自定义回答排版，保留既有状态、草稿、提交与校验。
- RED：实际预览页面的单行选项为 44px，单选控件距行中心偏移 3px，底部按钮 32px；几何断言要求选项不超过 32px、中心偏差不超过 1px，按预期失败。
- 修复：选项最小高度改为 28px，清除原生 margin、改为 items-center，标题/选项采用 label 字号，按钮使用 24px toolbar；收紧外框、进度、题间和底部间距，移除外框阴影，MCP 与用户输入同步。自定义回答与“其他”并排，减少额外空白区域。
- GREEN：预览实测单行选项 28px、控件及文字中心偏差均 0px、按钮 24px；共享 UI / Web 工作台 506 项、桌面完整浏览器 762 项、Web 完整 E2E 342 项通过。之后仅将自定义回答改为同行布局，再通过桌面相关 38 项，并补跑最终 Web 问答回归与前端测试。
- 复用理由：完整套件验证共同密度和操作区改动；末次同行布局由最新异步问答与表单定向套件覆盖。纯样式变更不涉及后端、Rust、协议或依赖，不重新执行无关检查。
- 简化结果 no-change：没有引入新封装或状态分支；规范结果 update，记录紧凑密度与居中规则。预览服务保留在 127.0.0.1:5173，展示隔离演示数据。

- 紧凑版最终验证：同行输入后的最新前端 506 项、桌面相关 38 项、Web 三浏览器问答与审批 18 项通过；类型、两端 lint、源码行数、格式及预算通过。桌面与 390px 预览实测卡片 255.5px，选项 28px、按钮 24px、中心误差 0px，窄屏无横向溢出。浏览器已刷新最新构建；演示服务的临时任务列表使用空集合，避免测试后端未实现入口干扰外观。
