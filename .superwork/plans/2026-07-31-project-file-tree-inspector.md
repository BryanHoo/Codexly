# Feature Implementation Plan

**Goal:** 将右侧“变更”页签的文件列表替换为当前 Project 文件树，保留顶部未提交变更摘要，并让摘要点击后打开现有文件审核弹窗。

**Suggested Spec Reads:**

- `.superwork/spec/backend/directory-structure.md` - Project 文件能力必须通过固定只读端点暴露，不能提供任意文件系统透传。
- `.superwork/spec/backend/quality-guidelines.md` - Project 路径、符号链接、错误和测试必须在 Server 边界处理。
- `.superwork/spec/frontend/component-guidelines.md` - 共享 AI Elements 必须基于官方组件源码，Inspector 保持紧凑、可访问的工作台交互。
- `.superwork/spec/frontend/state-management.md` - Project 文件树属于 HTTP 状态，使用 TanStack Query 按 Project 隔离。
- `.superwork/spec/frontend/quality-guidelines.md` - 页面行为变化需要覆盖组件状态、键盘行为和 Playwright 流程。
- `.superwork/spec/shared/quality-guidelines.md` - Protocol、Client 和 Server 必须共享严格 Schema，并对文件读取设置明确边界。
- `docs/architecture-design.md` - 浏览器不得直接访问本地文件系统，文件能力必须经过 Project 校验。
- `docs/web-design.md` - Inspector、Dialog、AI Elements 源码所有权和按需源码预览遵循现有 Web 架构。

**Architecture:** Protocol 新增扁平、严格且有数量上限的 Project 文件树响应；Server 从已注册 Project 根目录递归读取目录，跳过符号链接、`.git` 与大型生成目录，统一返回 Project 相对路径并在达到预算时标记截断。Client 负责响应校验，Web 使用 Project 级 Query 获取目录并转换为 AI Elements `FileTree` 的递归组合结构。Inspector 顶部继续展示现有未提交变更统计，但整体成为可访问 Dialog 触发器；下方显示 Project 文件树，文件选择复用现有 `ProjectSourceDialog`，审核复用现有 `FileReviewDialog`。

**Tech Stack:** TypeBox、Fastify、Node.js `fs/promises`、React 19、TanStack Query、AI Elements、Tailwind CSS 4、Vitest、Playwright。

## Global Constraints

- 浏览器只能消费 `@codexly/client` 验证后的 Project 相对路径，不得直接访问本地文件系统。
- 文件树端点固定读取已注册 Project 根目录；跳过符号链接、`.git`、`node_modules`、构建与覆盖率目录，并使用条目数与深度预算避免无界遍历。
- 文件树目录优先、同类型按名称排序；响应明确携带 `truncated`，错误不得回退到 Git 变更或演示文件。
- 顶部“未提交变更”模块保留现有标题、数量和增删统计，只新增按钮语义、焦点样式与审核弹窗行为。
- 没有未提交变更时摘要禁用且不打开空审核弹窗；Git 读取错误继续保留手动刷新入口。
- 文件树使用官方 AI Elements `FileTree` 公开组合 API，并适配现有设计 Token；不新增通用树组件或额外 UI 依赖。
- 文件点击复用现有受控源码预览；目录只负责展开或折叠。
- 关键递归边界、路径安全、树转换和弹窗入口添加简短、清晰的中文注释。

### Task 1: 定义并实现受限 Project 文件树读取

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Create: `packages/server/src/project-file-tree.ts`
- Create: `packages/server/src/project-file-tree.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `Project.rootPath` 与 Node.js `fs/promises` 目录读取、真实路径能力。
- Produces: `ProjectFileTreeEntry`。
- Produces: `ProjectFileTree`。
- Produces: `ProjectFileTreeSchema`。
- Produces: `GET /v1/projects/:projectId/files/tree`

**Behavior:**

- 返回按目录优先稳定排序的 Project 相对目录与文件条目，跳过越界风险和大型生成目录，并在达到深度或条目预算时返回 `truncated: true`；未知 Project 和读取失败由 HTTP 边界返回不泄露本机路径的错误。

**Stop Conditions:**

- Stop if Project 根目录无法在现有 Server Context 中获得或 Protocol 无法表达严格的有限条目响应。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/server/src/project-file-tree.test.ts packages/server/src/app.test.ts`

Expected: 文件树 Schema、排序、忽略规则、符号链接、预算截断和 Project 路由测试全部通过。

### Task 2: 接入 Client、Query 与官方 AI Elements FileTree

**Files:**

- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Create: `apps/web/src/shared/ai-elements/file-tree.tsx`
- Modify: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`

**Interfaces:**

- Consumes: `ProjectFileTreeSchema`。
- Consumes: `GET /v1/projects/:projectId/files/tree`
- Consumes: 官方 AI Elements `FileTree` 组合 API。
- Produces: `CodexlyClient.listProjectFiles(projectId, options)`
- Produces: `projectFileTreeQueryOptions(projectId, client)`
- Produces: `FileTree`
- Produces: `FileTreeFolder`
- Produces: `FileTreeFile`
- Produces: `FileTreeIcon`
- Produces: `FileTreeName`
- Produces: `FileTreeActions`

**Behavior:**

- Client 校验文件树响应并支持 AbortSignal；Project Query 使用稳定 Query Key 缓存文件树；本地 AI Elements 组件支持受控或非受控展开、文件选择、键盘操作和项目设计 Token。

**Stop Conditions:**

- Stop if 官方 `FileTree` 源码或公开 Props 与项目 React 19、Tailwind 4 约束不兼容且无法通过局部适配解决。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/client/src/http-client.test.ts apps/web/src/features/projects/project-queries.test.tsx apps/web/src/shared/ai-elements/ai-elements.test.tsx`

Expected: Client URL 与 Schema 校验、Query Key/取消契约和 AI Elements 展开选择语义测试全部通过。

### Task 3: 将 Inspector 变更页签改为文件树与审核入口

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: `ProjectFileTree`。
- Consumes: `projectFileTreeQueryOptions(projectId, client)`
- Consumes: `FileTree`
- Consumes: `FileReviewDialog`
- Consumes: `ProjectSourceDialog`
- Produces: `WorkbenchInspector` 的 `fileTree` 状态、`onReviewChanges` 和 `onOpenSourceFile` 交互契约。

**Behavior:**

- “变更”页签顶部继续显示现有未提交变更摘要并作为审核 Dialog 触发器；下方改为完整 Project 文件树，目录可展开，文件点击打开受控源码预览，并对加载、空、截断和错误状态给出紧凑明确反馈；“上下文”页签保持原行为。

**Stop Conditions:**

- Stop if 现有审核弹窗无法接收 Git staged/unstaged 合并结果，或源码预览无法接受文件树返回的 Project 相对路径。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-inspector.test.tsx && pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "project file tree|uncommitted changes review"`

Expected: 摘要外观与统计保持，点击打开审核弹窗；文件树加载、展开、文件预览、错误和截断状态可观察且键盘可用。

## Final Verification

Run: `pnpm check && pnpm test:e2e`

Expected: 格式、Lint、依赖边界、单元测试、类型检查、生产构建和完整浏览器流程全部通过。
