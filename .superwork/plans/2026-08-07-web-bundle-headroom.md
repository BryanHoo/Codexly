# Feature Implementation Plan

**Goal:** 扩大 Web 首屏与最大异步组预算余量，消除超大 Chunk 警告，并让统一质量门禁产出可复用的机器可读 Bundle 报告。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束统一质量门禁与构建产物。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Markdown、Shiki、Diff、Grammar 懒加载和 Bundle 预算。
- `.superwork/spec/frontend/component-guidelines.md` — 约束消息组件边界与可观察行为。
- `docs/web-design.md` — 约束 Workbench 渲染性能和按需加载策略。

**Architecture:** 将 Bundle 分析结果固化为 `.artifacts/web-bundle-report.json`，同一次校验同时输出首屏 Top Contributors，CI 独立展示步骤只读取报告；将 Streamdown Markdown 实现从共享消息原语中拆出并由运行时 lazy 边界加载，首帧使用完整纯文本 fallback；通过 Rolldown 精确拆分 C++ 嵌入 Grammar 和自包含的 React 运行时，保留功能并使单个原始 Chunk 低于 Vite 警告线。

**Tech Stack:** TypeScript、React 19、Vite 8、Rolldown、Vitest、Node.js zlib、pnpm、GitHub Actions。

## Global Constraints

- 保持首屏 `240 KiB gzip` 与最大异步组 `200 KiB gzip` 预算，不提高 `chunkSizeWarningLimit`。
- 保留现有 Markdown 语义、文件引用、Code Comment、Diff 和语言白名单行为。
- 首次加载 Markdown 实现期间必须展示完整原文，不允许空白消息或内容闪失。
- `pnpm check` 只执行一次 Bundle 分析；CI 独立步骤只能读取已生成报告。
- 不启动开发服务器。

### Task 1: 产出并复用 Bundle 机器报告

**Files:**

- Modify: `tools/verify-web-bundle.mjs`
- Modify: `tests/web-bundle-budget.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: `dist/web/.vite/manifest.json`、生产 JavaScript 文件和 `--report`/`--read-report` CLI 参数。
- Produces: `.artifacts/web-bundle-report.json`、首屏 Top Contributors、可只读展示的 `bundle:report` 命令。

**Behavior:**

- Bundle 校验无论通过或超限都写入结构化预算、首屏贡献者和异步组数据；正常输出展示首屏 gzip 最大贡献者；CI 在 `pnpm check` 后只读取报告展示，不再次分析构建产物。

**Stop Conditions:**

- 如果报告路径会进入 npm 发布清单，停止并改用已忽略的构建外目录。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/web-bundle-budget.test.ts`

Expected: 报告 schema、Top Contributors、超限报告和只读展示测试全部通过。

### Task 2: 延迟加载 Markdown 渲染实现

**Files:**

- Create: `apps/web/src/shared/ai-elements/message-response.tsx`
- Create: `apps/web/src/shared/ai-elements/lazy-message-response.tsx`
- Modify: `apps/web/src/shared/ai-elements/message.tsx`
- Modify: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-items.tsx`
- Modify: `apps/web/src/features/workbench/components/project-source-dialog.tsx`
- Test: `apps/web/src/shared/ai-elements/lazy-message-response.test.tsx`

**Interfaces:**

- Consumes: 现有 `MessageResponseProps`、`MessageFileReference`、Streamdown 配置和文件引用回调。
- Produces: `MessageResponse` 重型实现、`LazyMessageResponse` 运行时边界和完整纯文本 fallback。

**Behavior:**

- 消息原语不再静态导入 Streamdown；实际出现消息或 Markdown 预览时才请求实现 Chunk；实现加载前完整展示原文，加载后保留现有 Markdown、文件引用、动画模式和 Code Comment 行为。

**Stop Conditions:**

- 如果 lazy 边界导致消息原文暂时不可见、文件引用失效或流式内容丢失，停止并调整 fallback/props 边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/ai-elements/lazy-message-response.test.tsx apps/web/src/shared/ai-elements/ai-elements.test.tsx apps/web/src/features/workbench/components/task-timeline.test.tsx apps/web/src/features/workbench/components/project-source-dialog.test.tsx`

Expected: lazy 契约与现有 Markdown、Timeline、源码预览行为全部通过。

### Task 3: 拆分超大 Grammar Chunk

**Files:**

- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/vite.config.test.ts`

**Interfaces:**

- Consumes: Rolldown `output.codeSplitting.groups`、C++ 的 `cpp-macro`/`regexp`/`glsl` Grammar 支持模块、`react`、`react-dom` 与 `scheduler` 模块路径。
- Produces: 独立 `grammar-cpp-support` 和 `react-runtime` Chunk，同时保留 C++ Grammar 动态加载入口。

**Behavior:**

- 精确拆出 C++ 宏 Grammar 及其专用支持依赖与完整 React 运行时，保留共享 SQL Grammar 独立，不聚合业务模块或形成循环 Chunk；生产构建不再输出超过 500 kB 的 JavaScript Chunk。

**Stop Conditions:**

- 如果拆分导致循环 Chunk、C++ 高亮失败或其他语言加载组超过预算，停止并改用 Grammar 资源加载方案。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/vite.config.test.ts apps/web/src/shared/ai-elements/code-highlighter.test.ts apps/web/src/shared/ai-elements/shiki-bundle.test.ts && pnpm --filter @codexly/web build`

Expected: 配置和高亮测试通过，构建无 `Some chunks are larger than 500 kB` 警告。

### Task 4: 固化约束并完成全量验证

**Files:**

- Modify: `.superwork/spec/frontend/quality-guidelines.md`

**Interfaces:**

- Consumes: `bundle:check`、`bundle:report`、Markdown lazy 边界和 Grammar 拆分结果。
- Produces: 可持续维护的报告与拆包规范。

**Behavior:**

- 文档明确机器报告位置、CI 只读展示职责、首屏贡献者输出和超大 Grammar 拆分约束；统一门禁验证最终预算余量与构建警告。

**Stop Conditions:**

- 如果全量门禁暴露与本改动无关且无法安全修复的问题，记录失败证据并停止。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 完整质量门禁通过，机器报告存在，首屏与最大异步组均通过预算且 Web 构建无 500 kB Chunk 警告。
