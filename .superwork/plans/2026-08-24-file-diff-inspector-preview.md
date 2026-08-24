# Feature Implementation Plan

**Goal:** 将所有单文件 Diff 从独立 Dialog 迁移到右侧 Inspector 的“文件”标签预览，同时保留连续文件审核 Dialog。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector 文件标签、单文件 Diff 与连续审核交互。
- `.superwork/spec/frontend/state-management.md` — 约束右栏瞬时文件选择状态和 Project 根切换清理。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束页面行为、窄屏溢出与动态加载验证。

**Architecture:** 扩展现有 `WorkbenchInspectorFileSelection` 判别联合，让源码、图片和 Diff 共用单一右栏文件选择状态；Inspector 根据选择类型挂载源码面板或轻量 Diff 面板。所有单文件 Diff 入口只更新该选择并打开右栏文件标签，删除旧 `FileDiffDialog` 状态与装配；多文件连续审核继续使用现有 Dialog。

**Tech Stack:** TypeScript、React、TanStack Query、Vitest、Playwright、Tailwind CSS。

## Global Constraints

- 保持 Patch Diff Viewer 动态加载，不扩大工作台静态闭包中的重型依赖。
- 保持“文件”标签同一时刻只挂载一个选择，关闭标签后清理源码、图片或 Diff 选择。
- 保持连续审核和 Git 提交历史审核 Dialog 行为不变。
- 保持生产代码文件不超过 500 行，并删除冗余的旧单文件 Diff Dialog 路径。

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

### Task 2: 将所有单文件 Diff 入口切换到右栏选择状态

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-dialogs.tsx`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Delete: `apps/web/src/features/diff/file-diff-dialog.tsx`
- Modify: `tests/e2e/app-shell-runtime-activity.spec.ts`
- Modify: `tests/e2e/app-shell-composer-commit.spec.ts`
- Modify: `tests/e2e/app-shell-composer-review.spec.ts`
- Modify: `tests/e2e/app-shell-temporary.spec.ts`
- Modify: `tests/e2e/app-shell-inspector-mobile.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: Timeline、Project 文件树和 Commit 变更树的 `onOpenFileDiff` 回调
- Produces: 所有单文件 Diff 入口统一打开 Inspector“文件”标签并原位替换当前文件选择

**Behavior:**

- 点击任意单文件 Diff 后打开右栏、选中“文件”标签并展示该 Diff；再次点击其他源码、图片或 Diff 时原位替换；关闭“文件”标签清理选择。临时 Task 同样显示“上下文/文件”标签，连续审核继续使用 Dialog。

**Stop Conditions:**

- 若任一入口依赖 Dialog 的焦点恢复或键盘语义且没有等价右栏交互，停止并补充明确的 Inspector 焦点需求。
- 若删除旧 Dialog 会影响连续审核或提交历史审核，停止并隔离共享组件依赖后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-runtime-activity.spec.ts tests/e2e/app-shell-composer-commit.spec.ts tests/e2e/app-shell-composer-review.spec.ts tests/e2e/app-shell-temporary.spec.ts tests/e2e/app-shell-inspector-mobile.spec.ts --workers=2`

Expected: 所有单文件 Diff 场景通过右栏“文件”标签显示，关闭后标签移除；连续审核 Dialog 和移动端布局回归通过。
