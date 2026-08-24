# Feature Implementation Plan

**Goal:** 在右栏项目根文件夹提供联合刷新入口，并让 Git 状态协调器仅对已识别的 Git 项目执行周期轮询。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、项目命令与完整验证。
- `.superwork/spec/backend/directory-structure.md` — 规定 Project Git 状态与文件树端点职责。
- `.superwork/spec/frontend/component-guidelines.md` — 规定 Inspector 根节点操作、图标按钮和可访问性。
- `.superwork/spec/frontend/state-management.md` — 规定 Project Git 状态协调器的刷新与轮询生命周期。
- `.superwork/spec/frontend/quality-guidelines.md` — 规定组件、状态逻辑与页面行为验证范围。
- `.superwork/spec/shared/quality-guidelines.md` — 规定跨包 Schema、Client 和 Server 契约同步。

**Architecture:** 扩展 `ProjectGitStatus.repositoryMode` 以明确表达非 Git 项目，由 Server 返回稳定空状态；前端协调器把该模式作为周期轮询门控，但保留用户手动探测能力。Inspector 根节点新增刷新图标，单次操作重新读取所有已挂载文件树目录并调用 Project 级 Git 手动刷新。

**Tech Stack:** TypeScript、React、TanStack Query、Fastify、TypeBox、Vitest、Playwright、pnpm。

## Global Constraints

- 保持 Project 根仓库、直属子仓库聚合和非 Git 项目三种状态语义互斥。
- 非 Git 项目不得进入周期轮询或失败重试；用户手动刷新必须始终重新探测 Git 状态。
- 根刷新按钮仅在 hover、键盘聚焦或刷新进行中可见，并提供 Tooltip 与可访问名称。
- 一次根刷新必须重新读取当前已挂载的根目录和展开目录，并重新探测 Project Git 状态。
- 所有生产代码文件保持不超过 500 行，关键状态转换添加简短中文注释。

### Task 1: 定义非 Git Project 状态

**Files:**

- Modify: `packages/protocol/src/project-git.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/server/src/git-working-tree.ts`
- Modify: `packages/server/src/git-working-tree.test.ts`
- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: `ProjectGitStatusSchema`, `readGitWorkingTreeStatus`
- Produces: 支持 `repositoryMode: "none"` 的 `ProjectGitStatus`

**Behavior:**

- 当 Project 根目录与直属子目录都不是 Git 仓库时返回分支、变更均为空且快照稳定的 `none` 状态；根仓库与直属子仓库聚合行为保持原语义。

**Stop Conditions:**

- 如果现有 Git Mutation 或历史接口无法通过 `repositoryMode` 拒绝 `none` 状态，则停止并重新划定协议边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/server/src/git-working-tree.test.ts`

Expected: 非 Git、根仓库与直属子仓库聚合契约测试全部通过。

### Task 2: 仅为 Git Project 调度轮询

**Files:**

- Modify: `apps/web/src/features/projects/project-git-status-coordinator.ts`
- Modify: `apps/web/src/features/projects/project-git-status-coordinator.test.ts`
- Modify: `.superwork/spec/frontend/state-management.md`

**Interfaces:**

- Consumes: `ProjectGitStatus.repositoryMode`, `ProjectGitStatusCoordinator.handleActivity`, `ProjectGitStatusCoordinator.refreshProject`
- Produces: 由最新 Project Git 状态门控的轮询与重试生命周期

**Behavior:**

- 自动刷新识别到 `none` 后立即清理周期与重试计时器，后续 Task 活动不再触发自动 Git 请求；手动刷新仍可把状态切回 Git 并恢复活动 Task 的单一轮询周期，Git 项目切为 `none` 时再次停止。

**Stop Conditions:**

- 如果协调器无法区分用户手动刷新和活动事件触发的后台刷新，则停止并先补充显式刷新来源接口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/project-git-status-coordinator.test.ts`

Expected: 非 Git 项目不轮询、不重试，手动重新探测可恢复轮询，现有串行合并与终态刷新测试通过。

### Task 3: 添加项目根节点联合刷新按钮

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Test: `tests/e2e/app-shell-composer.spec.ts`

**Interfaces:**

- Consumes: `WorkbenchInspector.onRefreshFileTreeDirectory`, `refreshProjectGitStatus`, `fileTreeQueries`
- Produces: `WorkbenchInspector.onRefreshProject` 根节点联合刷新动作

**Behavior:**

- 根文件夹 hover 或键盘聚焦时显示 `RefreshCw` 图标按钮；点击后保持根节点展开状态，重新读取当前根目录及展开目录并重新探测 Git 状态，刷新期间按钮可见、禁用并显示旋转状态。

**Stop Conditions:**

- 如果联合刷新会导致根节点操作菜单不可访问或触发文件夹折叠，则停止并调整事件边界后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: 根节点同时渲染刷新与操作按钮，刷新入口具备中英文可访问名称且不改变文件树节点行为。
