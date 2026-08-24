# New Task Project Switching Implementation Plan

**Goal:** 让项目树、顶部新建入口和空聊天项目选择共同复用项目级新聊天草稿，并在 Codex 尚未生成标题时统一显示“新聊天”。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束项目树、图标按钮、工作台布局和可访问名称。
- `.superwork/spec/frontend/state-management.md` — 约束 Project、Task 与路由状态边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 规定页面行为的 Vitest 与 Playwright 验证范围。
- `.superwork/spec/backend/runtime-lifecycle.md` — 说明 `thread/start` 后 Task 尚未 materialize 的生命周期。
- `docs/web-design.md` — 定义 `/p/:projectId` 空任务路由和首次提交的 `startTask -> startTurn -> navigate` 顺序。

**Architecture:** 保留 `/p/:projectId` 作为未提交的新聊天草稿，不提前创建空 Codex Task。侧栏入口只导航和复用该路由；首次提交仍由 Composer 创建真实 Task。Provider 在 Codex 没有 `name` 或 `preview` 时返回“新聊天”，后续 Task 查询拿到真实标题后自然替换。

**Tech Stack:** TypeScript、React 19、TanStack Router、Lucide React、Vitest、Playwright、pnpm。

## Global Constraints

- Web 只通过 `@code-agent/client` 和 `@code-agent/protocol` 消费服务端能力，不新增 Provider 专有字段。
- 项目名称按钮继续只控制 Task 树展开状态；项目右侧 `+` 单独负责打开该项目的新聊天。
- 顶部“新建任务”始终指向项目列表第一个 Project 的空聊天；当前已经是该路由时直接复用，不创建重复 Task。
- 新聊天首次提交继续复用现有幂等 `startTask -> startTurn -> navigate` 流程。
- 所有新增关键逻辑添加简短、清晰的中文注释，图标按钮提供可访问名称。

### Task 1: 统一未命名 Codex Task 的展示标题

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `normalizedTitle(thread)` 读取 Codex `name` 与 `preview`
- Produces: `AgentTask.title` 在无原生标题时返回“新聊天”

**Behavior Slice:** 新建 Task 在 Codex 返回正式名称前显示“新聊天”，已有 `name` 或 `preview` 的 Task 标题保持不变。

**Proof Intent:** Provider 单元测试分别证明空标题回退为“新聊天”，以及真实标题仍优先返回。

**Verification:** 运行 `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts`。Expected: 相关 Vitest 用例全部通过。

**Stop Conditions:**

若目标 Codex Schema 不提供可区分的空 `name`/`preview`，或现有契约要求“未命名任务”作为稳定 API 文案，则修订计划后再继续。

### Task 2: 将侧栏入口统一为项目级新聊天草稿

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `ProjectSidebar` 读取 `projects`、当前 `projectId` 与可选 `taskId`
- Produces: `ProjectSidebar` 通过 `/p/$projectId` 表达项目级新聊天草稿

**Behavior Slice:** 项目名仍展开/收起任务树；右侧按钮固定显示 `Plus` 并打开该项目的新聊天。顶部入口固定打开第一个 Project 的新聊天，若当前已经是该空聊天则复用现有路由。真实 Task 首次创建并导航后，草稿项自动消失。

**Proof Intent:** Playwright 验证项目名可折叠、右侧 `+` 不再折叠、顶部入口选择第一个 Project、空聊天在树中归属正确且不触发 Task POST。

**Verification:** 运行 `pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "new chat|project controls"`。Expected: 目标 E2E 用例通过且控制台无错误。

**Stop Conditions:**

若路由导航会触发现有 Composer 自动创建 Task，或 Project Task 列表排序无法稳定识别草稿位置，则先修订状态边界和测试断言。

### Task 3: 在空聊天中央原位切换所属项目

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `ProjectSidebar` 通过 `/p/$projectId` 表达项目级新聊天草稿
- Produces: `TaskTimeline.onProjectChange(projectId)` 请求切换空聊天所属 Project

**Behavior Slice:** 空聊天项目名可点击；点击后原位显示左栏 Project 选项，选择另一项后 URL、Composer 的 `projectId`、侧栏“新聊天”归属和中间项目名同步变化。活动 Task 时间线不显示该选择器。

**Proof Intent:** 组件测试覆盖空状态按钮和 Select 语义；Playwright 覆盖从一个 Project 切到另一个 Project 的完整可观察流程。

**Verification:** 运行 `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx` 和 `pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "switches the new chat project"`。Expected: 目标测试全部通过。

**Stop Conditions:**

若项目切换会丢失 Composer 草稿或附件，必须先明确草稿迁移规则并修订计划；若原生 Select 无法满足现有焦点或窄屏约束，则进入调试而不是替换为未验证的自研弹层。

## Final Verification

- 运行 `pnpm check`，预期格式、Lint、依赖边界、Vitest、类型检查、构建与发布校验全部通过。
- 运行 `pnpm test:e2e`，预期完整 Playwright 用户流程全部通过。
- 在桌面与窄屏视口检查项目 `+`、新聊天活动态、原位 Select、Tooltip、文字截断和面板覆盖行为。
