# Feature Implementation Plan

**Goal:** 将 Inspector Project 文件树改为默认折叠、展开目录时按需加载直接子项，并移除 `2,000` 条目限制。

**Suggested Spec Reads:**

- `.superwork/spec/backend/directory-structure.md` — 约束 Project 文件系统读取、路径边界与 `.gitignore` 规则。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 AI Elements 组件复用与工作台交互。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Protocol Schema、Client 与 Server 的统一验证。
- `docs/architecture-design.md` — 定义 Project 文件 API 与受限源码访问边界。
- `docs/web-design.md` — 定义 Inspector 文件树的产品行为。

**Architecture:** 将 `GET /v1/projects/:projectId/files/tree` 改为可选 Project 相对目录 `path` 的直接子项查询；Server 沿目标目录路径逐级加载 `.gitignore` 并拒绝越界、符号链接和固定忽略目录。Web 以 `projectId + directoryPath` 作为 React Query key，仅为根目录和当前展开目录创建查询，并用受控 AI Elements `FileTree` 保持默认全折叠。

**Tech Stack:** TypeScript、TypeBox、Fastify、React 19、TanStack Query、AI Elements、Vitest、Playwright、pnpm。

## Global Constraints

- 保留顶部未提交变更摘要及其审核 Dialog 行为。
- 文件树只返回 Project 相对路径，目录查询不得访问 Project 外部、符号链接、`.git` 或固定生成目录。
- 每一级 `.gitignore` 只影响对应子树，下级反向规则可覆盖祖先文件级规则。
- 文件夹默认不展开，只有用户展开时请求其直接子项；折叠后缓存可复用，但不得继续渲染下级节点。
- 删除 `MAX_PROJECT_FILE_TREE_ENTRIES`、`truncated` 和“仅显示前 2000 个条目”旧逻辑，不增加替代条目上限。
- 不启动持久开发服务器。

### Task 1: 更新目录查询协议与 Client 契约

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`

**Interfaces:**

- Consumes: `ProjectFileTreeEntrySchema`、现有 `CodeAgentClient.#read` 与 `appendQuery`
- Produces: 可选相对目录查询 Schema、无 `truncated`/无 `maxItems` 的 `ProjectFileTree`、按 `directoryPath` 隔离的 Query key

**Behavior:**

- 根目录使用 `path: null`，子目录使用严格 Project 相对路径；Client 正确编码 `path`，Schema 拒绝绝对路径、点路径和额外字段，Query key 包含目录路径且传递取消信号。

**Stop Conditions:**

- 若根目录表示方式无法同时满足 Fastify Query Schema 与稳定 Query key，则停止并重新确定契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts apps/web/src/features/projects/project-queries.test.tsx`

Expected: 目录查询契约、Client URL 和 Query key 测试全部通过。

### Task 2: 实现 Server 直接子项读取

**Files:**

- Modify: `packages/server/src/project-file-tree.ts`
- Modify: `packages/server/src/project-file-tree.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: Task 1 的目录查询与响应 Schema
- Produces: `readProjectFileTree(projectRoot, directoryPath)` 直接子项读取和带 Query Schema 的 Fastify 路由

**Behavior:**

- 每次只返回目标目录的直接子项；沿根目录到目标目录逐级应用 `.gitignore`，拒绝非法、忽略、符号链接或超过深度限制的目录；单目录超过 `2,000` 个直接子项时全部返回。

**Stop Conditions:**

- 若目标目录无法在不跟随符号链接的前提下验证 Project 边界，则停止并收紧路径解析设计。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/project-file-tree.test.ts packages/server/src/app.test.ts`

Expected: 直接子项、目录 Query、忽略规则、安全边界和超过 `2,000` 子项测试全部通过。

### Task 3: 接入默认折叠与按需目录 Query

**Files:**

- Modify: `apps/web/src/shared/ai-elements/file-tree.tsx`
- Modify: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`

**Interfaces:**

- Consumes: Task 1 的 `projectFileTreeQueryOptions(projectId, directoryPath)` 与 Task 2 的目录响应
- Produces: 受控 `expanded` 状态、目录级加载/失败/空状态和文件打开行为

**Behavior:**

- 初始只请求根目录且所有文件夹折叠；点击文件夹行、展开按钮或键盘操作时展开并触发该目录查询，加载完成后仅渲染直接子项；折叠父目录时移除其后代展开状态，文件点击仍打开源码预览。

**Stop Conditions:**

- 若动态 Query 数组无法稳定关联目录状态，或折叠目录仍触发新的下级请求，则停止并调整状态所有权。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/ai-elements/ai-elements.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: 默认折叠、目录展开、加载/失败/空状态、键盘交互和文件选择测试全部通过。

### Task 4: 更新浏览器流程与持久规范

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: Task 1-3 的按需目录 API 与交互
- Produces: 可观察的根目录首请求、展开后子目录请求、源码预览流程和持久工程规则

**Behavior:**

- E2E 明确验证子文件初始不可见、点击目录后才发起带 `path` 的请求并显示子文件；规范删除全树、`2,000` 条目和默认展开描述，记录目录级按需加载约束。

**Stop Conditions:**

- 若 Playwright 无法区分根目录与子目录请求，则停止并增加确定性的请求记录，而不是使用时间等待。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "project file tree"`

Expected: Project 文件树按需加载并打开源码文件的 Chromium 流程通过。
