# Git History Dialog Implementation Plan

**Goal:** 在中栏 Composer 底部的当前分支旁提供 Git 历史入口，并在弹窗中安全、清晰地展示当前 `HEAD` 的最近提交记录。

**Suggested Spec Reads:**

- `.superwork/spec/backend/directory-structure.md` — 约束固定只读 Git 端点与受控命令边界
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Fastify Schema、错误收敛与测试
- `.superwork/spec/frontend/component-guidelines.md` — 约束弹窗与工作台组件职责
- `.superwork/spec/frontend/state-management.md` — 约束按需 Query 与弹窗本地状态边界
- `.superwork/spec/frontend/quality-guidelines.md` — 约束可访问性、交互测试和浏览器验证
- `.superwork/spec/frontend/type-safety.md` — 约束 Protocol Schema 与 Client 边界校验
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Client、Server、Web 依赖方向
- `docs/architecture-design.md` — 确认只读 HTTP Snapshot 的交付边界
- `docs/web-design.md` — 确认 Inspector、Dialog、图标按钮和紧凑工作台视觉规范

**Architecture:** 在 Protocol 定义有界 Git 历史分页；Server 通过现有受控 `simple-git` 执行器固定读取根仓库或指定直属子仓库的当前 `HEAD`，固定端点只接受 Project ID、受检仓库名和游标；Client 校验响应后交给按需 Infinite Query；Composer 在底部分支控件旁使用同尺寸历史图标打开懒加载 Dialog，Dialog 以 Tab 分开展示直属子仓库并负责分页、错误、空状态和提交列表。

**Tech Stack:** TypeScript、TypeBox、Fastify、simple-git、React 19、TanStack Query、shadcn/ui、Tailwind CSS、Vitest、Playwright

## Global Constraints

- Git 历史读取必须只使用配置后的 Project 根目录、固定参数数组、现有超时/输出上限/环境过滤，不接受浏览器传入命令、引用或路径。
- Git 历史命令固定以仓库当前 `HEAD` 为起点，不使用 `--all` 或接收其他分支名称；关闭弹窗后清理历史缓存，确保再次打开时读取当前检出分支。
- Git 历史每页固定返回最近 20 条提交并提供不透明下一页游标；直属子仓库模式返回有界仓库列表，历史记录不跨仓库混合。
- 提交记录只暴露 SHA、标题、作者展示名、作者邮箱、ISO 8601 时间和可选直属仓库名，不暴露本机绝对路径。
- 弹窗只在用户点击时发起请求；关闭后恢复焦点，加载、失败、空历史和正常列表均有可访问文本。
- 中文和英文文案同步维护；代码关键逻辑添加简短、明确的中文注释。

### Task 1: 定义 Git 历史协议契约

**Files:**

- Modify: `packages/protocol/src/project-git.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**

- Consumes: `ProjectRelativePathSchema` 与 TypeBox 严格对象约束
- Produces: `ProjectGitHistoryQuerySchema`、`ProjectGitCommitSchema`、`ProjectGitHistoryPageSchema` 及对应类型

**Behavior:**

- 定义严格且有界的历史查询与分页响应，校验受限仓库名、游标、完整十六进制 SHA、非空标题/作者、邮箱、ISO 8601 时间、仓库模式、当前仓库、仓库 Tab 列表、最多 20 条提交和可选下一页游标；拒绝额外字段与非法值。

**Stop Conditions:**

- 如果现有 Protocol 无法表达 ISO 8601 时间或直属仓库标识而不泄露路径，则停止并重新收紧响应字段。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts`

Expected: Git 历史 Schema 的有效与无效样例全部通过。

### Task 2: 实现受控 Git 历史读取与固定端点

**Files:**

- Create: `packages/server/src/git-history.ts`
- Create: `packages/server/src/git-history.test.ts`
- Modify: `packages/server/src/routes/project-git-routes.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `GitCommandExecutor`、`ProjectGitHistorySchema`、`ServerRouteContext.getProjectContext`
- Produces: `readProjectGitHistory(projectRoot)` 与 `GET /v1/projects/:projectId/git/history`

**Behavior:**

- 使用固定 `git log` 参数和 NUL 字段分隔解析提交；根仓库直接读取，非根仓库只枚举直属 Git 子仓库并验证所选 Tab；每页读取 21 条以生成下一页游标并仅返回 20 条，拒绝相对 Project 根路径和未知子仓库，并在 HTTP 边界将 Git/文件系统错误收敛为不含宿主路径的错误。

**Stop Conditions:**

- 如果 `simple-git` 输出不能无损保留 NUL 分隔字段，停止并改用同一受控执行边界可验证的固定记录编码，不使用换行或临时文件解析。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/git-history.test.ts packages/server/src/app.test.ts`

Expected: 根仓库、直属子仓库聚合、排序/上限、非法根路径、项目不存在和读取失败测试全部通过。

### Task 3: 接入类型安全 Client 与按需 Query

**Files:**

- Modify: `packages/client/src/http-client-projects.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/web/src/features/projects/project-query-options.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`

**Interfaces:**

- Consumes: `ProjectGitHistorySchema` 与 `GET /v1/projects/:projectId/git/history`
- Produces: `CodexlyClient.getProjectGitHistory`、`CodexlyGitHistoryClient`、`projectGitHistoryInfiniteQueryOptions`

**Behavior:**

- Client 对编码后的 Project ID、仓库名和游标发起只读请求并严格校验响应；Infinite Query 按 Project 与仓库建立稳定键，通过 `enabled` 确保只有弹窗打开时才读取并使用 `nextCursor` 继续分页。

**Stop Conditions:**

- 如果现有 Query 契约不能在不扩大工作台 Client 权限面的前提下暴露读取方法，则停止并调整最小 `Pick` 类型。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/client/src/http-client.test.ts apps/web/src/features/projects/project-queries.test.tsx`

Expected: 请求路径、Schema 拒绝和按需 Query 配置测试全部通过。

### Task 4: 将历史入口移动到 Composer 当前分支旁

**Files:**

- Create: `apps/web/src/features/workbench/components/git-history-dialog.tsx`
- Create: `apps/web/src/features/workbench/components/git-history-dialog.test.tsx`
- Delete: `apps/web/src/features/workbench/components/workbench-inspector-header-actions.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-active-task.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-dialogs.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `tests/e2e/app-shell-inspector-layout.spec.ts`

**Interfaces:**

- Consumes: `projectGitHistoryInfiniteQueryOptions`、`ProjectGitHistoryPage`、现有 `Dialog`/`Tabs`/`Button`/`Tooltip` 组件
- Produces: Composer 分支旁 Git 历史图标入口、`GitHistoryDialog`、打开/关闭与焦点恢复流程

**Behavior:**

- 在中栏 Composer 底部的当前分支控件旁显示带 Tooltip 的历史图标，按钮高度、图标尺寸、前景色和交互态与同一区域控件一致；Inspector 不再保留旧入口。点击后懒加载弹窗并按需请求，关闭时清理当前 Project 历史缓存并把焦点恢复到新入口。直属子仓库使用 Tab 分开展示并在单次打开期间保留各自分页缓存，默认加载最近 20 条，用户可继续加载下一页；弹窗展示提交标题、短 SHA、作者和绝对时间，并覆盖加载、重试、空历史和关闭状态；移动端内容不溢出且列表区域独立滚动。

**Stop Conditions:**

- 如果入口无法复用 Composer 底部现有分支状态，或新增按钮破坏 `320px` 单行布局，则停止并先调整该行的最小宽度与收缩边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/git-history-dialog.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx && pnpm exec playwright test tests/e2e/app-shell-inspector-layout.spec.ts`

Expected: 组件契约测试与真实浏览器点击、加载、列表、关闭、干净工作区入口和窄屏布局测试全部通过。

### Task 5: 更新持久规范并执行完整门禁

**Files:**

- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: 已实现的固定 Git 历史端点与 Inspector 弹窗行为
- Produces: 持久化后端安全边界和 Web 交互规范

**Behavior:**

- 记录 Git 历史固定读取当前 `HEAD`、根/直属子仓库 Tab、每页 20 条与游标响应规则，以及 Composer 分支旁入口和按需弹窗交互；运行项目全量检查和 E2E 验证。

**Stop Conditions:**

- 如果全量门禁发现与本功能无关的既有失败，停止修改无关代码并报告可复现命令与失败证据。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 类型、Lint、格式、依赖边界、单元测试和浏览器关键流程全部通过。
