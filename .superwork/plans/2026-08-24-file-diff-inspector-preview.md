# Feature Implementation Plan

**Goal:** 将 Timeline 流式输出中的单文件 Diff 迁移到右侧 Inspector 的“文件”标签预览，同时保留 Inspector 文件树、变更面板和连续审核 Dialog。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector 文件标签、单文件 Diff 与连续审核交互。
- `.superwork/spec/frontend/state-management.md` — 约束右栏瞬时文件选择状态和 Project 根切换清理。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束页面行为、窄屏溢出与动态加载验证。

**Architecture:** 扩展现有 `WorkbenchInspectorFileSelection` 判别联合，让流式源码、图片和 Diff 共用单一右栏文件选择状态；Inspector 根据选择类型挂载源码面板或轻量 Diff 面板。Inspector“项目”文件树的源码和图片使用独立 `ProjectSourceDialog`，文件树和变更面板的 Diff 使用独立 `FileDiffDialog`，均不改变当前标签；多文件连续审核继续使用现有 Dialog。

**Tech Stack:** TypeScript、React、TanStack Query、Vitest、Playwright、Tailwind CSS。

## Global Constraints

- 保持 Patch Diff Viewer 动态加载，不扩大工作台静态闭包中的重型依赖。
- 保持“文件”标签同一时刻只挂载一个选择，关闭标签后清理源码、图片或 Diff 选择。
- 保持 Inspector“项目”文件树的源码、图片和 Diff，以及“变更”、连续审核和 Git 提交历史审核使用 Dialog。
- 保持生产代码文件不超过 500 行，并按入口来源隔离文件标签与单文件 Diff Dialog 状态。

### Task 1: 让 Inspector 文件标签渲染单文件 Diff

**Files:**

- Create: `apps/web/src/features/diff/file-diff-panel.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-tabs.test.tsx`
- Modify: `apps/web/src/app/routes/workbench-route.test.tsx`

**Interfaces:**

- Consumes: `AgentFileChange`、`WorkbenchInspectorFileSelection`、`PatchDiffViewer`
- Produces: 支持 `kind: "diff"` 的 `WorkbenchInspectorFileSelection` 与右栏 `FileDiffPanel`

**Behavior:**

- 在“文件”标签中展示所选 Diff 的文件名、路径、增删统计和补丁内容；保持 Patch Diff Viewer 延迟加载，界面不创建 Dialog，窄右栏不产生整体横向溢出。

**Stop Conditions:**

- 若现有 `PatchDiffViewer` 无法在 Inspector 固定宽度内独立滚动，停止并先明确其滚动容器契约。
- 若支持 Diff 必须改变 Protocol 或服务端契约，停止并重新评估范围。

- [x] **Task Status:** completed

Run: `pnpm test -- apps/web/src/features/workbench/components/workbench-inspector-tabs.test.tsx apps/web/src/app/routes/workbench-route.test.tsx`

Expected: Inspector 单元测试确认 Diff 位于“文件”标签、无 Dialog，且重型 Diff Viewer 仍按需加载。

### Task 2: 按入口来源分流单文件 Diff

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-dialogs.tsx`
- Create: `apps/web/src/features/workbench/components/project-source-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/project-source-panel.tsx`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Create: `apps/web/src/features/diff/file-diff-dialog.tsx`
- Modify: `tests/e2e/app-shell-runtime-activity.spec.ts`
- Modify: `tests/e2e/app-shell-composer-commit.spec.ts`
- Modify: `tests/e2e/app-shell-composer-review.spec.ts`
- Modify: `tests/e2e/app-shell-temporary.spec.ts`
- Modify: `tests/e2e/app-shell-inspector-mobile.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: Timeline、Project 文件树和 Commit 变更树的 `onOpenFileDiff` 回调
- Produces: Timeline 打开 Inspector“文件”标签；Project 文件树打开独立 `ProjectSourceDialog` 或 `FileDiffDialog`，Commit 变更树打开独立 `FileDiffDialog`

**Behavior:**

- 点击 Timeline 流式输出中的单文件 Diff 后打开右栏、选中“文件”标签并展示；再次点击其他流式源码、图片或 Diff 时原位替换，关闭“文件”标签清理选择。点击 Inspector“项目”文件树中的源码、图片或 Git 变更文件，以及“变更”中的 Git 文件后打开对应独立 Dialog，并保持当前 Inspector 标签和选择状态。临时 Task 同样显示“上下文/文件”标签，连续审核继续使用 Dialog。

**Stop Conditions:**

- 若任一入口依赖 Dialog 的焦点恢复或键盘语义且没有等价右栏交互，停止并补充明确的 Inspector 焦点需求。
- 若删除旧 Dialog 会影响连续审核或提交历史审核，停止并隔离共享组件依赖后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-runtime-activity.spec.ts tests/e2e/app-shell-composer-commit.spec.ts tests/e2e/app-shell-composer-review.spec.ts tests/e2e/app-shell-temporary.spec.ts tests/e2e/app-shell-inspector-mobile.spec.ts --workers=2`

Expected: Timeline 单文件 Diff 通过右栏“文件”标签显示；Inspector“项目”文件树的源码、图片和 Diff，以及“变更”使用独立 Dialog；连续审核 Dialog 和移动端布局回归通过。
