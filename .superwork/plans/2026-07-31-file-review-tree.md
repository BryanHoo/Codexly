# Feature Implementation Plan

**Goal:** 将审核弹窗改为左侧 Diff 审核区和右侧平铺变更文件列表，并用四个方向键完成文件切换。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束弹窗、列表组件和复用边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束键盘、可访问性和浏览器验证。
- `docs/web-design.md` — 约束只读 Diff、动态加载和检查器释放策略。

**Architecture:** 在现有 `FileReviewDialog` 内构建一维变更文件 ViewModel 并渲染右侧列表；左侧保留按需加载的 `PatchDiffViewer`，所有文件选择统一更新同一个索引状态。

**Tech Stack:** React、TypeScript、Tailwind CSS、Vitest、Playwright

## Global Constraints

- 保留 Server 提供的完整 Diff Snapshot，不新增浏览器文件读取或历史 Patch 拼接。
- 复用现有设计 Token 和 `IconButton`，不新增依赖。
- 右侧每个文件项必须同时展示新增和删除行数，选择态不能只依赖颜色。
- 文件顺序沿用 `changes` 输入顺序，四方向导航在首尾停止且不循环。

### Task 1: 实现平铺文件列表与四方向导航

**Files:**

- Modify: `apps/web/src/features/diff/file-review-dialog.tsx`
- Test: `apps/web/src/features/diff/file-review-dialog.test.tsx`

**Interfaces:**

- Consumes: `readonly AgentFileChange[]`、`PatchDiffViewer`
- Produces: 左侧 Diff 审核区、右侧平铺文件列表、四方向键文件导航

**Behavior:**

- 将变更文件按输入顺序平铺展示，文件项显示 `+additions` 和 `-removals`；点击文件项、上下按钮或四个方向键时选择同一个文件，首尾不越界。

**Stop Conditions:**

- 如果 `AgentFileChange` 不包含生成 Diff 和变更统计所需字段则停止。
- 如果现有变更数据无法表达文件名、完整路径或文件统计则停止并重新评估组件边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/diff/file-review-dialog.test.tsx`

Expected: 平铺列表模型、文件统计和四方向边界导航测试通过。

### Task 2: 验证审核弹窗真实交互

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`
- Test: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: 工作台未提交变更审核入口、`FileReviewDialog` 可访问名称与列表项
- Produces: 左右分栏、文件统计、列表选择和四方向键切换的浏览器回归证据

**Behavior:**

- 从未提交变更入口打开审核弹窗，确认 Diff 位于平铺文件列表左侧、列表项展示加减统计，并通过四个方向键切换当前审核文件。

**Stop Conditions:**

- 如果 E2E Fixture 只有一个变更文件且无法覆盖切换行为，则先扩充该 Fixture 后继续。
- 如果浏览器环境无法启动，则保留单元与构建验证结果并明确记录阻塞。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "opens file diffs from the timeline and uncommitted review button"`

Expected: 审核弹窗分栏、列表统计与四方向切换断言通过，页面无控制台或资源错误。
