# Feature Implementation Plan

**Goal:** 将右栏重命名为运行环境，并让项目标签中的文件树以可右键操作的项目根文件夹开头。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector 文件树和右键菜单行为
- `.superwork/spec/frontend/quality-guidelines.md` — 约束组件测试与用户流程验证
- `docs/web-design.md` — 约束工作台右栏的视觉与交互一致性

**Architecture:** 保留现有文件树查询和路径契约，在 Inspector 内增加仅用于展示与展开的根节点标识；根节点复用现有项目打开右键菜单，子节点继续使用相对路径。

**Tech Stack:** React、TypeScript、i18next、Vitest、Playwright

## Global Constraints

- 保留代码标识符和路径原文；中文、英文资源必须同步更新。
- 根节点展开状态不得进入项目文件查询路径集合。
- 不启动开发服务器。

### Task 1: 更新右栏文案与项目根树节点

**Files:**

- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

**Interfaces:**

- Consumes: `WorkbenchInspectorProps.projectName`、`WorkbenchInspectorProps.projectPath`、`ProjectOpenContextMenu`
- Produces: “运行环境”右栏、“项目”标签、以项目名称展示并支持右键菜单的根目录节点

**Behavior:**

- 移除文件树上方“项目文件”可见标题，在树内显示默认展开的项目根文件夹名称；根节点可展开或收起，右键菜单以项目绝对路径打开，子文件和目录行为保持不变。
- 将中文“项目检查器”改为“运行环境”、“变更”标签改为“项目”，并同步更新英文资源。

**Stop Conditions:**

- 若现有 `ProjectOpenContextMenu` 不支持项目绝对目录目标，停止并调整跨层接口计划。

- [x] **Task Status:** completed

Run: `pnpm --filter @codexly/web test --run apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: Inspector 组件测试覆盖新文案、根节点结构、展开状态和根节点右键菜单后通过。

### Task 2: 更新浏览器流程断言并完成全量验证

**Files:**

- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Modify: `tests/e2e/app-shell-settings-navigation.spec.ts`
- Test: `tests/e2e/app-shell-composer.spec.ts`
- Test: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Test: `tests/e2e/app-shell-settings-navigation.spec.ts`

**Interfaces:**

- Consumes: Inspector 的可访问名称和 `FileTree` 树节点语义
- Produces: 与新文案及项目根节点一致的浏览器回归断言

**Behavior:**

- 更新所有依赖旧右栏名称的定位器，并验证项目根节点在实际工作台文件树中可见且可通过右键打开菜单。

**Stop Conditions:**

- 若浏览器夹具没有可用的项目打开应用，保留组件级右键菜单验证并仅更新可访问名称断言。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 静态检查、单元测试和完整浏览器流程均通过。
