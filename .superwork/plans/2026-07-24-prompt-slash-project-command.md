# Prompt Slash Project Command Implementation Plan

**Goal:** 在现有 AI Elements Composer 中实现官方风格的 `/` 命令菜单，并提供纯前端“选择项目”流程；选择结果只用于界面展示，不切换路由、不改变 Turn 提交目标，也不新增后端连接。

**Affected Packages:** `@code-agent/web`

**Protocol Changes:** 无。

**Migration / Deletion Scope:** 删除被命令状态机取代的零散菜单判断；不保留旧命令入口或后端占位接口。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md`
- `.agents/skills/ai-elements/references/prompt-input.md`
- `.agents/skills/ai-elements/scripts/prompt-input-cursor.tsx`

## Global Constraints

- 使用项目内 AI Elements `PromptInputCommand*` 组合能力承载命令与项目列表。
- `/` 命令只在输入框起始命令片段中生效；IME 输入期间不得误选或提交。
- 支持鼠标、上下方向键、Enter 和 Escape，并提供 listbox/option 可访问语义。
- “选择项目”完成后只更新 Composer 本地展示，不导航、不改变 `startPromptTurn` 使用的 `projectId`。
- 保留现有附件、提交、失败重试、模型、审批和思考量行为。
- 关键状态转换添加简短、清晰的中文注释。

### Task 1: 定义命令状态与 AI Elements 命令组合

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/features/workbench/components/prompt-command.ts`
- Create: `apps/web/src/features/workbench/components/prompt-command.test.ts`
- Modify: `apps/web/src/shared/ai-elements/prompt-input.tsx`
- Modify: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`

**Behavior Slice:** 解析起始 `/` 查询并在命令、项目两个层级间转换；AI Elements 命令列表暴露可访问结构、选中态和统一视觉。

**Verification:** `pnpm exec vitest run apps/web/src/features/workbench/components/prompt-command.test.ts apps/web/src/shared/ai-elements/ai-elements.test.tsx`

### Task 2: 接入 Composer 的项目选择交互

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`

**Behavior Slice:** 输入 `/` 显示“选择项目”，选择后进入项目列表；选择项目后显示本地项目标签并恢复输入焦点，且不会触发表单提交或修改真实 Turn 项目。

**Verification:** `pnpm exec vitest run apps/web/src/features/workbench/components/prompt-command.test.ts apps/web/src/features/workbench/components/workbench-composer.test.tsx apps/web/src/shared/ai-elements/ai-elements.test.tsx`

### Task 3: 浏览器验证与稳定规范

- [ ] **Task Status:** pending

**Verification Blocker:** 已新增浏览器覆盖，但本机 Playwright Chromium 可执行文件缺失；浏览器下载无输出并停滞，系统 Chrome 在 Playwright headless 启动阶段立即关闭。`pnpm check` 已通过，待浏览器环境恢复后执行 `pnpm test:e2e`。

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Behavior Slice:** 浏览器验证 `/` 呼出、键盘/鼠标选择、Escape、窄屏布局和无后端副作用；规范记录稳定的命令菜单交互边界。

**Verification:** `pnpm check` then `pnpm test:e2e`

**Completion Evidence:** 目标 Vitest、`pnpm check` 与 Playwright E2E 全部退出 0；桌面和窄屏无横向溢出或控制台错误。
