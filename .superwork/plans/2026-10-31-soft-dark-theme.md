# 柔和暗色主题实施计划

**Goal:** 降低暗色工作台的刺眼反差，统一两端文件编辑和预览为 GitHub Light / Dark Dimmed。

**Suggested Spec Reads:**

- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 共用颜色和组件，保留平台适配。
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 移动浏览器与 Legacy CSS 构建。
- `.superwork/spec/ui/shared/index.md` — 编辑状态和懒加载边界。
- `.superwork/spec/web/frontend/index.md` — Web 主题与预览调用者。
- `.superwork/spec/desktop/frontend/index.md` — 桌面样式与浏览器验证。

**Architecture:** 两端全局 CSS 导入一份共享颜色令牌；文件容器局部覆盖颜色，CodeMirror 按语义标签映射 GitHub 颜色。主题切换只改变 CSS，保留编辑状态和语法解析器。

**Tech Stack:** CSS、React、CodeMirror、Shiki、Vitest Browser、Playwright、pnpm。

## Global Constraints

- Web、移动浏览器和桌面共用实现，不新增主题切换监听、网络请求或编辑器重建。
- 关键逻辑使用清晰中文注释；Python 命令使用 python3。
- 保留浅色工作台既有视觉；暗色正文避免纯白，文字在实际表面保持 WCAG AA 可读性。
- 文件主题采用 GitHub Light / Dark Dimmed 的官方配色，覆盖源文件、Markdown、工具栏、选区和搜索。
- 不修改其他任务登记的文件，不提交或发布。

### Task 1: 统一工作台暗色和文件主题

**Files:**

- Create: `packages/ui/src/core/theme-tokens.css`
- Create: `packages/ui/src/core/file-theme.css`
- Modify: `apps/web/src/shared/styles/globals.css`
- Modify: `desktop/src/shared/styles/globals.css`
- Modify: `apps/web/src/shared/styles/workbench.css`
- Modify: `desktop/src/shared/styles/workbench.css`
- Modify: `apps/web/src/shared/styles/workbench-background-surfaces.test.ts`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-actions.test.tsx`
- Modify: `apps/web/index.html`
- Modify: `desktop/index.html`
- Modify: `apps/web/src/shared/components/agent/code-highlighter.test.ts`
- Modify: `packages/ui/src/core/text-editor-theme.ts`
- Modify: `packages/ui/src/core/text-file-editor.tsx`
- Modify: `packages/ui/src/agent/code-highlighter.ts`
- Modify: `packages/ui/src/agent/code-block-content.tsx`
- Modify: `apps/web/src/features/workbench/components/project-source-panel.tsx`
- Modify: `desktop/src/features/workbench/components/project-source-panel.tsx`
- Create: `desktop/src/shared/components/core/file-theme.browser.test.tsx`
- Modify: `tests/e2e/app-shell-settings-defaults.spec.ts`

**Interfaces:**

- Consumes: `data-theme`、共享 `TextFileEditor`、Shiki 双主题 token 和文件预览入口。
- Produces: 共享 `--ui-color-*`、局部 `.file-theme` 和 `--file-*`、保留状态的 CSS 主题切换。

**Behavior:**

- 工作台主次文字可读且层级柔和；编辑器与 Markdown 文件预览使用同一 GitHub 调色板。
- 明暗切换后编辑节点、草稿、选区和撤销历史保持不变，窄容器无新增横向溢出。

**Stop Conditions:**

- 若需要重建编辑状态、更改持久化或传输契约，先修订计划。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop exec vitest run --config vitest.browser.config.ts src/shared/components/core/file-theme.browser.test.tsx`

Expected: Chromium 与 WebKit 下 GitHub 文件配色、对比度和主题切换保留状态通过。

### Task 2: 按用户要求提高编辑器包体预算

**Files:**

- Modify: `desktop/performance-budget.json`
- Modify: `.superwork/spec/guides/code-reuse-thinking-guide.md`

**Interfaces:**

- Consumes: 桌面编辑器场景完整静态依赖闭包的字节测量。
- Produces: `scenarioLoadBytes.textEditor` 为 2,200,000 字节。

**Behavior:**

- 将编辑器场景预算从 2,150,000 提高为 2,200,000 字节，恢复清晰的完整 CSS 变量名；其余场景继续按原有预算校验。

**Stop Conditions:**

- 如最终构建仍超出新预算，检查真实依赖闭包，不自动继续放宽。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop performance:budget`

Expected: 编辑器场景小于 2,200,000 字节，所有场景预算通过。

### 规范更新

- Create: `.superwork/spec/guides/theme-design.md`
- Modify: `.superwork/spec/guides/index.md`

## 验证与交接

- 登记：soft-dark-theme-20261031 / codex-soft-dark-20261031。
- 官方依据：https://primer.style/product/primitives/ 、https://atlassian.design/foundations/elevation 、https://codemirror.net/examples/styling/ 、https://github.com/primer/github-vscode-theme 。
- 最终检查：两端类型、格式、静态检查、架构、构建与包体；编辑器浏览器回归和 Web 主题／文档流程；未修改 Rust，不运行原生编译。

### 已完成的行为验证

- RED：`.local/soft-dark-red.log`，Chromium/WebKit 的原始正文对比度 17.756:1 超过柔和主题上限；编辑器仍使用旧前景色。
- GREEN：`.local/soft-dark-green.log`，两引擎共 20 项文件主题、搜索、布局、恢复、保存和工作台测试通过；最后一次修改 CSS 变量名后重新执行。
- 官方依据采用 GitHub Light / Dark Dimmed 原色和 Atlassian 暗色表面层级；工作台正文约 8.77:1，最浅浮层的次级文字约 4.56:1。
- 简化结果：changed。两端颜色、阴影及壁纸前景回退合并一处；源码背景由文件色板负责，消除高亮完成后的背景切换。
- 测试迁移：原先读取宿主 CSS 中固定颜色的两项测试改读共享主题文件，并验证新的状态色；不改变状态和动效逻辑。
- 初次桌面包体超过旧预算 44 字节。用户明确要求直接提高预算，现将 textEditor 调整为 2,200,000 字节，并恢复完整 CSS 变量名；按新预算重新构建验收。
- 规范结果：create。新增共享主题长期约束并由全局指南索引链接，不修改其他任务占用的 UI 索引。

### 最终检查证据

- 工作目录为仓库根目录；使用已安装的 Node 24、pnpm 11，未调整依赖。所有以下检查均在恢复完整 CSS 变量名、提高预算后执行。
- `pnpm check`：退出 0；3895 项根单元/集成测试与 17 项性能测试通过；同时通过格式、lint、架构、Schema、审计、构建、Web 包体和发布包验证。日志 `.local/soft-dark-root-final.log`。
- `pnpm --dir desktop check:web`：退出 0；688 项单元测试、静态检查、类型、约束测试、现代与 Legacy 构建、所有场景预算通过。编辑器实际 2,150,044 字节，新预算 2,200,000 字节。日志 `.local/soft-dark-desktop-final.log`。
- `pnpm --dir desktop exec vitest run --config vitest.browser.config.ts src/shared/components/core/file-theme.browser.test.tsx src/shared/components/core/text-editor-layout.browser.test.tsx src/shared/components/core/text-editor-recovery.browser.test.tsx src/shared/components/core/text-editor-manual-save.browser.test.tsx src/shared/components/core/text-editor-workbench.browser.test.tsx`：退出 0；Chromium / WebKit 共 20 项通过。日志 `.local/soft-dark-browser-final.log`。
- 原生 Rust 与 IPC 未修改，未运行 Rust 或各操作系统真机套件；Web 端到端仅执行此次主题和文件工作区相关用例。
- 规范索引及相关文档的本地链接校验通过；计划预检通过。
- `pnpm exec playwright test tests/e2e/app-shell-settings-defaults.spec.ts tests/e2e/app-shell-document-workspace.spec.ts tests/e2e/app-shell-inspector-mobile.spec.ts tests/e2e/app-shell-inspector-desktop.spec.ts --workers=2`：退出 0，43 项通过（50.8 秒），覆盖 Chromium / Firefox / WebKit、正式明暗色令牌、多文件工作区、窄屏及移动端流程。日志 `.local/soft-dark-e2e-final.log`。
- 最终代码验证后仅补充本计划证据；上述行为结果复用同一运行中的最终检查，不重复执行等价检查。
