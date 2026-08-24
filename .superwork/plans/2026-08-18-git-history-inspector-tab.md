# Feature Implementation Plan

**Goal:** 将 Composer 的 Git 历史入口改为打开右栏“历史”标签，并移除历史 Sheet 抽屉。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector 标签、Git 历史交互与共享基础组件。
- `.superwork/spec/frontend/state-management.md` — 约束 TanStack Query 缓存和瞬时界面状态。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Vitest、Playwright、可访问性和窄屏验证。

**Architecture:** 将原 `GitHistoryDialog` 的仓库分页与提交审核逻辑重构为无弹层外壳的 `GitHistoryPanel`，由 `WorkbenchInspector` 在新增的 `history` 标签中按需挂载；Composer 入口只负责打开 Inspector 并选择该标签，Shell 不再持有历史弹窗状态。

**Tech Stack:** React、TypeScript、TanStack Query、i18next、Vitest、Playwright。

## Global Constraints

- 保持 Composer Git 历史入口的位置、尺寸和可访问名称不变。
- “历史”标签必须与现有“项目”“上下文”标签复用同一 Button 样式和交互语义。
- 提交详情继续使用共享 `GitCommitReview` Dialog，历史主体不得使用 Sheet、Drawer 或 Dialog 外壳。
- Git 历史 Query 仅在右栏历史内容挂载后读取，并按仓库保留单次挂载期间的分页和列表状态。
- 单个开发代码文件不得超过 500 行，关键状态转换保留简短中文注释。

### Task 1: 将 Git 历史重构为 Inspector 内容面板

**Files:**

- Create: `apps/web/src/features/workbench/components/git-history-panel.tsx`
- Create: `apps/web/src/features/workbench/components/git-history-panel.test.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-inspector-tabs.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Delete: `apps/web/src/features/workbench/components/git-history-dialog.tsx`
- Delete: `apps/web/src/features/workbench/components/git-history-dialog.test.tsx`

**Interfaces:**

- Consumes: `CodeAgentGitHistoryClient & CodeAgentGitCommitReviewClient`、`projectId`、`WorkbenchInspectorTab`。
- Produces: `GitHistoryPanel`、`WorkbenchInspectorTabs`、扩展后的 `WorkbenchInspectorTab = "changes" | "context" | "history"`、可访问的“历史”标签页。

**Behavior:**

- 在 Inspector 中展示“历史”标签；选中后渲染分支、子仓库、分页提交列表，并允许通过独立审核 Dialog 查看提交文件和 Diff，历史主体不再包含 Sheet 外壳或关闭按钮。

**Stop Conditions:**

- 若 Inspector 无法获得现有 Git Client 或 Project 身份，停止并重新确认组件边界。
- 若移除 Sheet 会破坏 `GitCommitReview` 的独立 Portal 或焦点语义，停止并先隔离弹层所有权。

- [x] **Task Status:** completed

Run: `pnpm test -- apps/web/src/features/workbench/components/git-history-panel.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: 新增历史标签和面板测试通过，静态标记中不存在 `sheet-content`。

### Task 2: 将 Composer 入口接入右栏标签并清理弹窗状态

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-dialogs.tsx`
- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: `setInspectorOpen`、`setInspectorTab`、Composer `onOpenGitHistory`。
- Produces: 点击 Git 历史后打开 Inspector 并选择 `history` 的 Shell 行为，以及不再包含 `gitHistoryOpen` 的 Runtime/Dialog 契约。

**Behavior:**

- 点击 Composer Git 历史按钮时打开右栏并选中“历史”；可切换到“项目”或“上下文”后再次点击返回历史，窄屏无横向溢出，代码库中不再挂载历史 Sheet。

**Stop Conditions:**

- 若移动端 Inspector 的既有布局无法容纳历史内容且需要改变全局断点，停止并确认布局改动范围。
- 若删除弹窗状态影响提交变更 Sheet 内部复用的历史列表，停止并保留该独立消费方。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-composer.spec.ts --grep "Git history|single repository"`

Expected: Git 历史入口与分页 E2E 在右栏历史标签中通过，页面中不存在 Git 历史 Sheet。
