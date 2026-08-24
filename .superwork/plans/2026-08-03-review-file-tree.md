# Feature Implementation Plan

**Goal:** 将文件审核弹窗右栏改为按 Project 相对路径组织的树形导航，并压缩没有同级分支的目录链。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束审核弹窗、文件树、键盘操作与语义化控件。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束纯逻辑测试和用户可见交互验证。
- `docs/web-design.md` — 确认 Diff 视图属于 Web 展示层且不扩展协议。

**Architecture:** 在 `file-review-dialog.tsx` 内从现有 `AgentFileChange[]` 派生稳定的目录/文件树；目录优先并按英文名称排序，只有单个目录子节点且没有直接文件时合并目录路径。右栏复用本地 `FileTree` 组件，文件节点保留增删统计并按原 `changeIndex` 切换 Diff。

**Tech Stack:** TypeScript、React 19、Vitest、AI Elements `FileTree`、i18next。

## Global Constraints

- 保持 `apps/web` 只依赖现有 Web、Client 与 Protocol 公共边界，不新增协议或 Server 请求。
- 保留审核弹窗现有方向键导航、当前位置、Escape、backdrop 与滚动复位行为。
- 使用现有语义化样式 Token 和 `FileTree` 可访问交互，不新增视觉字面值。
- 删除被树形展示替代的扁平列表构建逻辑和失效文案。

### Task 1: 构建紧凑的审核文件树

**Files:**

- Modify: `apps/web/src/features/diff/file-review-dialog.tsx`
- Test: `apps/web/src/features/diff/file-review-dialog.test.tsx`

**Interfaces:**

- Consumes: `AgentFileChange`
- Produces: `ReviewFileTreeNode`、`buildReviewFileTree`

**Behavior:**

- 将 `/` 与 `\\` 路径统一拆分为 Project 相对路径层级；在没有直接文件和同级目录分叉时合并连续目录名，并在出现分叉或文件时停止合并。
- 根文件直接显示在根层级；目录排在文件之前，同类节点按英文名称排序。

**Stop Conditions:**

- 若变更路径无法作为 Project 相对文件路径解释，停止并确认协议约束。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/diff/file-review-dialog.test.tsx`

Expected: 新增树构建用例先失败，完成实现后通过，并覆盖目录分叉、目录链压缩、Windows 分隔符与根文件。

### Task 2: 用文件树替换审核弹窗扁平列表

**Files:**

- Modify: `apps/web/src/features/diff/file-review-dialog.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Test: `apps/web/src/features/diff/file-review-dialog.test.tsx`
- Test: `tests/e2e/app-shell-composer.spec.ts`

**Interfaces:**

- Consumes: `ReviewFileTreeNode`、`buildReviewFileTree`、`FileTree`、`FileTreeFolder`、`FileTreeFile`
- Produces: 审核弹窗右栏的可访问紧凑树形导航

**Behavior:**

- 目录节点可展开收起且默认展开到当前变更文件；选择文件节点按其原始 `changeIndex` 更新左侧 Diff，文件行继续显示增删统计。
- 删除旧扁平列表与对应失效文案，保留右栏标题、文件总数和当前文件选中状态。

**Stop Conditions:**

- 若现有 `FileTree` 无法同时表达紧凑目录名称、选中路径与文件统计，停止并先确认共享组件是否需要扩展。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/diff/file-review-dialog.test.tsx`

Expected: 组件标记断言与全部审核导航测试通过，树形节点具有正确的 `role`、展开状态、选中状态和统计文本。
