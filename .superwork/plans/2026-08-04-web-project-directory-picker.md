# Web Project Directory Picker Implementation Plan

**Goal:** 使用浏览器内目录树替代宿主系统目录选择器，使已配对的 LAN 浏览器能够浏览服务端目录并添加 Project。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包边界、验证命令与发布要求。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Project 添加入口、shadcn Dialog、AI Elements 与 i18n。
- `.superwork/spec/frontend/type-safety.md` — 约束 Protocol Schema、Client 边界校验与 Query 输入。
- `.superwork/spec/backend/quality-guidelines.md` — 约束文件系统输入校验、错误映射和路由测试。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Client 与 Server 的依赖方向。
- `docs/web-design.md` — 约束工作台视觉、AI Elements `FileTree` 与 Web/Server 职责。

**Architecture:** 新增 Host 目录分页式按需浏览契约，Server 从用户主目录开始列出可访问的直接子目录并允许向父目录导航；Web 使用受控 AI Elements `FileTree` 和 shadcn `Dialog` 选择绝对目录，再通过显式 `rootPath` Mutation 注册 Project。删除 CLI 到原生系统目录选择器的旧链路。

**Tech Stack:** TypeScript、Fastify、TypeBox、React 19、TanStack Query、AI Elements、shadcn/ui、Tailwind CSS 4、Vitest、Playwright。

## Global Constraints

- 所有浏览器响应必须经过 `@codexly/protocol` Schema 和 `@codexly/client` 校验，Web 不直接访问 Server 实现。
- 目录浏览只返回目录元数据，不返回文件内容；路径必须为服务端绝对目录，并在文件系统边界完成规范化和错误映射。
- 仅已通过现有 Access 门禁的请求可以浏览或注册目录，不新增 LAN 兼容分支或浏览器持久凭证。
- 使用已有 `apps/web/src/shared/ai-elements/file-tree.tsx`、shadcn `Dialog` 和 `Button`，不覆盖 Registry 组件或新增 UI 依赖。
- 新文案同时提供 `zh-CN` 与 `en`，绝对路径保持原样展示。
- 删除不再使用的宿主系统目录选择实现与注入接口，不保留旧请求体或取消响应兼容逻辑。
- 不启动开发服务器；最终运行 `.superwork/config.json` 声明的验证命令。

### Task 1: 定义目录浏览与 Project 注册契约

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `ProjectSchema`、`CodexlyClient.#read`、`CodexlyClient.#mutation`
- Produces: `ProjectDirectoryQuery`、`ProjectDirectoryListing`、`AddProjectRequest`、`CodexlyClient.listProjectDirectories`、`CodexlyClient.addProject(rootPath)`

**Behavior:**

- 校验可选绝对目录 Query、目录列表响应和显式 `rootPath` 注册请求；Client 正确编码目录 Query、验证响应，并以幂等 Mutation 提交所选目录。

**Stop Conditions:**

- 若现有 Protocol 无法表达 Windows 与 POSIX 绝对路径而不放宽 NUL/换行安全边界，则停止并调整路径 Schema 后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts`

Expected: 新增目录浏览、路径编码和显式 Project 注册契约测试通过。

### Task 2: 实现服务端目录浏览并移除原生选择器

**Files:**

- Create: `packages/server/src/project-directory-browser.ts`
- Create: `packages/server/src/project-directory-browser.test.ts`
- Modify: `packages/server/src/routes/project-routes.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `src/cli-command.ts`
- Modify: `src/cli-command.test.ts`
- Modify: `tests/realtime-path.test.ts`
- Modify: `tests/fixtures/fake-realtime-server.mjs`
- Delete: `src/system-directory-picker.ts`
- Delete: `src/system-directory-picker.test.ts`

**Interfaces:**

- Consumes: `ProjectDirectoryQuery`、`AddProjectRequest`、`ProjectRepository.register`
- Produces: `readProjectDirectory`、`GET /v1/project-directories`、更新后的 `POST /v1/projects`

**Behavior:**

- 无 Query 时从服务端用户主目录返回规范化当前路径、父目录与排序后的直接子目录；显式路径必须存在、可读且为目录，忽略符号链接和非目录项；注册接口只接受已选 `rootPath` 并删除原生目录选择注入链路。

**Stop Conditions:**

- 若目录读取错误无法稳定区分无效路径、权限拒绝与内部 I/O 故障，则停止并先定义一致的 HTTP 错误映射。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/project-directory-browser.test.ts packages/server/src/app.test.ts src/cli-command.test.ts`

Expected: 服务端目录浏览、注册、Access 门禁与 CLI 装配测试通过，仓库中不再引用 `selectProjectDirectory`。

### Task 3: 使用 FileTree 和 shadcn Dialog 改造添加 Project

**Files:**

- Create: `apps/web/src/features/projects/components/project-directory-picker-dialog.tsx`
- Create: `apps/web/src/features/projects/components/project-directory-picker-dialog.test.tsx`
- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: `apps/web/src/features/projects/project-context.test.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`

**Interfaces:**

- Consumes: `CodexlyClient.listProjectDirectories`、`CodexlyClient.addProject(rootPath)`、AI Elements `FileTree`、shadcn `Dialog`、`Button`
- Produces: `ProjectDirectoryPickerDialog`、显式路径版 `ProjectActionsContext.addProject`

**Behavior:**

- 点击 Sidebar 的添加按钮打开可访问 Dialog；Dialog 默认加载服务端主目录，支持向上导航、按需展开子目录、选择当前目录、加载/空/错误/重试状态，以及取消和单飞添加；成功后关闭弹窗、刷新列表、展开并导航到新 Project，窄屏内容与操作按钮保持可用。

**Stop Conditions:**

- 若现有 `FileTreeFolder` 无法在不破坏 Inspector 行为的前提下表达异步目录与选中状态，则停止并通过向后无关的新 Props 扩展官方组件公开 API。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/components/project-directory-picker-dialog.test.tsx apps/web/src/features/projects/project-context.test.tsx apps/web/src/features/workbench/components/project-sidebar.test.tsx`

Expected: Dialog 组合、目录展开、错误重试、取消、单飞提交和成功导航相关测试通过。

### Task 4: 更新持久规范与浏览器流程覆盖

**Files:**

- Modify: `.superwork/spec/guides/index.md`
- Modify: `.superwork/spec/backend/quality-guidelines.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `README.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`
- Modify: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Modify: `tests/e2e/lan-access.spec.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`

**Interfaces:**

- Consumes: Web Project 目录选择流程、Playwright API Fixture
- Produces: 更新后的工程约束、用户说明与 Project 添加 E2E 场景

**Behavior:**

- 将“宿主系统目录选择器”约束替换为 Web 目录树流程，并让 E2E Fixture 模拟目录列表与显式 `rootPath` 注册，覆盖打开、选择、取消、错误、成功添加及 LAN 配对后浏览主路径。

**Stop Conditions:**

- 若 E2E Fixture 无法在不依赖真实主机目录的情况下稳定表达目录浏览，则停止并先增加确定性的 API Stub 数据模型。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-inspector-layout.spec.ts`

Expected: Project 添加的浏览器目录选择流程通过，且不触发任何宿主 GUI。
