# Feature Implementation Plan

**Goal:** 让 CodeAgent 当前设计系统成为共享 UI 的唯一视觉标准，shadcn/Radix 只提供组件结构、行为和可访问性能力。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束仓库验证命令和包管理方式。
- `.superwork/spec/frontend/component-guidelines.md` — 约束共享 UI、设计 Token、可访问性和移动端视觉契约。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Vitest、Playwright、320px 视口和触控目标验证。
- `.superwork/spec/frontend/directory-structure.md` — 约束 shadcn 基础组件固定归属 `src/shared/ui`。

**Architecture:** 保留 `--ui-*` 为唯一视觉真值，将 shadcn 语义 Token 单向映射到项目 Token；由 `shared/ui` 为普通控件提供完整项目默认样式和显式变体，Feature 仅组合组件并提供业务布局；上游 shadcn 更新只通过 `--dry-run`/`--diff` 吸收行为变化。

**Tech Stack:** React 19、TypeScript、Tailwind CSS 4、shadcn/ui、Radix UI、class-variance-authority、Vitest、Playwright、pnpm。

## Global Constraints

- 保持当前浅色、深色、紧凑工作台、品牌蓝色、透明 ink 控件层和低对比分隔的视觉结果，不引入 shadcn 默认主题。
- `accent` 只表达中性悬停或选中状态，品牌主操作统一使用 `primary`，不得继续复用同名 Token 表达两种语义。
- 普通 `Button`、`Input` 和 `Textarea` 必须无需 Feature 补充视觉 class 即可正确显示；嵌入式或特殊控件必须使用显式项目变体。
- 保留 Radix 的 Portal、焦点、键盘、ARIA、Escape、碰撞检测和状态管理能力。
- 移动端保持 `320px` 无溢出和主要操作至少 `44px` 触控目标，不启动开发服务器。

### Task 1: 收敛品牌色与中性状态 Token

**Files:**

- Modify: `apps/web/src/shared/styles/globals.css`
- Modify: `apps/web/src/shared/ui/ui-primitives.test.tsx`
- Modify: `apps/web/src/app/routes/not-found.tsx`
- Modify: `apps/web/src/shared/ui/runtime-unavailable.tsx`
- Modify: `apps/web/src/features/access/pairing-gate.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-sections.tsx`
- Modify: `apps/web/src/shared/ai-elements/confirmation.tsx`
- Test: `apps/web/src/shared/ui/ui-primitives.test.tsx`

**Interfaces:**

- Consumes: 现有 `--ui-color-accent`、`--ui-color-control-hover` 和 shadcn 语义 Token。
- Produces: 单义的 `primary`、`accent`、`brand` Tailwind 颜色契约。

**Behavior:**

- 让 `bg-primary` 表达品牌主操作、`bg-accent` 表达中性悬停或选中，并迁移现有品牌色调用，保持用户可见颜色不变。

**Stop Conditions:**

- 如果同一现有调用无法从上下文判断是品牌主操作还是中性状态，则停止该调用迁移并先补充可观察样式证据。

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/shared/ui/ui-primitives.test.tsx`

Expected: Token 契约与共享 UI 结构测试通过，源代码不再用 `bg-accent` 表达品牌主操作。

### Task 2: 完整化项目基础控件视觉契约

**Files:**

- Modify: `apps/web/src/shared/ui/button.tsx`
- Modify: `apps/web/src/shared/ui/input.tsx`
- Modify: `apps/web/src/shared/ui/textarea.tsx`
- Modify: `apps/web/src/shared/ui/input-group.tsx`
- Modify: `apps/web/src/shared/ui/ui-primitives.test.tsx`
- Test: `apps/web/src/shared/ui/ui-primitives.test.tsx`

**Interfaces:**

- Consumes: `buttonVariants`、`Input`、`Textarea`、`InputGroupTextarea` 和 Task 1 的语义颜色。
- Produces: 带完整项目默认样式、显式 `variant`/`size` 与稳定 `data-slot` 的基础控件契约。

**Behavior:**

- 普通 Button/Input/Textarea 不依赖调用方视觉 class 即拥有当前项目的尺寸、字体、颜色、圆角、焦点和禁用状态；嵌入式输入通过显式变体复用同一行为组件。

**Stop Conditions:**

- 如果新增默认样式无法通过现有项目 Token 表达，或会改变 Radix/原生控件语义，则停止并收敛 Token 或组件接口后再继续。

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/shared/ui/ui-primitives.test.tsx`

Expected: 默认、ghost、outline、icon、普通输入和嵌入式输入的项目视觉 class 契约测试通过。

### Task 3: 迁移业务调用方到显式组件契约

**Files:**

- Modify: `apps/web/src/shared/ui/button.tsx`
- Modify: `apps/web/src/features/access/pairing-gate.tsx`
- Modify: `apps/web/src/features/provider-connection/components/provider-connection-panel.tsx`
- Modify: `apps/web/src/features/workbench/components/pending-request.tsx`
- Modify: `apps/web/src/features/workbench/components/project-rename-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/task-rename-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-dialog.tsx`
- Modify: `apps/web/src/shared/ai-elements/confirmation.tsx`
- Modify: `apps/web/src/shared/ai-elements/prompt-input-controls.tsx`
- Modify: `apps/web/src/shared/ui/runtime-unavailable.tsx`
- Modify: `apps/web/src/shared/ui/ui-primitives.test.tsx`
- Test: `apps/web/src/features/access/pairing-gate.test.tsx`
- Test: `apps/web/src/features/provider-connection/components/provider-connection-panel.test.tsx`
- Test: `apps/web/src/features/workbench/components/pending-request.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`

**Interfaces:**

- Consumes: Task 2 的 `ButtonProps`、`InputProps`、`TextareaProps` 和项目变体。
- Produces: 不再依赖空 shadcn 默认样式的业务调用，以及布局 class 与视觉 variant 分离的组件组合。

**Behavior:**

- 将普通按钮和表单改用项目默认或显式 variant，将包裹在复合控件内的输入改用嵌入式 variant，并将隐藏表单值恢复为原生隐藏 input；保持现有业务行为和视觉结果。

**Stop Conditions:**

- 如果迁移会改变 Composer DOM 身份、IME、焦点恢复、Mutation 单飞或移动触控目标，则停止对应调用并保留专用 DOM 契约，先增加回归测试。

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/features/access/pairing-gate.test.tsx apps/web/src/features/provider-connection/components/provider-connection-panel.test.tsx apps/web/src/features/workbench/components/pending-request.test.tsx apps/web/src/features/workbench/components/workbench-composer-view.test.tsx apps/web/src/shared/ui/ui-primitives.test.tsx`

Expected: 迁移范围的交互测试通过，隐藏输入、表单、按钮和 Composer 行为保持不变。

### Task 4: 固化共享 UI 规则并验证浏览器视觉边界

**Files:**

- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `tests/e2e/app-shell-settings-navigation.spec.ts`
- Modify: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Test: `tests/e2e/app-shell-settings-navigation.spec.ts`
- Test: `tests/e2e/app-shell-inspector-layout.spec.ts`

**Interfaces:**

- Consumes: 完成后的项目 Token、共享 UI 默认样式和现有 Playwright App Shell fixture。
- Produces: 可执行的视觉契约、浅深主题 computed style 断言和移动端边界证据。

**Behavior:**

- 规范明确 shadcn/Radix 只提供功能、`shared/ui` 独占视觉，Feature `className` 只承担布局；浏览器测试验证品牌主操作、中性状态、表单控件以及 `320px` 视口不回归。

**Stop Conditions:**

- 如果现有 E2E fixture 无法稳定定位基础控件或切换主题，则停止新增脆弱断言，改用已有稳定用户入口或测试专用语义定位。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全量质量门禁和跨浏览器用户流程通过，项目样式契约由单一 Token 与共享 UI 层稳定承担。
