# Feature Implementation Plan

**Goal:** 右栏 Project 文件树的文件和文件夹支持右键选择宿主应用，并用中栏现有“在...打开”应用列表安全打开对应目标。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包边界、验证命令和安全要求。
- `.superwork/spec/backend/directory-structure.md` — 约束 Project 相对路径、宿主应用白名单和 Server 路由职责。
- `.superwork/spec/backend/quality-guidelines.md` — 约束外部路径输入校验、错误映射与测试。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Workbench 组件职责、复用和可访问交互。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束右键菜单的组件测试与浏览器流程验证。
- `.superwork/spec/frontend/type-safety.md` — 约束 Web 只消费 Protocol 和 Client 暴露的类型安全接口。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Client、Server 与 Web 的依赖方向。

**Architecture:** 扩展现有 Project 打开请求以携带可选的 Project 相对路径，由 Server 解析并验证目标仍位于 Project 内，再按应用类别生成适合文件或目录的启动参数。Web 复用 `ProjectOpenMenuItems` 的应用列表，在 Inspector 文件树节点上提供固定定位的右键菜单，并通过 Workbench Shell 的单一 Mutation 调用扩展后的 Client 接口。

**Tech Stack:** TypeScript、TypeBox、Fastify、React 19、TanStack Query、Vitest、Testing Library、Playwright。

## Global Constraints

- 浏览器只能提交 `projectId`、固定白名单应用 ID 和经过 Protocol 校验的 Project 相对路径，绝对路径不得跨越 Server 边界。
- Server 必须从 Repository 读取 Project 根目录，拒绝绝对路径、父级跳转、符号链接和 Project 外目标，并继续使用参数数组与 `shell: false` 启动应用。
- 中栏 Project 根目录打开行为继续使用同一请求契约；右栏菜单只复用应用选项，不修改用户已保存的默认打开应用。
- 目录交给所选应用直接打开；文件交给编辑器或工具，文件管理器定位或打开其所在目录，终端在文件所在目录启动。
- 右键菜单必须支持外部点击和 `Escape` 关闭、首项聚焦、视口边缘定位，并在打开请求进行中禁用重复操作。
- 不启动开发服务器；最终按项目要求运行 `pnpm check` 和 `pnpm test:e2e`。

### Task 1: 扩展 Project 目标打开契约与 Client

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `ProjectOpenAppIdSchema`
- Produces: `OpenProjectRequest { appId: ProjectOpenAppId; path?: ProjectRelativePath }`
- Produces: `OpenProjectResponse { appId: ProjectOpenAppId; path?: ProjectRelativePath }`
- Produces: `CodexlyClient.openProject(projectId: string, request: OpenProjectRequest, options?: MutationOptions)`

**Behavior:**

- 让打开请求和响应接受可选的规范化 Project 相对路径，并拒绝绝对路径、反斜杠、空段、`.`、`..` 和尾随斜杠。
- 将 Client 改为发送完整 `OpenProjectRequest`；Project 根目录打开不携带 `path`，右栏目标打开携带对应文件树路径。

**Stop Conditions:**

- 如果现有 Project 文件树路径契约不能抽取为单一可复用 Schema，则停止并先消除 Protocol 内相互冲突的路径定义。

- [x] **Task Status:** completed

Run: `pnpm test -- packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts`

Expected: Protocol 接受合法目标路径并拒绝越界形式，Client 请求体同时覆盖根目录和具体目标两种调用。

### Task 2: 在 Server 安全解析并按应用类别打开目标

**Files:**

- Modify: `packages/server/src/project-open.ts`
- Modify: `packages/server/src/project-open.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `.superwork/spec/backend/directory-structure.md`

**Interfaces:**

- Consumes: `OpenProjectRequest { appId: ProjectOpenAppId; path?: ProjectRelativePath }`
- Produces: `ProjectOpenService.open(projectRoot: string, appId: ProjectOpenAppId, projectRelativePath?: string)`
- Produces: `POST /v1/projects/:projectId/open -> OpenProjectResponse`

**Behavior:**

- 在启动宿主应用前逐段解析 Project 相对路径，确认目标存在、不是符号链接且真实路径仍位于 Project 根目录内。
- 编辑器和工具接收具体目标；终端以目录目标或文件父目录作为工作目录；macOS Finder、Linux 文件管理器和 Windows Explorer 对文件使用各平台可用的定位或父目录语义。
- 将目标路径纳入幂等 Payload，返回实际请求的可选相对路径，并把非法或不存在的目标映射为受控 `400` 错误。

**Stop Conditions:**

- 如果任一平台必须通过 Shell 字符串或未受控命令才能打开目标，则停止并保留该平台的受控参数数组实现，不扩大命令执行面。

- [x] **Task Status:** completed

Run: `pnpm test -- packages/server/src/project-open.test.ts packages/server/src/app.test.ts`

Expected: 三个平台的文件与目录参数测试通过，越界、符号链接和不存在目标不会触发进程启动，路由幂等行为包含目标路径。

### Task 3: 为 Inspector 文件树添加复用打开选项的右键菜单

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-open-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: `CodexlyClient.openProject(projectId: string, request: OpenProjectRequest, options?: MutationOptions)`
- Consumes: `ProjectOpenMenuItems`
- Produces: `ProjectOpenContextMenu`
- Produces: `WorkbenchInspector.onOpenProjectPath(appId: ProjectOpenAppId, path: string)`

**Behavior:**

- 文件与文件夹节点右键时阻止浏览器默认菜单，记录目标路径和指针位置，并渲染复用 `ProjectOpenMenuItems` 应用名称、图标与禁用状态的命令菜单。
- 点击应用立即关闭菜单，并通过 Workbench Shell Mutation 使用该应用打开右键目标；不写入中栏默认应用偏好。
- 菜单在视口内定位，支持外部点击和 `Escape` 关闭、首项聚焦、进行中禁用以及可访问名称；根目录加载失败或没有可用应用时不提供无效命令。
- 浏览器流程同时验证文件和文件夹右键、请求 Payload、菜单关闭与中栏默认打开行为不回归。

**Stop Conditions:**

- 如果文件树基础组件无法在不覆盖选择、展开和键盘事件的情况下透传 `onContextMenu`，则停止并先为 `FileTreeFile` 与 `FileTreeFolder` 添加组合事件契约及独立测试。

- [x] **Task Status:** completed

Run: `pnpm test -- apps/web/src/features/workbench/components/project-open-menu.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx && pnpm test:e2e -- --grep "project file tree"`

Expected: 组件测试证明菜单复用和目标回调正确，Playwright 证明右键文件或文件夹后选择应用会发送对应 `appId` 与 `path`。
