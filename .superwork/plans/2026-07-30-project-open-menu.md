# Feature Implementation Plan

**Goal:** 将工作台中栏右上角的“打开位置”占位按钮替换为可访问的图标菜单，并只提供当前 macOS、Linux 或 Windows 宿主实际支持的项目文件夹、VS Code、终端打开方式。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束全仓验证命令与包边界。
- `.superwork/spec/backend/directory-structure.md` — 约束路径与命令能力不得成为任意透传接口。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Project 路径校验、Schema 与 Fastify 路由测试。
- `.superwork/spec/frontend/component-guidelines.md` — 约束紧凑工作台、可访问菜单和图标按钮。
- `.superwork/spec/frontend/hook-guidelines.md` — 约束悬停菜单事件监听与清理。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束交互测试、键盘操作和响应式检查。
- `.superwork/spec/frontend/type-safety.md` — 约束浏览器响应必须经过 Protocol Schema。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Client 与 Server 的依赖方向。
- `docs/architecture-design.md` — 约束浏览器仅通过本地 Server 的受控 API 操作项目。
- `docs/project-structure.md` — 确认跨包公开入口与测试归属。
- `docs/web-design.md` — 保持工作台顶部工具区现有视觉密度和交互语义。

**Architecture:** 在 Protocol 定义固定 `folder | vscode | terminal` 目标及平台能力响应；Client 暴露查询和 Mutation；Server 根据 `process.platform` 与可执行文件探测构造受控启动器，只接受已注册 `projectId`；Web 将能力查询结果渲染为 `FolderOpen` 图标触发器，并用 hover、click、focus 和键盘共同控制菜单。

**Tech Stack:** TypeScript、TypeBox、Fastify、React 19、TanStack Query、Lucide React、Vitest、Playwright、pnpm。

## Global Constraints

- 浏览器不得提交文件系统路径、可执行文件名或参数，只能提交 Protocol 固定目标。
- Server 每次打开前必须从 `ProjectRepository` 读取 Project，并使用其 `rootPath`。
- 子进程必须使用参数数组、禁用 Shell，并与 Server 生命周期解耦；探测失败的目标不得显示。
- 菜单保持现有工作台紧凑视觉，支持 hover、click、focus、Escape 与菜单项键盘访问。
- 关键跨平台分支添加简短、清晰的中文注释，不保留旧的禁用文字按钮。

### Task 1: 定义打开目标协议与客户端 API

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `apps/web/src/features/projects/project-queries.ts`

**Interfaces:**

- Consumes: `ProjectSchema`、`CodeAgentClient.#read`、`CodeAgentClient.#mutation`
- Produces: `ProjectOpenTarget`、`ProjectOpenCapabilitiesResponse`、`OpenProjectRequest`、`OpenProjectResponse`、`CodeAgentClient.getProjectOpenCapabilities()`、`CodeAgentClient.openProject()`、`CodeAgentProjectOpenClient`

**Behavior:**

- 固定枚举并严格校验打开目标；Client 使用 Project 作用域的能力查询与幂等 Mutation，URL 编码和响应校验沿用现有约束。

**Stop Conditions:**

- 如果目标命名无法同时表达文件夹、VS Code 和终端，停止并重新确认协议语义。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts`

Expected: 新增 Schema 严格性和 Client 请求断言通过。

### Task 2: 实现跨平台能力探测与受控启动路由

**Files:**

- Create: `packages/server/src/project-open.ts`
- Create: `packages/server/src/project-open.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `ProjectRepository.read()`、`ProjectOpenTarget`、`OpenProjectRequestSchema`
- Produces: `createProjectOpenService()`、`GET /v1/projects/:projectId/open-capabilities`、`POST /v1/projects/:projectId/open`

**Behavior:**

- macOS、Linux、Windows 分别探测并启动系统文件管理器、VS Code 和终端；路由仅对已注册项目执行受控动作，未知 Project 或当前系统不支持的目标返回结构化错误。

**Stop Conditions:**

- 如果某平台实现需要 Shell 字符串拼接或接受浏览器路径，停止并改用安全的固定可执行文件与参数数组。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/project-open.test.ts packages/server/src/app.test.ts`

Expected: 三个平台的探测/启动参数、Project 归属、错误映射和幂等请求测试通过。

### Task 3: 实现工作台项目打开图标菜单

**Files:**

- Create: `apps/web/src/features/workbench/components/project-open-menu.tsx`
- Create: `apps/web/src/features/workbench/components/project-open-menu.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `CodeAgentProjectOpenClient`、`ProjectOpenCapabilitiesResponse`、`projectId`
- Produces: `ProjectOpenMenu` 图标触发器、悬停/焦点菜单与打开 Mutation 反馈

**Behavior:**

- 使用 Lucide `FolderOpen` 作为右上角图标；hover、click 或 focus 打开菜单，仅渲染能力响应支持的项目文件夹、VS Code、终端选项，选择后调用对应 Mutation，并支持 Escape、外部点击和加载/错误状态。

**Stop Conditions:**

- 如果菜单会被工作台裁剪、移动端文字溢出或无法通过键盘操作，停止并修正定位与焦点行为后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-open-menu.test.tsx && pnpm test:e2e -- --grep "project open menu"`

Expected: 组件语义测试通过，Playwright 验证 hover 展开、能力过滤和点击请求。
