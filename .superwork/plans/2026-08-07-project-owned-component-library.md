# Feature Implementation Plan

**Goal:** 将 Web 组件完整迁移为项目自有组件库，并移除 shadcn/ui 与 AI Elements 的依赖、配置、目录命名和调用边界。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束项目命令、验证和公共实现边界
- `.superwork/spec/frontend/directory-structure.md` — 定义 Web 共享组件归属与按需加载边界
- `.superwork/spec/frontend/component-guidelines.md` — 定义组件视觉、行为和可访问性契约
- `.superwork/spec/frontend/quality-guidelines.md` — 定义 Vitest、E2E、移动端和 Bundle 验证要求

**Architecture:** 将通用交互原语迁移到 `src/shared/components/core`，将 Agent 工作台复合组件迁移到 `src/shared/components/agent`；保留源码公开 API 和 Radix 等独立底层能力，但删除所有 shadcn/ui、AI Elements 配置和品牌边界，统一直接消费项目 Token。

**Tech Stack:** React 19、TypeScript、Tailwind CSS 4、Radix UI、Vitest、Playwright、pnpm

## Global Constraints

- 不保留 `shared/ui`、`shared/ai-elements`、`components.json` 或 `shadcn` 包依赖。
- Feature 只能从项目自有 `shared/components/**` 直接导入组件，不新增兼容导出层。
- 保留现有组件行为、公开 Props、按需加载、键盘与焦点管理能力。
- 视觉仅使用 `--ui-*` 驱动的项目 Token，移除 shadcn 默认主题映射和上游品牌命名。
- 不启动开发服务器；完成后运行 `pnpm check` 和 `pnpm test:e2e`。

### Task 1: 锁定项目自有组件边界

**Files:**

- Create: `apps/web/src/shared/components/component-library-boundary.test.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-workspace.yaml`
- Delete: `apps/web/components.json`
- Move: `apps/web/src/shared/ui/*` to `apps/web/src/shared/components/core/*`
- Move: `apps/web/src/shared/ai-elements/*` to `apps/web/src/shared/components/agent/*`
- Modify: `apps/web/src/app/**/*.tsx`
- Modify: `apps/web/src/features/**/*.{ts,tsx}`
- Modify: `apps/web/vite.config.ts`

**Interfaces:**

- Consumes: 现有 `shared/ui` 与 `shared/ai-elements` 组件公开 Props 和直接文件导入
- Produces: `shared/components/core` 与 `shared/components/agent` 项目自有组件入口

**Behavior:**

- 组件运行时代码、依赖声明、配置和业务导入中不再出现 shadcn/ui 或 AI Elements 边界，全部调用方直接使用项目自有组件路径。

**Stop Conditions:**

- 若现有业务代码依赖未复制进仓库的 AI Elements 运行时包，则停止并报告缺失源码。

- [x] **Task Status:** completed

Run: `pnpm --filter @codexly/web exec vitest run src/shared/components/component-library-boundary.test.ts`

Expected: 边界测试通过，且旧目录、`components.json` 和 `shadcn` 依赖均不存在。

### Task 2: 重写项目组件视觉语义

**Files:**

- Modify: `apps/web/src/shared/styles/globals.css`
- Modify: `apps/web/src/shared/components/core/*.tsx`
- Modify: `apps/web/src/shared/components/agent/*.{ts,tsx}`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/features/**/*.{ts,tsx}`
- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `tests/e2e/app-shell-settings-navigation.spec.ts`

**Interfaces:**

- Consumes: `--ui-*` 设计变量、现有组件 Props、`conversation` i18n 命名空间
- Produces: `brand`、`control`、`panel`、`foreground` 等项目语义 Token 和 `agentComponents` 文案键

**Behavior:**

- 核心与 Agent 组件使用 Codexly 的紧凑工作台视觉、焦点、触控和明暗主题语义，不再依赖 shadcn Token 或 AI Elements 命名。

**Stop Conditions:**

- 若替换 Token 导致现有组件公开行为或可访问性契约无法保持，则停止并定位具体组件。

- [x] **Task Status:** completed

Run: `pnpm --filter @codexly/web exec vitest run src/shared/components/core/ui-primitives.test.tsx src/shared/components/agent/agent-components.test.tsx`

Expected: 项目组件视觉与交互测试通过，断言只使用项目自有语义。

### Task 3: 更新工程规范并完成全量验证

**Files:**

- Modify: `.superwork/spec/frontend/index.md`
- Modify: `.superwork/spec/frontend/directory-structure.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `CHANGELOG.md`
- Modify: `pnpm-lock.yaml`
- Modify: `.superwork/plans/2026-08-07-project-owned-component-library.md`

**Interfaces:**

- Consumes: 项目自有组件目录、依赖清单和验证命令
- Produces: 新组件库维护规范、可复现锁文件和最终验证证据

**Behavior:**

- 当前工程规范只允许维护项目自有组件源码，仓库产品代码和依赖图中不存在 shadcn/ui 或 AI Elements 运行时边界，完整检查与用户流程通过。

**Stop Conditions:**

- 若 `pnpm check` 或 `pnpm test:e2e` 出现与迁移相关失败，则停止完成标记并修复；仅在确认无关且可复现时报告外部阻塞。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 基础门禁、Bundle 预算和全部浏览器用户流程通过。
