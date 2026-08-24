# Feature Implementation Plan

**Goal:** 引入与 Codexly 现有视觉体系一致的 shadcn 基础层，并统一 Button、Input、Tooltip、Dialog 的实现。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束仓库级验证与工程边界。
- `.superwork/spec/frontend/component-guidelines.md` — 约束共享 UI、Dialog、可访问性与工作台交互。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束前端测试、可访问性和性能验证。
- `docs/web-design.md` — 约束现有视觉 Token、紧凑工作台布局与响应式行为。

**Architecture:** 在 `apps/web/src/shared/ui` 建立项目拥有的 shadcn 组件源码，以统一语义 Token 适配现有 `--ui-*` 变量；业务层直接组合基础组件，删除手写 Tooltip 和原生 Dialog 生命周期逻辑。

**Tech Stack:** React 19、TypeScript、Tailwind CSS 4、shadcn/ui、Radix UI、Vitest、Playwright、pnpm workspace catalog。

## Global Constraints

- 保持 Codexly 白/近黑工作台、透明 ink 控件层、低对比分隔与蓝色主操作的既有设计，不套用 shadcn 默认视觉主题。
- 保持现有用户交互、i18n 文案、移动端视口边界、焦点恢复和 Escape/backdrop 关闭行为。
- 使用项目 `pnpm` catalog 管理新增依赖，不启动开发服务器。
- Button、Input、Tooltip、Dialog 的业务调用统一进入 `src/shared/ui`，不保留冗余旧实现。

### Task 1: 配置 shadcn 与设计 Token

**Files:**

- Create: `apps/web/components.json`
- Modify: `apps/web/package.json`
- Modify: `apps/web/tsconfig.app.json`
- Modify: `apps/web/src/shared/styles/globals.css`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: 现有 `--ui-color-*`、`--ui-radius-*`、`--ui-shadow-*` 设计变量和 Vite `@` alias。
- Produces: shadcn registry 配置、workspace catalog 依赖和 `background/primary/accent/muted/border/input/ring` 语义 Token。

**Behavior:**

- 建立可由 shadcn CLI 继续维护的配置，并将 shadcn Token 双向适配到现有 Codexly 设计体系，保证明暗主题和现有品牌色语义不变。

**Stop Conditions:**

- 如果当前 shadcn 依赖与 React 19、Tailwind CSS 4 或严格 peer 依赖不兼容，则停止并报告具体依赖冲突。

- [x] **Task Status:** completed

Run: `pnpm --filter @codexly/web build`

Expected: Web 构建通过，CSS Token 和 alias 均可解析。

### Task 2: 建立 shadcn 基础组件

**Files:**

- Create: `apps/web/src/shared/lib/utils.ts`
- Create: `apps/web/src/shared/ui/button.tsx`
- Create: `apps/web/src/shared/ui/input.tsx`
- Create: `apps/web/src/shared/ui/tooltip.tsx`
- Create: `apps/web/src/shared/ui/dialog.tsx`
- Create: `apps/web/src/shared/ui/ui-primitives.test.tsx`

**Interfaces:**

- Consumes: `cn`、Radix UI primitives、Task 1 的 shadcn 语义 Token。
- Produces: `Button`、`buttonVariants`、`Input`、`Tooltip` 组合组件和 `Dialog` 组合组件。

**Behavior:**

- 提供类型安全、可组合、带 `data-slot`、键盘可访问且符合现有紧凑尺寸和视觉状态的四类基础组件。

**Stop Conditions:**

- 如果基础组件无法保持现有 focus、disabled、portal 或 SSR 测试契约，则停止并先收敛组件 API。

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/shared/ui/ui-primitives.test.tsx`

Expected: 基础组件结构、变体和可访问属性测试通过。

### Task 3: 迁移 Button、Input 与 Tooltip 调用

**Files:**

- Modify: `apps/web/src/app/providers.tsx`
- Modify: `apps/web/src/app/providers.test.tsx`
- Modify: `apps/web/src/app/routes/not-found.tsx`
- Modify: `apps/web/src/app/routes/root-route.tsx`
- Modify: `apps/web/src/features/access/pairing-gate.tsx`
- Modify: `apps/web/src/features/access/pairing-gate.test.tsx`
- Modify: `apps/web/src/features/workbench/components/pending-request.tsx`
- Modify: `apps/web/src/features/workbench/components/pending-request.test.tsx`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.test.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`
- Modify: `apps/web/src/features/workbench/components/skill-token.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`
- Modify: `apps/web/src/shared/ai-elements/attachments.tsx`
- Modify: `apps/web/src/shared/ai-elements/code-block.tsx`
- Modify: `apps/web/src/shared/ai-elements/code-comments.tsx`
- Modify: `apps/web/src/shared/ai-elements/confirmation.tsx`
- Modify: `apps/web/src/shared/ai-elements/conversation.tsx`
- Modify: `apps/web/src/shared/ai-elements/file-tree.tsx`
- Modify: `apps/web/src/shared/ai-elements/message.tsx`
- Modify: `apps/web/src/shared/ai-elements/plan.tsx`
- Modify: `apps/web/src/shared/ai-elements/prompt-input.tsx`
- Modify: `apps/web/src/shared/ai-elements/terminal.tsx`
- Modify: `apps/web/src/shared/ai-elements/tool.tsx`
- Modify: `apps/web/src/shared/ui/runtime-unavailable.tsx`

**Interfaces:**

- Consumes: Task 2 的 `Button`、`Input`、`Tooltip` 与现有业务事件处理器。
- Produces: 无可见原生文本按钮、可见文本输入或手写 Tooltip 的非 Dialog 业务界面。

**Behavior:**

- 将非 Dialog 场景统一迁移到 shadcn 基础组件，同时保持按钮尺寸、tone、触摸目标、输入语义、提示内容和事件时机不变。

**Stop Conditions:**

- 如果迁移会改变 Composer DOM 身份、IME 行为、Mutation 单飞或列表键盘交互，则停止并保留对应专用 DOM 契约。

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/app/providers.test.tsx apps/web/src/features/access/pairing-gate.test.tsx apps/web/src/features/workbench/components/pending-request.test.tsx apps/web/src/features/workbench/components/project-open-menu.test.tsx apps/web/src/features/workbench/components/project-sidebar.test.tsx apps/web/src/features/workbench/components/task-timeline.test.tsx apps/web/src/features/workbench/components/workbench-composer-view.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx apps/web/src/shared/ai-elements/ai-elements.test.tsx`

Expected: 迁移范围内的组件与交互回归测试全部通过。

### Task 4: 迁移 Dialog 并删除旧 UI 实现

**Files:**

- Modify: `apps/web/src/features/diff/file-diff-dialog.tsx`
- Modify: `apps/web/src/features/diff/file-review-dialog.tsx`
- Modify: `apps/web/src/features/diff/file-review-dialog.test.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/components/message-image-attachment.tsx`
- Modify: `apps/web/src/features/workbench/components/project-remove-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/project-rename-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/project-source-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/subagent-output-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/task-rename-dialog.tsx`
- Modify: `apps/web/src/shared/ai-elements/context.tsx`
- Delete: `apps/web/src/shared/ui/icon-button.tsx`
- Modify: `apps/web/src/shared/styles/globals.css`
- Test: `tests/e2e/app-shell-composer.spec.ts`
- Test: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Test: `tests/e2e/app-shell-settings-navigation.spec.ts`

**Interfaces:**

- Consumes: Task 2 的 `Dialog`、`Button`、`Input`、`Tooltip` 组合组件和现有 open/onClose 状态。
- Produces: 由 Radix 管理 portal、焦点圈定、Escape、backdrop 和焦点恢复的全部应用 Dialog。

**Behavior:**

- 删除原生 `<dialog>` 的 `showModal`/ref 生命周期与手写 `IconButton` Tooltip，统一所有弹层及其操作控件，同时保持大尺寸 Diff、设置双栏、图片预览和移动端边界。

**Stop Conditions:**

- 如果任一 Dialog 的开放状态无法保持受控、关闭后无法恢复触发器焦点或移动端内容超出视口，则停止并修复该弹层后再继续。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全量质量门禁和浏览器用户流程全部通过，源代码中不再存在业务原生 `<dialog>` 或旧 `IconButton` 引用。
