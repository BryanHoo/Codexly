# Feature Implementation Plan

**Goal:** 启用 React Hook 与 JSX 无障碍静态检查，并为 macOS 平台增加轻量 smoke CI。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束统一质量门禁与验证命令。
- `.superwork/spec/frontend/hook-guidelines.md` — 约束 Hook 副作用、依赖与清理行为。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束前端静态检查与无障碍质量。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束目录选择、宿主打开和平台 Runtime 行为。

**Architecture:** 在根 ESLint flat config 中仅对 Web TypeScript/TSX 启用 React Hook 与 JSX 无障碍规则；在现有 CI 旁新增独立 macOS smoke job，安装 Darwin 依赖后运行平台相关测试，不重复完整浏览器 E2E。

**Tech Stack:** ESLint 10、TypeScript、React、Vitest、pnpm、GitHub Actions。

## Global Constraints

- 保留 `pnpm check` 作为本地与 CI 的统一完整质量门禁。
- 使用根 `pnpm-workspace.yaml` catalog 固定共享依赖版本，并保持 `strictPeerDependencies: true`。
- macOS job 必须轻量、独立，且不得引入 GUI 交互或启动开发服务器。

### Task 1: 启用 React Hook 与 JSX 无障碍规则

**Files:**

- Modify: `eslint.config.mjs`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/src/features/conversation/runtime/use-task-runtime.ts`
- Modify: `apps/web/src/features/diff/file-diff-dialog.tsx`
- Modify: `apps/web/src/features/diff/file-review-dialog.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/pending-request.tsx`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/project-remove-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/project-rename-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/project-source-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/prompt-skill-editor.tsx`
- Modify: `apps/web/src/features/workbench/components/subagent-output-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/task-rename-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-panel-resizer.tsx`
- Modify: `apps/web/src/features/workbench/hooks/use-background-terminals.ts`
- Modify: `apps/web/src/features/workbench/hooks/use-workbench-composer-controller.ts`
- Modify: `apps/web/src/shared/ai-elements/code-comments.tsx`
- Modify: `apps/web/src/shared/ai-elements/file-tree.tsx`
- Modify: `apps/web/src/shared/ai-elements/prompt-input.tsx`
- Test: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`
- Test: `apps/web/src/features/settings/components/global-settings-dialog.test.tsx`

**Interfaces:**

- Consumes: ESLint 10 flat config、`apps/web/**/*.{ts,tsx}`、pnpm catalog。
- Produces: `react-hooks/rules-of-hooks`、`react-hooks/exhaustive-deps` 与 `eslint-plugin-jsx-a11y` 推荐规则门禁。

**Behavior:**

- 将 Hook 调用约束、依赖完整性和基础 JSX 无障碍问题纳入 `pnpm run lint`，规则只应用于 Web React 源码。
- 修复新增规则发现的真实 Hook 与 ARIA 问题；对原生 Dialog backdrop、焦点管理和仅阻止事件冒泡等明确意图使用局部说明，不全局关闭推荐规则。

**Stop Conditions:**

- Stop if `eslint-plugin-jsx-a11y` 无法在项目的严格 peer dependency 策略下与 ESLint 10 安装或执行。
- Stop if 修复规则诊断需要改变现有产品交互或可访问性契约。

- [x] **Task Status:** completed

Run: `pnpm run lint`

Expected: ESLint 以零错误、零警告退出，并实际加载两个新增插件的规则。

### Task 2: 增加 macOS smoke CI

**Files:**

- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: GitHub Actions `macos-latest` runner、pnpm frozen lockfile、平台相关 Vitest 测试。
- Produces: 独立 `macOS smoke` CI job。

**Behavior:**

- 在 macOS runner 上验证目录选择、系统浏览器、宿主应用集成和 Codex Darwin 二进制解析，不重复完整 E2E job。

**Stop Conditions:**

- Stop if 目标测试依赖交互式 GUI、真实用户目录或未声明的本机应用。
- Stop if smoke 命令不能在当前 macOS 开发环境中独立通过。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run src/system-directory-picker.test.ts src/system-browser.test.ts packages/server/src/project-open.test.ts packages/provider-codex/src/binary.test.ts`

Expected: 所有平台 smoke 测试在 macOS 上通过，且 Darwin 条件测试未被跳过。
