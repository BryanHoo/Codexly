# Feature Implementation Plan

**Goal:** 全面补齐 Web、移动浏览器与桌面弹窗的右上角关闭入口，统一复用公共组件并保留提交保护。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 全局检查入口。
- `.superwork/spec/ui/shared/index.md` — 共享弹窗与交互约束。
- `.superwork/spec/frontend-core/shared/index.md` — 中英文共用文案契约。
- `.superwork/spec/web/frontend/index.md` — Web 与移动浏览器要求。
- `.superwork/spec/desktop/frontend/index.md` — 桌面焦点、布局与 500 行限制。

**Architecture:** 保留已经正确使用通用 Dialog 且包含关闭按钮的弹窗；为缺失入口的 27 个文件、29 处模态内容显式配置 closeLabel 与必要的 closeDisabled。共享组件统一处理标题避让；草稿和待办浮层继续使用 Popover，并通过其 Close 原语关闭与恢复焦点。

**Tech Stack:** React、TypeScript、Radix、Tailwind、Vitest、Playwright、pnpm。

## Global Constraints

- Web、移动浏览器及桌面均须覆盖；共享组件不反向依赖平台实现。
- 保留异步操作互斥、未保存草稿二次确认及焦点恢复；无额外后台工作。
- 只使用 Python3 执行 Python 脚本；沿用项目 pnpm。
- 不修改发布任务持有的文件，不提交未请求的 Git commit。

### Task 1: 统一关闭按钮与标题避让

**Files:**

- Modify: `packages/ui/src/core/dialog.tsx`
- Create: `desktop/src/shared/components/core/dialog-close.browser.test.tsx`
- Modify: `apps/web/src/shared/components/core/ui-primitives.test.tsx`

**Interfaces:**

- Consumes: `现有 DialogContent closeLabel/closeDisabled`
- Produces: 启用关闭按钮时标题不会与右上角按钮重叠；禁用按钮不能关闭

**Behavior:**

- 启用关闭按钮时标题不会与右上角按钮重叠；禁用按钮不能关闭。

**Stop Conditions:**

- 如果出现未识别的关闭保护或文件归属冲突，先修正范围和契约再继续。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/core/dialog-close.browser.test.tsx`

Expected: 目标检查退出码为 0，且保留关闭、禁用、标题避让与草稿保护行为。

### Task 2: 补齐两端缺失关闭入口

**Files:**

- Modify: `apps/web/src/features/projects/components/project-create-dialog.tsx`
- Modify: `apps/web/src/features/projects/components/project-directory-picker-dialog.tsx`
- Modify: `apps/web/src/features/settings/components/personalization-settings-panel.tsx`
- Modify: `apps/web/src/features/workbench/components/composer-branch-switcher.tsx`
- Modify: `apps/web/src/features/workbench/components/create-branch-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/components/create-branch-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/create-worktree-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/components/create-worktree-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/host-attachment-picker-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/project-file-mutation-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/project-remove-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/project-rename-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/project-todo-controls.tsx`
- Modify: `apps/web/src/features/workbench/components/task-delete-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/task-rename-dialog.tsx`
- Modify: `apps/web/src/shared/components/core/popover.tsx`
- Modify: `desktop/src/features/projects/components/project-create-dialog.browser.test.tsx`
- Modify: `desktop/src/features/projects/components/project-create-dialog.tsx`
- Modify: `desktop/src/features/projects/components/project-directory-picker-dialog.tsx`
- Modify: `desktop/src/features/settings/components/personalization-settings-panel.tsx`
- Modify: `desktop/src/features/settings/components/saved-prompts.browser.test.tsx`
- Modify: `desktop/src/features/workbench/components/composer-branch-switcher.tsx`
- Modify: `desktop/src/features/workbench/components/create-branch-dialog.tsx`
- Modify: `desktop/src/features/workbench/components/create-worktree-dialog.tsx`
- Modify: `desktop/src/features/workbench/components/host-attachment-picker-dialog.tsx`
- Modify: `desktop/src/features/workbench/components/project-draft-confirm.tsx`
- Modify: `desktop/src/features/workbench/components/project-draft-list-content.tsx`
- Modify: `desktop/src/features/workbench/components/project-file-mutation-dialog.tsx`
- Modify: `desktop/src/features/workbench/components/project-remove-dialog.tsx`
- Modify: `desktop/src/features/workbench/components/project-rename-dialog.tsx`
- Modify: `desktop/src/features/workbench/components/task-delete-dialog.tsx`
- Modify: `desktop/src/features/workbench/components/task-rename-dialog.tsx`
- Modify: `desktop/src/shared/components/core/popover.tsx`
- Modify: `packages/frontend-core/src/keyboard-shortcut-labels.ts`
- Modify: `packages/ui/src/core/composer-git-contracts.tsx`
- Modify: `packages/ui/src/core/composer-git-menu.tsx`
- Modify: `packages/ui/src/core/create-worktree-dialog.tsx`
- Modify: `packages/ui/src/core/extension-catalog.tsx`
- Modify: `packages/ui/src/core/git-remote-config-dialog.tsx`
- Modify: `packages/ui/src/core/git-remote-dialog.tsx`
- Modify: `packages/ui/src/core/keyboard-shortcuts-dialog.tsx`
- Modify: `packages/ui/src/core/new-project-dialog.tsx`
- Modify: `packages/ui/src/core/saved-prompts-copy.tsx`
- Modify: `packages/ui/src/core/saved-prompts-settings.tsx`
- Modify: `tests/e2e/app-shell-new-project.spec.ts`
- Modify: `tests/e2e/app-shell-saved-prompts.spec.ts`

**Interfaces:**

- Consumes: `DialogContent、PopoverClose、现有翻译与 pending 状态`
- Produces: 补齐所有缺失模态入口及草稿/待办浮层；关闭编辑器仍触发脏草稿保护

**Behavior:**

- 补齐所有缺失模态入口及草稿/待办浮层；关闭编辑器仍触发脏草稿保护。

**Stop Conditions:**

- 如果出现未识别的关闭保护或文件归属冲突，先修正范围和契约再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/create-branch-dialog.test.tsx apps/web/src/features/workbench/components/create-worktree-dialog.test.tsx apps/web/src/shared/components/core/ui-primitives.test.tsx`

Expected: 目标检查退出码为 0，且保留关闭、禁用、标题避让与草稿保护行为。

### Task 3: 完成全量扫描与跨端验证

**Files:**

- Modify: `.superwork/spec/ui/shared/index.md`

**Interfaces:**

- Consumes: `实现后的弹窗清单、运行时测试与共享规范`
- Produces: 生产模态弹窗均具备明确的右上角关闭入口；两端验证通过并记录范围

**Behavior:**

- 生产模态弹窗均具备明确的右上角关闭入口；两端验证通过并记录范围。

**Stop Conditions:**

- 如果出现未识别的关闭保护或文件归属冲突，先修正范围和契约再继续。

- [x] **Task Status:** completed

Run: `pnpm typecheck`

Expected: 目标检查退出码为 0，且保留关闭、禁用、标题避让与草稿保护行为。

## Verification Evidence

- Task 1: Chromium / WebKit、375 / 960px 共 4 个用例先因文本与关闭按钮重叠失败；统一标题/描述避让后全部通过（2026-10-27 当前工作区）。同时覆盖 pending 禁用、Escape 保护、显式关闭及焦点恢复。

- Task 2: 分支与 worktree 原用例先因缺少 dialog-close 失败；接入后 17 项用例通过。桌面 Chromium / WebKit 的通用弹窗、提示词、项目创建、附件选择、快捷键和 Git 分支套件共 26 项通过；两端类型检查通过。

## Final Verification

- 覆盖清单：共享 UI 11、Web 18、桌面 18，共 47 处生产模态内容均使用通用 Dialog 并具有右上角关闭入口。此次补齐 27 个文件中的 29 处缺失入口，另补齐 Web 待办与桌面草稿 2 处 Popover 关闭入口。
- 保留已有 PDF、图片、源码、子代理输出、全局搜索、壁纸及更新说明弹窗工具栏的关闭布局；Sheet 使用其现有通用关闭按钮。
- Simplification: `no-change`。使用共享 DialogContent 配置与已有平台翻译适配；保留现有 Popover 包装结构，不扩展为无关重构。
- Spec: `update`，更新 `.superwork/spec/ui/shared/index.md`，明确模态关闭、提交锁、脏草稿、标题避让与浮层关闭约定。未采纳自动分类器误判的 core/frontend 新目录。
- 新鲜验证：两端 TypeScript、根 lint / lint:architecture、桌面 check:web 全部成功。check:web 包含 162 文件 / 639 单元测试、源码行数、原生接口静态约束、现代 / Legacy 构建及包体预算；未修改 Rust 逻辑，未运行 Rust 构建与系统集成。
- 相关根前端测试：163 文件 / 987 测试通过。随后只有两个文件选择器标题栏的样式避让调整，最终状态由下列跨端浏览器回归与构建覆盖。
- Web：`pnpm exec playwright test tests/e2e/app-shell-new-project.spec.ts tests/e2e/app-shell-keyboard-shortcuts.spec.ts tests/e2e/app-shell-settings-projects.spec.ts tests/e2e/app-shell-composer-git.spec.ts tests/e2e/app-shell-composer-attachments.spec.ts tests/e2e/app-shell-inspector-projects.spec.ts tests/e2e/settings-personalization.spec.ts tests/e2e/app-shell-project-todos.spec.ts tests/e2e/app-shell-archived-tasks.spec.ts tests/e2e/app-shell-saved-prompts.spec.ts --workers=3`，66 通过，含 Chromium / Firefox / WebKit 和宽窄屏。
- 桌面：`pnpm --dir desktop test:browser`，198 文件 / 714 测试通过，覆盖 Chromium / WebKit。
- 根 `pnpm build` 与 `pnpm bundle:check` 成功；保留 dependency-cruiser 对 `packages/server/src/sqlite-journal.d.ts` 的既有 no-orphans 警告（0 errors）。
- 新增通用浏览器回归验证真实文本行盒与按钮不重叠，并覆盖 pending、Escape、显式关闭及触发器焦点恢复。提示词与嵌套项目选择器原测试已改为实际点击右上角关闭。
- 原发布计划和本会话前序归档修复均予以保留；没有执行提交、发布或部署。
