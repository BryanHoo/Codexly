# Feature Implementation Plan

**Goal:** 将提交变更流程重构为右侧抽屉，在同一工作面板中完成消息生成、分层变更选择、提交操作和当前仓库历史查看。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束验证命令、包管理器和工程边界。
- `.superwork/spec/frontend/component-guidelines.md` — 约束紧凑工作台、shadcn、AI Elements、Git 历史和 Mutation 单飞行为。
- `.superwork/spec/frontend/state-management.md` — 约束 TanStack Query 服务端状态与局部交互状态边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束可访问性、窄屏和用户流程验证。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Git 状态、历史和提交契约的既有语义。
- `docs/web-design.md` — 约束 CodeAgent 工作台视觉密度和功能目录边界。

**Architecture:** 保持既有 Protocol、Client 和 Server Git 契约不变；在 Web 侧新增项目化 shadcn `Sheet` 与 `Checkbox`，将 AI Elements `FileTree` 组合成暂存/未暂存目录树，并把 Git 历史列表抽成可复用内容组件供独立历史弹窗和提交抽屉共同使用。提交抽屉由现有 Controller 继续持有 Mutation 与仓库切换状态。

**Tech Stack:** React 19、TypeScript、TanStack Query、shadcn/ui（Radix）、AI Elements、Tailwind CSS v4、Vitest、Playwright。

## Global Constraints

- 使用 `pnpm` 和既有 Workspace 边界，不修改 Git Protocol、Client 或 Server API。
- 所有应用文案同时更新 `zh-CN` 与 `en` i18next 资源，路径、分支、提交信息保持原文。
- 抽屉从右侧打开，保留 Portal、焦点圈定、Escape、backdrop、关闭后焦点恢复和 Mutation 期间防误关。
- shadcn 基础组件只映射项目现有 Token 和尺寸，不引入默认主题；AI Elements `FileTree` 只做项目风格组合。
- 移除旧提交 Dialog 的折叠平铺列表和重复按钮布局，不保留旧实现兼容分支。

### Task 1: 增加项目化抽屉与复选框基础组件

**Files:**

- Create: `apps/web/src/shared/ui/sheet.tsx`
- Create: `apps/web/src/shared/ui/checkbox.tsx`
- Modify: `apps/web/src/shared/ui/ui-primitives.test.tsx`

**Interfaces:**

- Consumes: `radix-ui/dialog`、`radix-ui/checkbox`、现有 `Button` 与 `--ui-*` 设计 Token。
- Produces: `Sheet*` 与 `Checkbox` 项目基础组件，支持右侧抽屉、受控选中和可访问标题。

**Behavior:**

- 渲染使用项目 Token 的右侧 `SheetContent` 和可控 `Checkbox`，保留 Radix Portal、焦点管理、禁用态及 SSR 测试能力。

**Stop Conditions:**

- 如果当前 `radix-ui` 聚合包不导出所需 primitive，停止并先确认依赖策略。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/ui/ui-primitives.test.tsx`

Expected: 基础组件测试验证 sheet 方向、标题关联和 checkbox 状态后通过。

### Task 2: 抽取可复用 Git 历史内容

**Files:**

- Create: `apps/web/src/features/workbench/components/git-history-list.tsx`
- Modify: `apps/web/src/features/workbench/components/git-history-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/git-history-dialog.test.tsx`

**Interfaces:**

- Consumes: `projectGitHistoryInfiniteQueryOptions`、`CodeAgentGitHistoryClient`、`ProjectGitHistoryPage`。
- Produces: 可按 `projectId + repository` 读取分支、分页提交、加载/失败/空状态的 `GitHistoryList`。

**Behavior:**

- 独立历史弹窗继续按仓库缓存和切换历史；提交抽屉可复用同一列表，只显示当前所选仓库及分支，不再复制提交项和分页逻辑。

**Stop Conditions:**

- 如果抽取会破坏独立历史弹窗的仓库级缓存或 Tab 键盘行为，停止并收窄为共享无状态内容组件。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/git-history-dialog.test.tsx`

Expected: 根仓库、子仓库切换、分页、空状态和历史结束测试全部通过。

### Task 3: 构建分组变更树与提交抽屉

**Files:**

- Create: `apps/web/src/features/workbench/components/commit-changes-tree.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-dialog.test.tsx`

**Interfaces:**

- Consumes: `ProjectGitStatus.staged`、`ProjectGitStatus.unstaged`、AI Elements `FileTree*`、shadcn `Sheet`、`Checkbox`、`ButtonGroup`、`DropdownMenu`。
- Produces: 从右侧打开的提交抽屉、同步路径选择状态、暂存/未暂存目录树、消息生成和提交/提交并推送操作。

**Behavior:**

- 默认展开变更目录并全选可提交路径；按暂存和未暂存分组构建稳定目录树，同一路径在两组中共享选择状态；顶部完成消息生成与 split commit 操作，底部预留当前仓库历史区域。

**Stop Conditions:**

- 如果单个生产组件超过 500 行或树节点无法提供明确 `treeitem`/checkbox 名称，停止并继续按职责拆分。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/commit-changes-dialog.test.tsx`

Expected: 测试验证右侧 sheet、仓库选择、分组目录树、共享选择、消息生成和提交状态后通过。

### Task 4: 接入历史、国际化并验证完整工作流

**Files:**

- Modify: `apps/web/src/features/workbench/components/commit-changes-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-launcher.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `tests/e2e/app-shell-composer.spec.ts`

**Interfaces:**

- Consumes: `CodeAgentWorkbenchClient`、`projectId`、仓库局部 Git 状态与历史查询缓存。
- Produces: 根仓库和子仓库均可用的完整提交抽屉工作流，关闭后恢复 `#workbench-commit-changes` 焦点。

**Behavior:**

- 切换子仓库时同步刷新变更树与底部历史；生成消息和提交只发送选中路径及当前 snapshot；成功关闭、部分成功反馈、分页历史、窄屏和滚动区域保持可用。

**Stop Conditions:**

- 如果 E2E fixture 不提供历史响应或抽屉在 `320px` 出现横向溢出，停止并修复 fixture/布局后再完成任务。

- [x] **Task Status:** completed

Run: `pnpm test:e2e -- tests/e2e/app-shell-composer.spec.ts`

Expected: 提交抽屉、选择文件、消息生成、提交反馈、历史分页及现有 Composer 场景通过，且无 console error 或失败资源。
