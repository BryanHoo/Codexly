# Brand Logo Assets Implementation Plan

**Goal:** 将 Web 中全部产品品牌标识和 favicon 统一替换为指定品牌资源。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束产品展示名称、项目命令和验证门禁。
- `.superwork/spec/frontend/directory-structure.md` — 约束 Web 静态资源和组件归属。
- `.superwork/spec/frontend/component-guidelines.md` — 约束品牌入口与组件可访问性。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束前端测试和构建验证。

**Architecture:** 将指定目录中的品牌 SVG 作为 Web 公共静态资源，并让侧栏、路由品牌链接、配对页及 favicon 直接引用相应资源；同步更新资源契约与端到端断言。

**Tech Stack:** React 19、TypeScript、Vite 8、Playwright、pnpm workspace。

## Global Constraints

- 保持产品展示名称为 `Codexly`，不修改品牌资源内部图形与样式。
- 使用 `/brand/codexly-logo.svg` 展示完整品牌标识，使用 `/favicon.svg` 提供浏览器图标。
- 保留品牌入口现有布局、交互语义与明暗主题适配。
- 项目命令使用 pnpm，Python 命令只使用 `python3`。

### Task 1: 接入公共品牌资源

**Files:**

- Create: `apps/web/public/brand/codexly-mark.svg`
- Create: `apps/web/public/brand/codexly-logo.svg`
- Modify: `apps/web/public/favicon.svg`
- Modify: `apps/web/index.html`
- Test: `tests/e2e/app-shell-inspector-layout.spec.ts`

**Interfaces:**

- Consumes: `/Users/bryanhu/Downloads/public` 中的品牌 SVG 源文件。
- Produces: `/brand/codexly-mark.svg`、`/brand/codexly-logo.svg` 和 `/favicon.svg` 公共静态资源契约。

**Behavior:**

- Web 构建与运行时原样提供指定品牌标志、完整 Logo 和 favicon，并通过更新后的 favicon URL 使用新资源。

**Stop Conditions:**

- 若指定品牌源文件缺失或 SVG 无法解析，停止并报告资源问题。

- [x] **Task Status:** completed

Run: `cmp apps/web/public/brand/codexly-mark.svg /Users/bryanhu/Downloads/public/brand/codexly-mark.svg && cmp apps/web/public/brand/codexly-logo.svg /Users/bryanhu/Downloads/public/brand/codexly-logo.svg && cmp apps/web/public/favicon.svg /Users/bryanhu/Downloads/public/favicon.svg`

Expected: 三个 Web 公共品牌资源与指定源文件逐字节一致。

### Task 2: 替换全部界面品牌入口

**Files:**

- Modify: `apps/web/src/app/routes/root-route.tsx`
- Modify: `apps/web/src/features/access/pairing-gate.tsx`
- Modify: `apps/web/src/features/access/pairing-gate.test.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`
- Modify: `apps/web/src/shared/styles/globals.css`
- Test: `tests/e2e/app-shell-inspector-layout.spec.ts`

**Interfaces:**

- Consumes: `/brand/codexly-logo.svg` 公共静态资源及现有品牌容器布局。
- Produces: 侧栏、路由品牌链接和配对页统一的可访问品牌 Logo 展示。

**Behavior:**

- 三处产品品牌入口均显示指定完整 Logo，不再渲染旧 `CA` 标记或配对页装饰条，并保持现有尺寸、布局和可访问名称。

**Stop Conditions:**

- 若完整 Logo 在现有侧栏宽度或明暗主题中不可辨识，停止并调整展示约束后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/access/pairing-gate.test.tsx apps/web/src/features/workbench/components/project-sidebar.test.tsx`

Expected: 配对页和项目侧栏组件测试通过，且断言统一品牌资源已渲染。

### Task 3: 验证品牌替换

**Files:**

- Test: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Modify: `tests/e2e/app-shell-settings-navigation.spec.ts`

**Interfaces:**

- Consumes: 浏览器渲染的品牌 Logo 与 favicon 静态资源。
- Produces: 新品牌入口、SVG 结构和布局尺寸的端到端验证证据。

**Behavior:**

- 浏览器端确认左上角完整 Logo 可见、旧 `CA` 标记消失、favicon 指向新版资源且 SVG 定义来自指定品牌文件。

**Stop Conditions:**

- 若端到端环境无法启动，应保留组件与静态资源验证结果并明确报告未执行项。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-inspector-layout.spec.ts --grep "brand logo"`

Expected: 品牌 Logo 与 favicon 定向端到端测试通过。
