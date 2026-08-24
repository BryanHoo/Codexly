# Web Bundle And Package Size Implementation Plan

**Goal:** 将 Shiki、源码查看器和 sourcemap 从首屏及 npm 发布包中移出，同时保留受支持源码与 Tool JSON 的按需高亮能力。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束发布构建和统一验证入口。
- `.superwork/spec/frontend/component-guidelines.md` — 约束源码弹窗、Tool JSON 与 AI Elements 组件行为。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Web 单元测试和页面行为验证。
- `.superwork/spec/frontend/state-management.md` — 约束 CodeBlock Token Cache 的容量和键设计。
- `docs/web-design.md` — 明确要求 Diff、高亮器和非首屏组件动态加载。
- `docs/project-structure.md` — 约束 Vite、tsup 和单 npm 包发布结构。

**Architecture:** 保持 `CodeBlock` 的同步纯文本首帧与现有有界 Token Cache，将 Shiki Core、JavaScript Regex Engine、两个主题和显式语言模块移动到异步高亮边界；源码弹窗使用 React `lazy` 按交互加载；Web 与 Node 发布构建不生成 sourcemap，并由包校验拒绝 `.map` 文件。

**Tech Stack:** TypeScript 6、React 19、Vite 8、Shiki 4、Vitest 4、pnpm 11。

## Global Constraints

- 不从完整 `shiki` 入口导入运行时代码或类型。
- 只加载 `ProjectSourceDialog` 显式映射的语言与 Tool 使用的 `json`，主题固定为 `github-light`、`github-dark`。
- 高亮失败时必须继续展示完整纯文本；现有 24 MiB / 128 Entry / 512 KiB Source Token Cache 约束保持不变。
- 不保留旧的完整 Bundle 或发布 sourcemap 路径。
- 不启动开发服务器。

### Task 1: 构建细粒度按需高亮器

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/shared/ai-elements/code-highlighter.ts`
- Modify: `apps/web/src/shared/ai-elements/code-block.tsx`
- Modify: `apps/web/src/shared/ai-elements/code-token-cache.ts`
- Test: `apps/web/src/shared/ai-elements/code-highlighter.test.ts`

**Interfaces:**

- Consumes: `TokenizedCode = { background: string; foreground: string; lines: ThemedToken[][] }`
- Produces: `highlightCode(code: string, language: HighlightLanguage): Promise<TokenizedCode>`
- Produces: `CodeBlockLanguage = HighlightLanguage | "text"`

- **Behavior Slice:** 首帧始终渲染纯文本；非 `text` 代码块首次稳定渲染后才加载高亮模块；同一语言的初始化 Promise 复用，语言与主题只注册一次，失败继续保留纯文本。
- **Proof Intent:** 单元测试直接高亮 `json` 与 `typescript`，确认返回 token 且主题色存在；源码搜索确认不再存在完整 `shiki` 导入。
- **Verification:** 运行 `pnpm exec vitest run apps/web/src/shared/ai-elements/code-highlighter.test.ts apps/web/src/shared/ai-elements/code-token-cache.test.ts apps/web/src/shared/ai-elements/ai-elements.test.tsx`。Expected: 全部测试通过且 `rg "from \\\"shiki\\\"" apps/web/src` 无结果。

**Stop Conditions:**

- Shiki 4.3.1 Core API 无法使用 JavaScript Regex Engine 加载现有映射语言，或显式语言模块缺失时停止并修复计划。

### Task 2: 裁剪 Diff Viewer 的完整 Shiki 依赖

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/shared/ai-elements/code-languages.ts`
- Create: `apps/web/src/shared/ai-elements/shiki-bundle.ts`
- Create: `apps/web/src/shared/ai-elements/pierre-themes.ts`
- Modify: `apps/web/src/shared/ai-elements/code-highlighter.ts`
- Modify: `apps/web/src/features/diff/patch-diff-viewer.tsx`
- Modify: `apps/web/vite.config.ts`
- Test: `apps/web/src/shared/ai-elements/shiki-bundle.test.ts`

**Interfaces:**

- Consumes: `@pierre/diffs` 对 `shiki` 与 `@pierre/theming/themes` 的公开导入契约。
- Produces: `bundledLanguages`，仅包含项目支持的 Shiki 语言加载器。
- Produces: `createHighlighter()`，将 `@pierre/diffs` 的完整 Shiki 调用转换为 `shiki/core` 与 JavaScript Regex Engine。
- Produces: `shikiThemes`，仅包含 `github-light` 与 `github-dark`。

- **Behavior Slice:** `@pierre/diffs` 继续按文件扩展名高亮受支持的 Diff；不支持语言回退为纯文本；生产构建不再解析完整 Shiki 语言、主题和 Oniguruma WASM 集合。
- **Proof Intent:** 单元测试锁定兼容入口的语言和主题白名单；生产构建确认不再生成任意未支持语言、主题及 Shiki WASM Chunk。
- **Verification:** 运行 `pnpm exec vitest run apps/web/src/shared/ai-elements/shiki-bundle.test.ts apps/web/src/shared/ai-elements/code-highlighter.test.ts` 与 `pnpm --filter @codexly/web build`。Expected: 测试通过，构建仅包含显式语言与两个主题。

**Stop Conditions:**

- `@pierre/diffs` 运行时依赖完整 Shiki 私有行为，无法通过公开 `shiki/core` API 保持 Diff 渲染时停止并进入调试。

### Task 3: 按交互加载源码查看器

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/project-source-dialog.tsx`
- Test: `apps/web/src/features/workbench/components/project-source-dialog.test.tsx`

**Interfaces:**

- Consumes: `ProjectSourceDialogProps = { client; onClose; projectId; reference }`
- Consumes: `CodeBlockLanguage = HighlightLanguage | "text"`
- Produces: `getCodeLanguage(path: string): CodeBlockLanguage`
- Produces: `loadProjectSourceDialog(): Promise<ProjectSourceDialogModule>`

- **Behavior Slice:** 首屏不静态引用源码弹窗；用户打开文件引用时通过固定动态导入加载弹窗，随后保留加载、失败、行定位、复制和关闭行为。
- **Proof Intent:** 扩展语言映射测试覆盖支持语言和不支持回退；生产构建确认源码弹窗形成独立异步 Chunk，入口不直接依赖该 Chunk。
- **Verification:** 运行 `pnpm exec vitest run apps/web/src/features/workbench/components/project-source-dialog.test.tsx` 与 `pnpm --filter @codexly/web build`。Expected: 测试通过且构建输出含独立 `project-source-dialog` Chunk。

**Stop Conditions:**

- 懒加载导致弹窗失去焦点圈定、错误状态或受控 Query 生命周期时停止并进入调试。

### Task 4: 收紧发布构建与包清单

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/vite.config.ts`
- Modify: `tsup.config.ts`
- Modify: `tools/verify-package.mjs`
- Modify: `docs/project-structure.md`

**Interfaces:**

- Consumes: `pnpm build`
- Consumes: `pnpm pack --dry-run --json`
- Produces: `package:check = required entry validation + sourcemap exclusion validation`

- **Behavior Slice:** Web 与 Node 发布构建关闭 sourcemap；npm 包不再携带前后端源码映射；发布校验输出继续报告最终文件数。
- **Proof Intent:** 全量构建后确认 `dist` 无 `.map`，执行 dry-run pack 并比较文件数与包体积，记录首屏预加载 JS、gzip 体积和 Chunk 数。
- **Verification:** 运行 `pnpm check`、`pnpm test:e2e` 和 `pnpm pack --dry-run --json`。Expected: 全部通过、发布清单无 `.map` 且文件数显著低于 663。

**Stop Conditions:**

- 关闭 sourcemap 导致运行入口缺失、包校验无法启动 SQLite Worker，或 E2E 页面行为回归时停止并进入调试。
