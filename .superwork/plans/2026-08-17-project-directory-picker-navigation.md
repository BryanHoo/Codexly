# Project Directory Picker Navigation Implementation Plan

**Goal:** 让左栏“添加项目”的文件夹选择器支持绝对路径导航，并默认隐藏隐藏目录、允许用户显式切换显示模式。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、验证命令与文件长度。
- `.superwork/spec/frontend/component-guidelines.md` — 约束共享控件、可访问性与查询缓存行为。
- `.superwork/spec/frontend/type-safety.md` — 约束 Protocol、Client 和 Web 类型边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束组件测试与浏览器流程覆盖。
- `.superwork/spec/backend/directory-structure.md` — 约束文件系统浏览接口的实现归属。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Fastify Schema、错误边界与测试。
- `.superwork/spec/shared/quality-guidelines.md` — 约束跨包契约同步和验证。

**Architecture:** 扩展现有 `ProjectDirectoryQuery` 的 `includeHidden` 字段，让 Client、Fastify 和目录浏览器统一传递该模式；将宿主附件选择器现有顶部导航提取为项目选择器可复用的通用文件系统工具栏，两个调用方各自维护路径草稿、显示模式和独立 Query Key。

**Tech Stack:** TypeScript、React、TanStack Query、Fastify、TypeBox、Vitest、Playwright、pnpm。

## Global Constraints

- 使用项目现有 `pnpm` 命令，Python 命令只使用 `python3`。
- 保留工作树中已有修改，并把本次改动限制在目录浏览链路。
- 生产代码文件不得超过 500 行；关键状态重置逻辑添加简短中文注释。
- 不启动开发服务器，不添加提交步骤。

### Task 1: 扩展项目目录隐藏项查询契约

**Files:**

- Modify: `packages/protocol/src/project-files.ts`
- Test: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/http-client-projects.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/index.ts`
- Test: `packages/client/src/http-client.test.ts`
- Modify: `packages/server/src/project-directory-browser.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/project-routes.ts`
- Test: `packages/server/src/project-directory-browser.test.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `ProjectDirectoryQuerySchema`, `ProjectHttpClient.listProjectDirectories`, `ServerRouteContext.readProjectDirectory`
- Produces: 可选严格布尔字段 `includeHidden`、默认过滤点前缀目录的浏览行为、显式显示隐藏目录的查询链路

**Behavior:**

- 缺省项目目录请求不编码 `includeHidden` 并过滤隐藏目录；显式启用时编码 `includeHidden=true`，Fastify 校验并让目录浏览器返回隐藏目录。

**Stop Conditions:**

- 如果项目目录接口无法在不改变现有响应结构的前提下表达显示模式，则停止并修订计划。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts packages/server/src/project-directory-browser.test.ts packages/server/src/app.test.ts`

Expected: 目标契约、Client 编码、Server 路由和目录过滤测试全部通过。

### Task 2: 复用文件系统工具栏并接入项目选择器

**Files:**

- Create: `apps/web/src/features/projects/components/filesystem-picker-toolbar.tsx`
- Delete: `apps/web/src/features/workbench/components/host-file-picker-toolbar.tsx`
- Modify: `apps/web/src/features/workbench/components/host-attachment-picker-dialog.tsx`
- Test: `apps/web/src/features/workbench/components/host-attachment-picker-dialog.test.tsx`
- Modify: `apps/web/src/features/projects/components/project-directory-picker-dialog.tsx`
- Test: `apps/web/src/features/projects/components/project-directory-picker-dialog.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`

**Interfaces:**

- Consumes: `ProjectDirectoryListing`、`HostFileListing` 的共同路径/根目录结构，以及 `CodexlyClient.listProjectDirectories`
- Produces: `FilesystemPickerToolbar` 和带绝对路径输入、Enter/按钮导航、`aria-pressed` 隐藏项开关的项目文件夹选择器

**Behavior:**

- 项目选择器复用顶部工具栏；路径导航、根目录导航和上级导航重置旧树状态；隐藏模式切换让根节点及已展开节点通过包含模式的 Query Key 重新读取，并清除旧选择。

**Stop Conditions:**

- 如果共享工具栏会导致 `projects` 与 `workbench` 形成反向依赖，停止并调整组件归属后修订计划。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/components/project-directory-picker-dialog.test.tsx apps/web/src/features/workbench/components/host-attachment-picker-dialog.test.tsx`

Expected: 两个选择器的静态渲染、可访问标签、Windows 根目录和隐藏项状态测试全部通过。

### Task 3: 覆盖左栏项目选择器浏览器流程

**Files:**

- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `tests/e2e/app-shell-inspector-layout.spec.ts`

**Interfaces:**

- Consumes: 左栏“添加项目”入口、`GET /v1/project-directories` 查询参数和项目选择器控件标签
- Produces: 绝对路径提交、默认隐藏和显式显示隐藏目录的 Playwright 回归

**Behavior:**

- 从左栏打开选择器后可输入绝对路径并按 Enter 导航；隐藏目录默认不可见，切换后可见，同时请求携带 `includeHidden=true`。

**Stop Conditions:**

- 如果现有 E2E fixture 无法区分缺省和显式显示模式，停止并修订 fixture 契约后继续。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-inspector-layout.spec.ts --grep "project directory picker"`

Expected: 左栏项目目录选择器新增与既有流程全部通过。

### Task 4: 固化目录选择器规范并完成整体验证准备

**Files:**

- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 已验证的 `ProjectDirectoryQuery.includeHidden` 和 `FilesystemPickerToolbar` 行为
- Produces: 项目目录选择器路径导航、隐藏项默认值和跨层查询键约束的持久规范

**Behavior:**

- 规范只记录长期架构约束，不记录一次性实施过程，并与宿主附件选择器的现有规则保持一致。

**Stop Conditions:**

- 如果实现尚未通过前三项任务验证，则不得提前固化规范。

- [x] **Task Status:** completed

Run: `git diff --check`

Expected: 规范更新与代码变更不存在空白错误，计划可交给最终 `superwork-check`。
