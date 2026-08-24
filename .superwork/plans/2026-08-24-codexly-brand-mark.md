# Feature Implementation Plan

**Goal:** 将 Codexly 品牌图标收敛为可在导航栏与 favicon 复用的 `>_` 终端提示符。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束品牌命名、包管理器与验证命令。
- `.superwork/spec/frontend/directory-structure.md` — 规定 logo、mark 与 favicon 的统一资产入口。
- `.superwork/spec/frontend/quality-guidelines.md` — 规定前端静态资产测试与构建验证。

**Architecture:** 以共享的 `>_` 双 path 为视觉源，分别落入独立 mark、完整 logo 与 favicon SVG；通过静态资产测试锁定三者一致性和 favicon 缓存版本。

**Tech Stack:** SVG、TypeScript、Vitest、Vite。

## Global Constraints

- 保持黑底、白色 chevron 与品牌蓝下划线，不复刻 Codex 官方花结，不引入渐变、阴影或复杂结构。
- 使用项目现有 `pnpm` 工作区命令，并保持单个代码文件不超过 500 行。

### Task 1: 锁定品牌资产一致性

**Files:**

- Create: `apps/web/src/app/brand-assets.test.ts`

**Interfaces:**

- Consumes: `apps/web/public/brand/codexly-mark.svg`、`apps/web/public/brand/codexly-logo.svg`、`apps/web/public/favicon.svg`、`apps/web/index.html`
- Produces: 品牌核心 path 一致性与 favicon 版本契约

**Behavior:**

- 验证三个 SVG 使用同一组 `>_` 核心 path，完整 logo 保留 `Codexly` 字标，并确保 HTML 引用新的 favicon 缓存版本。

**Stop Conditions:**

- 如果现有测试环境无法读取 `apps/web/public` 静态资产则停止并调整测试归属。

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/app/brand-assets.test.ts`

Expected: 新测试因旧品牌资产缺少共享 `</>` 符号组且 favicon 仍为 `v=3` 而失败。

### Task 2: 替换并复用精炼品牌图标

**Files:**

- Modify: `apps/web/public/brand/codexly-mark.svg`
- Modify: `apps/web/public/brand/codexly-logo.svg`
- Modify: `apps/web/public/favicon.svg`
- Modify: `apps/web/index.html`

**Interfaces:**

- Consumes: Task 1 定义的共享 `>_` path 与 favicon 版本契约
- Produces: 导航栏、配对页和浏览器标签统一使用的 Codexly 品牌视觉

**Behavior:**

- 使用 Codexly 自有圆角方形底板、白色 chevron 与品牌蓝下划线，并在 16px 场景保持清晰。

**Stop Conditions:**

- 如果核心轮廓在 16px 预览中粘连、失衡或无法识别，则停止并调整 SVG 几何后重新验证。

- [x] **Task Status:** completed

Run: `pnpm --filter @codexly/web build`

Expected: 品牌资产测试和 Web 生产构建通过，生成的 favicon 与 logo 可被 Vite 正确打包。
