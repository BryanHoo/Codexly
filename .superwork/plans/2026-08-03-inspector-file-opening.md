# Feature Implementation Plan

**Goal:** 让右侧 Inspector 项目文件树中的未变更文件复用 AI Markdown 文件引用的打开规则，在项目内预览源码与图片，并将不可预览文件交给系统默认应用。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束验证命令与实现范围。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector 文件树、文件预览与宿主打开交互。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束浏览器流程测试与本地文件安全边界。
- `docs/web-design.md` — 约束工作台文件树和 Project 内文件打开方式。
- `.superwork/plans/2026-08-03-markdown-file-opening.md` — 提供现有 AI Markdown 文件类型分流契约。

**Architecture:** 将 Inspector 的未变更文件选择事件接入 `WorkbenchShell` 已有的统一文件引用处理器；继续由 `classifyProjectFileReference` 区分源码、图片和系统文件，继续由现有受控 Server 接口或 `system-default` Mutation 执行打开操作。存在 Git 变更的文件仍优先打开 Diff。

**Tech Stack:** TypeScript、React、TanStack Query、Vitest、Playwright、pnpm。

## Global Constraints

- Inspector 与 AI Markdown 必须共享同一文件类型分流，不能维护第二份扩展名规则。
- 源码和图片只能通过现有 Project 受控接口在当前页面打开。
- 不可预览文件直接调用 `system-default`，不得先请求源码接口制造错误。
- 存在 Git 变更的文件继续打开单文件 Diff。
- 保留已有右键“打开方式”行为，不启动开发服务器。

### Task 1: 统一 Inspector 文件点击分流

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Test: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: `classifyProjectFileReference`、`MessageFileReference`、`CodeAgentClient.openProject`
- Produces: `WorkbenchInspector.onOpenProjectFile(path)` 与 Inspector 未变更文件的统一打开行为

**Behavior:**

- 点击未变更的源码或 Markdown 文件时打开项目内源文件 Dialog；点击 GIF、JPEG、PNG 或 WebP 时打开项目内图片 Dialog；点击 Office、演示、表格、归档等不可预览文件时发送 `system-default` 打开请求；点击存在 Git 变更的文件仍打开 Diff。

**Stop Conditions:**

- 如果 Inspector 无法通过现有 `openProject` Mutation 或 `ProjectSourceDialog` 复用 AI Markdown 行为，停止并先明确新的共享接口边界。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-composer.spec.ts --grep "project file tree opens"`

Expected: Inspector 文件树中的变更文件、源码文件、图片和不可预览文件分别进入 Diff、项目内预览和系统默认应用打开流程。
