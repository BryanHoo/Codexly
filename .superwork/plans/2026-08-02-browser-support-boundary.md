# Feature Implementation Plan

**Goal:** 明确 Web 工作台支持 Chrome 116+、Firefox 124+、Safari 17.4+，并让 Vite 构建目标与该边界一致。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 适用全仓构建与验证约束。
- `.superwork/spec/frontend/index.md` — 确认 Web 与浏览器 Client 的责任边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 维护浏览器支持和前端验证规则。
- `.superwork/spec/frontend/state-management.md` — 确认 `AbortSignal.timeout()` 与 `AbortSignal.any()` 是既有 Client 运行时约束。
- `docs/web-design.md` — 记录 Web 技术选型和测试边界。

**Architecture:** 以 `apps/web/vite.config.ts` 中导出的浏览器目标常量作为构建侧单一事实源，通过 Vitest 锁定精确版本；README 与前端质量规范声明同一支持边界，并明确 Vite 转译不提供运行时 API polyfill。

**Tech Stack:** TypeScript、Vite、Vitest、Markdown、pnpm

## Global Constraints

- 保留 `AbortSignal.timeout()`、`AbortSignal.any()`、`toSorted()` 和 `toSpliced()` 的现有实现，不为低于声明版本的浏览器添加 polyfill 或兼容分支。
- 浏览器最低版本固定为 Chrome 116、Firefox 124、Safari 17.4；Vite `build.target` 必须逐项对应。
- E2E 继续只运行 Chromium，本次通过文档明确它是主流程验证而非完整跨浏览器矩阵。

### Task 1: 锁定 Vite 浏览器构建目标

**Files:**

- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/tsconfig.node.json`
- Create: `apps/web/vite.config.test.ts`

**Interfaces:**

- Consumes: Vite `UserConfig.build.target`
- Produces: `supportedBrowserTargets`
- Produces: 精确的 Vite `build.target`

**Behavior:**

- 导出只读浏览器目标 `chrome116`、`firefox124`、`safari17.4`，并将其配置为生产构建目标；测试必须在缺少或漂移任一目标时失败。

**Stop Conditions:**

- 如果当前 Vite/esbuild 不接受任一目标字符串，停止并重新确认受支持的目标格式。
- 如果导入配置会启动服务或产生外部副作用，停止并改用纯配置模块承载目标常量。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/vite.config.test.ts`

Expected: 浏览器目标配置测试通过，并精确匹配三个最低版本。

### Task 2: 声明浏览器支持与验证边界

**Files:**

- Modify: `README.md`
- Modify: `.superwork/spec/frontend/quality-guidelines.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: `supportedBrowserTargets`
- Produces: 面向用户和维护者一致的浏览器支持政策

**Behavior:**

- 声明 Chrome 116+、Firefox 124+、Safari 17.4+；说明边界覆盖现有运行时 API，Vite 不注入对应 polyfill，Chromium E2E 只验证关键流程而不代表跨浏览器覆盖。

**Stop Conditions:**

- 如果文档已有冲突的浏览器版本政策，停止并先统一单一权威位置。

- [x] **Task Status:** completed

Run: `pnpm exec prettier --check README.md .superwork/spec/frontend/quality-guidelines.md docs/web-design.md`

Expected: 三份文档格式检查通过，且最低版本与构建目标一致。
