# Feature Implementation Plan

**Goal:** 使用本地 AI Elements `CodeBlock` 重构源文件查看器，同时保留查询、弹窗关闭、行定位、高亮和状态展示行为。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 定义项目验证门禁与开发前检查。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 AI Elements 源码所有权、源文件弹窗和可访问性。
- `.superwork/spec/frontend/quality-guidelines.md` — 定义组件与浏览器行为验证范围。
- `docs/web-design.md` — 定义 `code-block` 采用范围和 Web 数据边界。

**Architecture:** 在 `shared/ai-elements` 新增官方组合式 `CodeBlock`，使用 Shiki 异步高亮并以纯文本即时回退；通过通用 `highlightedLine` 属性输出稳定行节点。源文件弹窗仅负责扩展名映射、现有 Query 状态和 dialog 生命周期，并组合共享组件完成展示、复制与定位。

**Tech Stack:** React 19、TypeScript、Tailwind CSS 4、Shiki、Vitest、Playwright

## Global Constraints

- 保留原生 `<dialog>`、现有 `useQuery`、backdrop 点击、Escape 和关闭回调行为。
- 浏览器只调用 `client.readProjectSourceFile`，不得直接访问本地文件系统。
- 未识别扩展名必须映射为 Shiki 的安全纯文本语言 `text`。
- 新增关键逻辑使用简短、清晰的中文注释。
- 依赖继续遵循项目 `pnpm` Catalog 和 Workspace 约束。

### Task 1: 新增可复用 AI Elements CodeBlock

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/shared/ai-elements/code-block.tsx`
- Modify: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`
- Modify: `apps/web/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `shiki` `BundledLanguage`、tokenization API、项目语义 Tailwind Token 和浏览器 Clipboard API。
- Produces: `CodeBlock*` 组合组件和 `highlightedLine`。
- Produces: `CodeBlockProps` with `code`, `language`, `showLineNumbers`, and optional `highlightedLine`.
- Produces: rendered lines with stable `data-code-line` and `data-highlighted` attributes.

**Behavior Slice:**

实现组合式代码块，立即以纯文本 token 渲染，并在 Shiki 加载后更新语法高亮；显示可选行号，对指定行应用通用高亮并提供可访问复制按钮。缓存 highlighter 和 tokenization 结果，组件卸载后不更新状态。

**Proof Intent:**

组件测试证明 header/filename、行号、稳定行属性、指定行高亮和复制按钮可访问名称存在，未知语言的安全回退由调用方映射测试覆盖。

**Verification:**

```bash
pnpm exec vitest run apps/web/src/shared/ai-elements/ai-elements.test.tsx
```

Expected: AI Elements 测试全部通过，新增代码块断言通过且无 React 服务端渲染错误。

**Stop Conditions:**

- 当前 Shiki API 与锁定版本不支持按语言加载或双主题 token。
- 引入 `shiki` 需要破坏 Catalog 模式或 Web 包依赖边界。
- 官方组合组件契约与用户要求的组件名称不一致。

### Task 2: 使用 CodeBlock 重构源文件弹窗

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-source-dialog.tsx`
- Create: `apps/web/src/features/workbench/components/project-source-dialog.test.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `CodeBlock*` 组合组件和 `highlightedLine`。
- Consumes: 现有 `CodexlyWorkbenchClient.readProjectSourceFile(projectId, path)` Query 调用。
- Produces: `getCodeLanguage(path)` 扩展名到 `BundledLanguage` 的确定性映射，默认返回 `text`。
- Produces: 保持不变的 `ProjectSourceDialog` Props、原生 dialog `onCancel`、backdrop `onClick` 和 `onClose`。

**Behavior Slice:**

删除 `SourceCode` 手工拆行渲染，改为 AI Elements 组合组件；header 保留文件名、完整路径、指定行和截断提示，加入可访问复制操作；内容显示行号并高亮目标行，在查询成功和弹窗打开后将目标行滚动至居中。加载和错误状态保持不变。

**Proof Intent:**

单元测试证明常见扩展名映射和未知扩展名 `text` 回退；E2E 证明源文件仍由受控接口加载，弹窗展示完整路径和截断状态，Markdown 文件映射为 `markdown`，第 716 行高亮且进入可视区域，复制按钮可访问并写入完整内容，Escape 与 backdrop 继续关闭弹窗。

**Verification:**

```bash
pnpm exec vitest run apps/web/src/features/workbench/components/project-source-dialog.test.tsx
pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "opens bounded source previews"
```

Expected: 源文件查看器用例通过，定位、高亮、复制、状态展示和关闭行为全部可观察。

**Stop Conditions:**

- Playwright 环境无法提供 Clipboard API 且无法通过标准权限配置验证复制。
- 原生 dialog 测试揭示现有关闭行为与要求冲突。
- 源文件响应缺少渲染或定位所需的既有字段。

## Final Verification

```bash
pnpm check
pnpm test:e2e
```

Expected signal: 统一质量门禁和完整浏览器流程全部通过，无类型、格式、依赖边界、构建或交互回归。
