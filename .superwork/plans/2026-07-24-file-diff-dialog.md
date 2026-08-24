# Feature Implementation Plan

**Goal:** 让时间线文件变更与右侧变更列表共享真实任务数据，点击任一文件后以接近官方工作台的弹窗展示完整代码 Diff。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束组件职责、可访问性和紧凑工作台视觉。
- `.superwork/spec/frontend/quality-guidelines.md` — 定义组件测试与浏览器交互验证范围。
- `docs/web-design.md` — 明确 Diff 使用 `@pierre/diffs/react` 并仅在打开时动态加载。

**Architecture:** 在 `features/diff` 建立可复用的文件变更 ViewModel 与模态 Diff Viewer；工作台只创建一个 Task Runtime，并把同一 Snapshot 分发给 Timeline 与 Inspector。两个入口仅上报选中的协议变更，由 Shell 统一管理弹窗，避免重复订阅和重复加载高亮依赖。

**Tech Stack:** React 19、TypeScript、Tailwind CSS 4、`@pierre/diffs/react`、Vitest、Playwright。

## Global Constraints

- Diff Viewer 仅在用户打开文件后动态加载，不进入初始工作台主包。
- 文件变更数据只来自 `@code-agent/protocol` 的 Task Snapshot，不保留 Inspector 演示数据。
- 弹窗支持 Escape、背景点击关闭、明确标题与可访问名称，并在窄屏中保持可滚动。
- 关键聚合、补丁规范化和浏览器交互位置添加简短中文注释。

### Task 1: 建立文件变更 ViewModel 与 Diff 弹窗

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/features/diff/file-change.ts`
- Create: `apps/web/src/features/diff/file-change.test.ts`
- Create: `apps/web/src/features/diff/file-diff-dialog.tsx`
- Create: `apps/web/src/features/diff/patch-diff-viewer.tsx`
- Modify: `apps/web/src/shared/styles/globals.css`

**Behavior Slice:**

统一统计增删行、从 Snapshot 聚合每个路径的最新变更，并把不完整的 Provider 补丁规范化为可渲染 Unified Diff；弹窗打开后才加载语法高亮 Viewer。

**Verification:**

Run `pnpm vitest run apps/web/src/features/diff/file-change.test.ts` and `pnpm run typecheck`.

### Task 2: 接入 Timeline 与 Inspector

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/use-task-runtime.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

**Behavior Slice:**

Timeline 文件行改为打开弹窗的按钮；Inspector 删除演示数据，展示当前任务 Snapshot 的真实去重变更与总统计，并使用同一弹窗入口。

**Verification:**

Run focused Vitest tests, then `pnpm check` and `pnpm test:e2e`.
