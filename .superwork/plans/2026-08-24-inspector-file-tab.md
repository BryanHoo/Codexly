# Feature Implementation Plan

**Goal:** 仅将 Timeline 流式文件引用渲染到右栏按需出现的文件标签中，Inspector“项目”文件树的可预览文件继续使用 Dialog，不可预览格式继续交给系统默认应用。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束项目命令、文件长度和完整验证要求。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector 标签、受控文件预览、共享组件和浏览器回归。
- `.superwork/spec/frontend/state-management.md` — 约束路由作用域状态、按需挂载和查询激活边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Vitest、Playwright、可访问性和响应式验证。

**Architecture:** 保留现有文件类型分类和 Server 受控读取接口；Timeline 的源码/图片选择使用 Inspector 文件标签状态，Inspector“项目”文件树的源码/图片选择使用独立 Dialog 状态。文件标签仅在 Timeline 存在选择时加入，关闭后清理选择与查询；不可预览格式继续复用 `system-default` Mutation。

**Tech Stack:** TypeScript、React、TanStack Query、Tailwind CSS、Vitest、Playwright、pnpm。

## Global Constraints

- 保持项目内代码文件不超过 500 行，关键状态和分流逻辑添加简短中文注释。
- 复用现有 `Button`、`Tooltip`、Inspector 标签和受控文件接口，不引入新依赖；按入口隔离 Timeline 文件标签状态与 Inspector“项目”文件 Dialog 状态。
- 临时 Task 与普通 Project 使用同一文件标签语义，但临时 Task 未选择文件时继续直接显示上下文。
- 不可预览文件不得挂载文件标签或预览查询，必须继续使用 `system-default`。

### Task 1: 定义文件标签激活与关闭契约

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-inspector-tabs.tsx`
- Modify: `apps/web/src/features/workbench/workbench-inspector-activation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-tabs.test.tsx`
- Modify: `apps/web/src/features/workbench/workbench-inspector-activation.test.ts`

**Interfaces:**

- Consumes: `WorkbenchInspectorTab`、当前 Task/Git/临时作用域和可空文件选择。
- Produces: 仅在文件已选择时可用的 `file` 标签、文件标签关闭动作和唯一活动面板状态。

**Behavior:**

- 验证普通 Inspector 仅在选择文件后追加“文件”标签并可激活；临时 Inspector 选择文件后显示“上下文/文件”；关闭文件标签后文件能力消失并回落到既有有效标签。

**Stop Conditions:**

- 如果现有 Inspector 标签类型被跨包协议或持久化状态消费，停止并重新评估状态归属。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/workbench-inspector-activation.test.ts apps/web/src/features/workbench/components/workbench-inspector-tabs.test.tsx`

Expected: 文件标签可用性、激活、临时作用域和关闭入口测试通过。

### Task 2: 按入口来源复用受控文件预览

**Files:**

- Create: `apps/web/src/features/workbench/components/project-source-panel.tsx`
- Create: `apps/web/src/features/workbench/components/project-source-panel.test.tsx`
- Modify: `apps/web/src/features/workbench/components/project-source-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-dialogs.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-tabs.test.tsx`
- Modify: `apps/web/src/shared/components/agent/lazy-message-response.test.tsx`

**Interfaces:**

- Consumes: `MessageFileReference`、`classifyProjectFileReference`、`readProjectSourceFile`、`buildProjectImageFileUrl` 和 Inspector 作用域状态。
- Produces: 按当前文件选择挂载的共享 `ProjectSourcePanel`、Timeline 文件标签行为和 Inspector“项目”文件 Dialog 行为。

**Behavior:**

- 点击 Timeline 中的可预览源码或图片时同步打开 Inspector、切换到“文件”并只挂载当前选择；点击 Inspector“项目”文件树中的可预览源码或图片时打开独立 Dialog，且不切换当前 Inspector 标签。Markdown、分页、行定位、图片错误和复制能力由共享面板提供。

**Stop Conditions:**

- 如果受控源文件或图片接口只能在 Dialog 生命周期内使用，停止并补充接口生命周期证据后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-inspector-tabs.test.tsx apps/web/src/shared/components/agent/lazy-message-response.test.tsx`

Expected: Timeline 文件面板和 Inspector“项目”文件 Dialog 均按需渲染，Markdown 仍保持按需加载。

### Task 3: 更新文案、规范与浏览器回归

**Files:**

- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `tests/e2e/app-shell-composer-review.spec.ts`
- Modify: `tests/e2e/app-shell-temporary.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: Inspector 标签与文件面板的可访问名称、现有 E2E API fixture 和双语 i18n 资源。
- Produces: 双语“文件/关闭文件”界面契约、普通与临时工作台回归证据及更新后的持久规范。

**Behavior:**

- 验证流式文件引用在右栏显示并可被下一文件替换，关闭后标签消失；项目文件树可预览文件继续使用 Dialog；Office/PDF/归档等仍只触发系统默认打开且不创建文件标签。

**Stop Conditions:**

- 如果现有 E2E fixture 无法同时提供源码与图片受控响应，停止并仅扩充同一 fixture，不创建旁路 mock 服务。

- [x] **Task Status:** completed

Run: `pnpm build && pnpm exec playwright test tests/e2e/app-shell-composer-review.spec.ts tests/e2e/app-shell-temporary.spec.ts`

Expected: 普通 Project 和临时 Task 的 Timeline 文件标签、项目文件 Dialog、替换、关闭及系统默认打开链路全部通过。
