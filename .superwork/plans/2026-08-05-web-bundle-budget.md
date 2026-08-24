# Feature Implementation Plan

**Goal:** 将 Inspector、Diff、代码预览和全局设置保持为按需加载，并为首屏压缩 JS 与最大异步 Chunk 建立 CI 体积预算。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 定义全量质量门禁和构建产物约束。
- `.superwork/spec/frontend/quality-guidelines.md` — 定义 Web 性能、测试和懒加载边界。
- `docs/web-design.md` — 定义 Workbench 页面装配和性能策略。

**Architecture:** 将非首屏 Workbench 面板和弹窗改为条件触发的 React lazy 边界；让 Vite 生成结构化 manifest，由独立校验器沿静态 import 图统计入口 gzip 总量，并检查每个异步加载组的 gzip 总量；根 `pnpm check` 在构建后执行预算门禁，使 CI 和发布复用同一判定。

**Tech Stack:** TypeScript、React 19、Vite 8、Vitest、Node.js zlib、pnpm、GitHub Actions。

## Global Constraints

- 保持 `chunkSizeWarningLimit` 默认值，不通过提高警告线隐藏超限产物。
- 预算按 Vite manifest 的结构化依赖关系计算，不依赖哈希文件名或构建日志文本。
- Inspector、Diff、代码高亮和全局设置仅在用户触发对应功能后加载。
- 不改变现有用户流程、焦点恢复、Dialog fallback 和 Inspector 响应式行为。
- 新增的关键预算计算逻辑使用简洁、清晰的中文注释。

### Task 1: 延后加载非首屏 Workbench 功能

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-dialogs.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/app/routes/index-route.tsx`
- Create: `apps/web/src/features/settings/components/global-settings-lazy.ts`
- Test: `apps/web/src/features/workbench/components/workbench-shell-lazy.test.ts`

**Interfaces:**

- Consumes: `WorkbenchShellLayout` 状态、现有 Inspector/Dialog props 和 React `lazy`/`Suspense`。
- Produces: 可独立验证的 `loadWorkbenchInspector`、`loadFileDiffDialog`、`loadFileReviewDialog`、`loadGlobalSettingsDialog` 加载契约，并由首页与 Workbench 复用设置入口。

**Behavior:**

- 仅在 Inspector 打开或对应 Dialog 有选中状态时请求模块，并保留当前关闭、焦点和 fallback 行为。

**Stop Conditions:**

- 如果懒加载边界要求改变公开组件 props 或破坏现有交互测试，则停止并重新划分边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-shell-lazy.test.ts apps/web/src/app/router.test.ts apps/web/src/features/workbench/components/workbench-inspector.test.tsx apps/web/src/features/diff/file-review-dialog.test.tsx apps/web/src/features/settings/components/global-settings-dialog.test.tsx`

Expected: 加载契约和既有 Inspector、Diff、设置行为测试全部通过。

### Task 2: 建立生产 Bundle 预算校验器

**Files:**

- Create: `tools/verify-web-bundle.mjs`
- Create: `tests/web-bundle-budget.test.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/vite.config.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `dist/web/.vite/manifest.json`、manifest 中的 `isEntry`、`imports`、`dynamicImports` 和生产 JS 文件。
- Produces: `bundle:check` 命令、首屏 gzip 总量预算、最大异步加载组 gzip 预算及超限诊断。

**Behavior:**

- 汇总所有入口及其静态依赖的 gzip 字节；按每个动态入口及其仅异步可达静态依赖计算最大加载组，任一预算超限或 manifest 缺失时以非零状态失败。

**Stop Conditions:**

- 如果 Vite manifest 不能稳定表达入口与动态依赖关系，则停止并改用 Vite/Rolldown 插件的结构化 bundle 元数据。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/web-bundle-budget.test.ts apps/web/vite.config.test.ts && pnpm run build && pnpm run bundle:check`

Expected: 校验器覆盖通过、入口超限、异步超限和无效 manifest，真实生产产物低于两项预算。

### Task 3: 接入 CI 并记录稳定约束

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.superwork/spec/frontend/quality-guidelines.md`

**Interfaces:**

- Consumes: 根 `build` 与 `bundle:check` scripts。
- Produces: CI 中可见的 Web Bundle budget 门禁和前端构建规范。

**Behavior:**

- Ubuntu/Windows quality job 明确执行生产构建后的预算校验，并将懒加载边界与预算更新规则写入前端质量规范。

**Stop Conditions:**

- 如果 CI 接线会重复执行完整构建，则保留 `pnpm check` 内单次构建并只拆分其后置预算步骤。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 完整质量门禁通过，CI 配置中存在显式 Bundle budget 检查且不重复构建。
