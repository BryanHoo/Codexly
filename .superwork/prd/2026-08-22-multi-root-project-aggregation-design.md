# 多根项目聚合设计

## Goal

让 Codexly 完整投影 Codex `0.149.0` 的多根 Project：添加项目时可选择多个有序目录，启动时同步 Codex 已有聚合 Project，并允许用户在工作台切换当前根以查看对应路径、Git 分支、文件、变更和历史；Project 身份、Task 归属和排序继续以 Codex `projectId` 为唯一真相。

## Suggested Spec Reads

- `.superwork/spec/guides/index.md`
- `.superwork/spec/backend/directory-structure.md`
- `.superwork/spec/backend/runtime-lifecycle.md`
- `.superwork/spec/backend/quality-guidelines.md`
- `.superwork/spec/frontend/component-guidelines.md`
- `.superwork/spec/frontend/hook-guidelines.md`
- `.superwork/spec/frontend/state-management.md`
- `.superwork/spec/frontend/quality-guidelines.md`
- `.superwork/spec/frontend/type-safety.md`
- `.superwork/spec/shared/directory-structure.md`
- `.superwork/spec/shared/quality-guidelines.md`
- `docs/architecture-design.md`
- `docs/project-structure.md`

## Existing Context

- Codexly 已使用 Codex `projectId` 作为公开 Project ID，并在启动时分页调用 `project/list` 覆盖 SQLite 投影。
- 当前 Provider 严格读取 Codex `roots[]`，但公共 `Project` 只保留 `rootPath = roots[0].path`；SQLite、HTTP、Client 和 Web 因而丢失其他根。
- 当前添加接口只接受 `rootPath`，固定调用 `project/create { roots: [{ path }] }`。
- Git、文件树、文件搜索、预览与宿主打开均从 Project 的单个 `rootPath` 解析，前端 Query Key 也没有根作用域。
- Codex `0.149.0` 的 `Project`、`ProjectCreateParams` 与 `ProjectUpdateParams` 使用有序 `roots: ProjectRoot[]`；App Server 会拒绝非绝对路径和逻辑或 canonical 重复根。
- 官方 OpenAI 文档说明多文件夹本地项目以首文件夹作为 primary；新聊天、Git、`AGENTS.md`、Skill 与 `config.toml` 自动发现使用 primary，secondary 目录仍可搜索、读取和编辑。

## Considered Approaches

### 方案 A：只投影 `roots[]`，界面仍固定首根

改动集中在 Project Schema 和持久化，但无法满足根选择、分支、历史和右栏内容切换。

### 方案 B：在 Server 保存每个 Project 的当前根

路由无需重复传根，但选择成为跨浏览器共享的隐式状态；刷新、并发客户端和失败重试无法可靠复现同一请求。

### 方案 C：Project 聚合身份与显式根作用域分离

公共 Project 保存有序 `roots[]`；Web 为每个 Project 保存本地选择并默认首根；所有根相关 HTTP 请求显式携带 `rootPath`，Server 只接受当前 Project roots 中的精确成员。该方案改动较广，但数据流明确，支持多客户端并保持 Codex primary 语义。

## Recommended Approach

采用方案 C。删除公共单 `rootPath` 投影，不保留双字段或旧请求分支。Project 级 Task、设置、队列和事件继续只使用 `projectId`；文件系统与 Git 能力使用显式 `rootPath`。根数组顺序原样跟随 Codex，`roots[0]` 是 primary，前端选择缺失或失效时回退到它。

## Component Responsibilities And Interfaces

### Protocol And Core

- 定义严格 `ProjectRootSchema { path }`，`ProjectSchema` 改为非空、路径唯一的 `roots[]`。
- `AddProjectRequest` 改为有序非空 `roots[]`；目录选择顺序决定 primary。
- 定义可复用 `ProjectRootQuerySchema`/`ProjectRootRequestSchema`，把 `rootPath` 加入 Git、文件树、文件搜索、预览和宿主打开等根相关契约。
- `RegisterProjectInput` 改为 `roots`；`AgentTaskScope.rootPath` 仍是运行 Task 的 primary cwd，不把 UI 选择写入 Task。

### Codex Provider

- `mapCodexProject` 完整映射并校验全部 roots，保留顺序，拒绝空、非绝对和重复路径。
- `register` 原样调用 `project/create { roots }`；迁移旧 Thread 时仍按单 cwd 创建单根 Project。
- `forProject(project)` 使用 `project.roots[0].path` 作为 Codex Thread cwd，并传原生 `projectId`；Project 同步自然带回 Codex Desktop/CLI 已创建的多根聚合。

### Server And Persistence

- SQLite Project 投影用 `project_roots(project_id, position, path)` 保存有序根；Project 更新、替换、迁移和删除在同一事务维护 roots。
- 提供单一 `resolveProjectRoot(project, rootPath)`：缺省返回 primary，显式值必须精确属于 Project，否则返回稳定的非法根错误。
- Fastify 根相关路由在调用文件/Git服务前统一解析根；不得直接信任浏览器传入的绝对路径。
- Git Mutation 锁和分支缓存键包含 `projectId + rootPath` 或已解析根，避免同一聚合 Project 的不同仓库互相阻塞或污染。
- Worktree 创建仍产生新的单根 Codex Project，不把 worktree 隐式追加到现有聚合 roots。

### Client And Web State

- Client 的根相关方法显式接收 `rootPath` 并编码到 Query 或 Mutation；所有 TanStack Query Key 包含根路径。
- `ProjectProvider` 保存 `selectedRootPathByProjectId`，对外暴露当前 Project root 与切换动作；状态仅在用户操作时写入，渲染时校验 roots 并派生 primary 回退。
- Project 同步导致已选根消失时不保留陈旧路径；派生值立即回退首根。
- 添加项目对话框支持浏览目录、把当前目录加入有序选择、移除与调整 primary；重复目录不可加入，确认时至少包含一个目录。
- 中栏顶部仅在 `roots.length > 1` 时显示紧凑根选择器，展示目录名并用完整路径 Tooltip 消歧；默认首根。
- 中栏底部路径、分支、打开菜单，右栏 Project 文件树、Changes、History、文件搜索/引用与刷新全部使用当前根。
- 根切换不改变当前 Task、路由或聚合 Project 历史列表；只切换根级工作区视图。

## Data Flow

1. CLI 初始化 Codex App Server，`CodexProjectRepository.synchronize()` 分页读取 Project 并完整映射 `roots[]`。
2. SQLite 在事务中替换 Project 和有序 roots 投影，Server 向 Web 返回严格 Project Page。
3. Web 选择 Project 后从该 Project `roots[0]` 派生默认根；多根时在中栏顶部显示选择器。
4. 用户切换根后，根级 Query Key 变化；旧请求由 AbortSignal 取消，新请求携带 `rootPath`。
5. Server 校验 `rootPath` 属于 Project，再把已解析绝对根交给现有文件或 Git Adapter。
6. 新 Task 仍携带聚合 `projectId` 并在 primary cwd 启动；根切换不会迁移 Thread 或改变 Codex Project。

## Error Handling

- Codex Project roots 为空、非绝对、重复或字段漂移时抛出 `CodexProtocolMappingError`，不写入部分投影。
- 添加请求包含空 roots、重复目录或非法绝对路径时由 Protocol/Fastify 拒绝；Codex canonical 重复错误按 Provider Mutation 失败返回。
- 请求根不属于 Project 时返回稳定的 `400`，不泄漏文件系统存在性。
- Project 更新移除当前根时 Web 立即回退 primary，并取消旧根请求；旧响应不得进入 Query Cache。
- 当前根不是 Git 仓库时沿用稳定 `repositoryMode: "none"`，不影响其他根。
- SQLite roots 写入与 Project 写入必须同事务提交；任何失败保留上一个完整投影。

## Verification Strategy

- Protocol：覆盖 Project 多 roots、空数组、重复路径、Add 请求及每类根相关 Query/Mutation 的严格校验。
- Provider：覆盖多根顺序映射、`project/create` 参数、全量同步、非绝对/重复/空 roots 和 primary cwd。
- Persistence：覆盖 roots 的 upsert、replace、delete、排序与 Project ID 迁移事务。
- Server/Client：覆盖根成员校验、显式根转发、默认 primary、Query 编码和 Mutation 幂等。
- Web Vitest：覆盖默认首根、切换、根移除回退、多选添加、顶栏条件展示以及右栏/底栏根联动。
- Playwright：覆盖添加双根聚合、切换后路径/分支/Project 文件树/History 一致变化和刷新回退。
- 完成后运行聚焦 Vitest、`pnpm check` 与 `pnpm test:e2e`；按用户要求不启动开发服务器。

## Non-Goals

- 不修改 Codex Project 的 roots 编辑、拖拽排序或删除已有 root；本次只支持创建时多选和同步上游已有聚合。
- 不按 root 拆分 Task 列表、事件流、Project 设置或 Project 身份。
- 不让 secondary root 成为新 Task cwd；这由 Codex primary 规则决定。
- 不保留公共 `rootPath`、单根添加请求或双写兼容逻辑。
- 不改变 Project 排序、重命名、删除与 worktree 的既有产品语义。

## Success Criteria

- Codexly 启动后能显示 Codex 已有 Project 的全部有序 roots，Project ID 与顺序不变。
- 添加 Project 时可选择两个及以上目录，Codex 收到同序 `roots[]`，首项成为 primary。
- 多根 Project 默认显示首根，切换后中栏路径/分支和右栏 Project/Changes/History 均来自同一当前根。
- 单根 Project 不增加多余选择器，现有工作流保持紧凑。
- 任意客户端绝对路径不能越过 Project roots 授权边界。
- 聚焦测试、`pnpm check` 和 `pnpm test:e2e` 全部通过。
