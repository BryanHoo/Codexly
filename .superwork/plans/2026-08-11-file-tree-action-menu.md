# File Tree Action Menu Implementation Plan

**Goal:** 将右栏文件树的三点菜单与右键菜单统一为“复制名称 / 复制路径 / 打开 / 引用”操作，并让引用直接写入当前 Composer 草稿。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束项目命令、复用边界与验证要求
- `.superwork/spec/frontend/component-guidelines.md` — 约束文件树菜单、Radix 菜单原语和 Composer 交互
- `.superwork/spec/frontend/state-management.md` — 约束 Composer 草稿按 Project/Task 保存
- `.superwork/spec/frontend/quality-guidelines.md` — 约束组件测试、E2E 和可访问性验证

**Architecture:** 复用一份文件树目标菜单行为，通过 Dropdown Menu 与 Context Menu 各自的 Radix 原语渲染相同命令；用 `WorkbenchComposerHandle` 把 Inspector 的引用动作接入当前 Composer，并复用现有文件引用 Token 与草稿状态逻辑。

**Tech Stack:** React 19、TypeScript、Radix UI、Vitest、Playwright、i18next

## Global Constraints

- 保持文件名、相对路径和动态运行时文本原样展示。
- 文件与目录共用菜单；只有文件的“打开”二级菜单展示系统默认应用。
- 复制名称与复制路径使用 Clipboard API；引用使用现有 `ProjectFileSearchEntry` Token 语义。
- 不保留旧的“打开方式 + 路径”顶层菜单结构。

### Task 1: 统一文件树目标菜单

**Files:**

- Modify: `apps/web/src/shared/components/core/context-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`

**Interfaces:**

- Consumes: `ProjectOpenContextMenuTarget`, `ProjectOpenApp[]`, Radix Context Menu / Dropdown Menu primitives
- Produces: 两个入口共享的复制、打开、引用菜单行为和可访问名称

**Behavior:**

- 顶层固定显示“复制名称”“复制路径”“打开”“引用”；仅打开使用二级菜单并保持当前应用列表及文件/目录过滤规则，两个入口使用相同文案、图标和回调。

**Stop Conditions:**

- 如果 Context Menu 原语无法提供与 Dropdown Menu 对等的级联菜单键盘行为，则停止并调整共享组件边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-open-menu.test.tsx`

Expected: 新菜单结构、目标过滤和回调测试通过。

### Task 2: 将引用动作接入当前 Composer

**Files:**

- Modify: `apps/web/src/features/workbench/components/prompt-skill-content.ts`
- Modify: `apps/web/src/features/workbench/components/prompt-skill-content.test.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-active-task.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-file-tree.tsx`

**Interfaces:**

- Consumes: `WorkbenchComposerHandle`, `PromptSkillContent`, `ProjectFileSearchEntry`, Inspector 文件树目标
- Produces: `referenceProjectPath(file)` 命令，将目标作为现有 `@path` Token 追加到当前草稿并聚焦输入框

**Behavior:**

- 点击文件或目录的“引用”后，关闭菜单并在当前 Project/Task Composer 光标尾部追加去重的文件引用 Token；已有草稿和附件保持不变。

**Stop Conditions:**

- 如果当前路由不存在已挂载 Composer，引用命令必须无副作用，不能写入其他 Project/Task 草稿。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/prompt-skill-content.test.ts apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: Token 追加/去重和 Inspector 菜单接线测试通过。

### Task 3: 覆盖完整菜单用户流程

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `tests/e2e/app-shell-composer.spec.ts`

**Interfaces:**

- Consumes: 文件树三点按钮、右键菜单、浏览器 Clipboard API、Composer 文本框
- Produces: 文件/目录复制、打开与引用的可观察浏览器回归证据

**Behavior:**

- 验证三点与右键入口展示同一菜单；复制名称/路径直接写入剪贴板，打开二级继续发起原应用请求，引用文件和目录均在 Composer 显示对应 Token。

**Stop Conditions:**

- 如果 Playwright 环境未授予 Clipboard 权限，则使用浏览器上下文权限或对写入调用做可观察断言，不降低产品行为。

- [x] **Task Status:** completed

Run: `pnpm build && pnpm exec playwright test tests/e2e/app-shell-composer.spec.ts --grep "project file tree context menu"`

Expected: 文件树菜单完整流程测试通过。
