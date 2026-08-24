# Feature Implementation Plan

**Goal:** 将 Composer 的模型与思考量原生下拉框改造成接近 Codex 官方交互的统一两级选择器，并保持现有设置与提交协议不变。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束项目命令、依赖边界与完整验证。
- `.superwork/spec/frontend/component-guidelines.md` — 约束共享基础组件、Composer 控件、可访问性与设计 Token。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Vitest、Playwright、移动触控目标与视觉验证。
- `.superwork/spec/frontend/state-management.md` — 约束模型目录、Task 设置覆盖与本地交互状态边界。
- `.superwork/spec/frontend/type-safety.md` — 约束 `AgentModel` 协议类型和 View Model 边界。
- `.superwork/spec/shared/quality-guidelines.md` — 约束模型目录和 `AgentTaskSettings` 作为选择器真相源。

**Architecture:** 扩展现有项目 `DropdownMenu` 基础组件以支持可访问的两级菜单和尾部勾选指示器；新增独立 `ComposerModelSelector`，桌面端使用两级菜单，移动端使用单层 Dialog，并由 `AgentModel` 目录派生模型与思考量选项，通过现有 `onSettingsChange` 原子更新 Task 设置。Composer 只负责布局和接线，提交协议、模型回落规则及后端保持不变。

**Tech Stack:** TypeScript、React、Radix UI、Tailwind CSS、Lucide、i18next、Vitest、Playwright、pnpm。

## Global Constraints

- 一个紧凑触发器同时展示当前模型与本地化思考量；桌面保持紧凑，工作台窄屏触控高度不得小于 `44px`。
- 一级菜单只展示“模型”和“思考量”两行及当前值；选项只展示名称和当前勾选状态，不展示描述，并支持键盘、Escape、外部点击和视口碰撞处理。
- 模型切换继续使用 `resolveReasoningEffort()`：保留仍受支持的当前思考量，否则回落到目标模型默认值。
- 思考量只展示当前模型的 `supportedReasoningEfforts`，并使用本地化等级名称。
- 复用现有 `AgentModel`、`AgentTaskSettings`、设计 Token、i18n 和 Lucide，不新增依赖，不保留旧模型与思考量 `<select>` 路径。
- 不启动开发服务器。

### Task 1: 扩展两级菜单基础能力

**Files:**

- Modify: `apps/web/src/shared/components/core/dropdown-menu.tsx`
- Test: `apps/web/src/shared/components/core/ui-primitives.test.tsx`

**Interfaces:**

- Consumes: 现有 `DropdownMenu` Radix 封装和项目视觉 Token。
- Produces: `DropdownMenuSub`、`DropdownMenuSubTrigger`、`DropdownMenuSubContent`，以及可配置尾部勾选指示器的 `DropdownMenuRadioItem`。

**Behavior:**

- 提供可组合、可键盘导航、可脱离裁剪容器并自动避让视口的两级菜单；现有分支单选菜单保持默认圆点样式，新调用方可显式使用尾部勾选样式。

**Stop Conditions:**

- 如果当前锁定的 `radix-ui` 不提供 Submenu 或 Radio ItemIndicator 能力，则停止并改为评估共享 Dialog，不直接在 Feature 中绕过项目基础组件。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/components/core/ui-primitives.test.tsx`

Expected: 现有基础组件测试与新增两级菜单、尾部勾选语义测试全部通过。

### Task 2: 实现并接入模型与思考量选择器

**Files:**

- Create: `apps/web/src/features/workbench/components/composer-model-selector.tsx`
- Test: `apps/web/src/features/workbench/components/composer-model-selector.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Test: `apps/web/src/i18n/resources.test.ts`

**Interfaces:**

- Consumes: `AgentModel[]`、当前 `AgentTaskSettings`、`selectedModel`、`selectedReasoningEffort`、`resolveReasoningEffort()`、`onSettingsChange()`。
- Produces: `ComposerModelSelector` 统一触发器、模型二级菜单、思考量二级菜单和原子设置更新。

**Behavior:**

- 用一个触发器替换两个原生下拉框；选择模型时同步解析有效思考量，选择思考量时只更新该字段；加载、无模型和禁用状态均提供明确可访问状态。

**Stop Conditions:**

- 如果现有 `WorkbenchComposerViewProps` 无法提供完整模型目录或设置更新入口，或统一触发器无法在 `320px` Composer 单行内稳定布局，则停止并报告接口或布局阻塞。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/composer-model-selector.test.tsx apps/web/src/features/workbench/components/workbench-composer-view.test.tsx apps/web/src/i18n/resources.test.ts`

Expected: 触发器展示、模型回落、思考量更新、禁用状态与中英文资源对齐测试全部通过。

### Task 3: 更新浏览器流程与稳定规范

**Files:**

- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: 新 `ComposerModelSelector` 可访问名称和现有 Turn 请求捕获。
- Produces: 桌面两级菜单、移动端 Dialog、提交参数与窄屏无溢出的回归证据，以及稳定 Composer 选择器规范。

**Behavior:**

- Playwright 在桌面端通过一级菜单分别打开模型与思考量二级菜单并选择 `gpt-5.6-terra + low`，在 `320px` 移动端验证 Dialog 边界和模型切换，同时验证触发器摘要、支持项和最终 Turn `options`；规范记录模型目录、回落与移动触控要求。

**Stop Conditions:**

- `320px` 窄屏固定使用共享 Dialog，避免依赖 Radix 二级菜单的横向碰撞行为。

- [x] **Task Status:** completed

Run: `pnpm build && pnpm exec playwright test tests/e2e/app-shell-composer.spec.ts --grep "submits host attachments, approval policy, model, and reasoning effort"`

Expected: 模型与思考量两级选择、触发器摘要、附件与模式组合提交的完整浏览器流程通过。

### Task 4: 执行完整质量门禁

**Files:**

- Verify: `apps/web/src/features/workbench/components/composer-model-selector.tsx`
- Verify: `apps/web/src/shared/components/core/dropdown-menu.tsx`
- Verify: `tests/e2e/app-shell-composer.spec.ts`

**Interfaces:**

- Consumes: 已实现的两级菜单、选择器、测试与规范。
- Produces: 类型、格式、Lint、架构、单元、构建、包与完整浏览器验证证据。

**Behavior:**

- 执行项目完整门禁，确认新选择器不引入协议、打包、依赖边界、桌面或移动工作台回归。

**Stop Conditions:**

- 如果 `pnpm check` 或 `pnpm test:e2e` 出现与本改动无关且无法安全修复的既有失败，则保留失败证据并停止最终交付判定。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 类型、格式、Lint、架构、单元、性能、构建、安全审计、包检查与全部 Playwright 流程通过。
