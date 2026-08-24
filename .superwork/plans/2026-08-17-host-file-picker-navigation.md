# Feature Implementation Plan

**Goal:** 让 Composer 宿主文件选择器支持直接输入绝对目录路径，并默认隐藏点号开头的隐藏文件和目录，用户可显式切换显示隐藏项。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、验证命令与文件长度。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Composer 宿主文件选择器、共享控件和移动端交互。
- `.superwork/spec/frontend/type-safety.md` — 约束 Protocol、Client 与 Web 的运行时类型边界。
- `.superwork/spec/backend/directory-structure.md` — 约束宿主文件浏览接口和绝对路径安全边界。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Fastify Schema、错误映射和测试。
- `.superwork/spec/shared/quality-guidelines.md` — 约束严格查询 Schema 与所有消费者同步。

**Architecture:** 在 `HostFileQuery` 增加可选 `includeHidden`，由 Client 显式传递并由 Server 在读取直接子项时过滤点号项；Web 将当前路径工具栏改为可提交的绝对目录输入，并用图标按钮切换隐藏项，查询键同时包含路径和显示模式以避免缓存串用。项目文件夹选择器不改变。

**Tech Stack:** TypeScript、React、TanStack Query、Tailwind CSS、Fastify、TypeBox、Vitest、Playwright、pnpm。

## Global Constraints

- 保持所有宿主路径为严格绝对路径，继续拒绝符号链接与不支持的文件类型。
- 默认不发送或按 `false` 处理 `includeHidden`，只有用户显式开启时列出名称以 `.` 开头的直接子项。
- 隐藏项切换必须覆盖当前根目录和展开目录的 Query Key，不能复用另一模式的缓存。
- 顶部路径提交必须支持 Enter，失败时保留输入以便修正，并继续复用现有错误状态。
- 使用现有 `Input`、`Button`、`Tooltip` 和 i18n 资源，移动端保持无横向溢出与可操作触控目标。
- 生产代码文件不得超过 500 行；关键路径只添加必要、清晰的中文注释。

### Task 1: 扩展宿主文件浏览查询与隐藏项过滤

**Files:**

- Modify: `packages/protocol/src/project-files.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/http-client-projects.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `packages/server/src/host-file-browser.ts`
- Modify: `packages/server/src/host-file-browser.test.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/project-routes.ts`
- Modify: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `HostFileQuerySchema`、`CodexlyClient.listHostFiles`、`readHostFileDirectory`
- Produces: 可选 `includeHidden` 查询契约和默认过滤隐藏项的宿主目录列表

**Behavior:**

- 验证默认请求排除名称以 `.` 开头的真实目录和受支持文件，`includeHidden: true` 时包含它们，同时保持排序、类型过滤和符号链接拒绝规则；验证 Client 编码查询参数且 Fastify 将其传给浏览服务。

**Stop Conditions:**

- 若现有 Fastify 查询参数无法按严格布尔 Schema 稳定转换，停止并先确定唯一的字符串枚举契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts packages/server/src/host-file-browser.test.ts packages/server/src/app.test.ts`

Expected: 宿主文件查询、隐藏项过滤、Client URL 和 Fastify 透传测试全部通过。

### Task 2: 实现绝对路径输入和隐藏项切换

**Files:**

- Create: `apps/web/src/features/workbench/components/host-file-picker-toolbar.tsx`
- Modify: `apps/web/src/features/workbench/components/host-attachment-picker-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/host-attachment-picker-dialog.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`

**Interfaces:**

- Consumes: `CodexlyHostAttachmentClient.listHostFiles`、`HostFileListing`、共享 `Input`/`Button`/`Tooltip`
- Produces: 可提交的 `HostFilePickerToolbar`、显示/隐藏点号项按钮及隔离的 TanStack Query 缓存键

**Behavior:**

- 在顶部工具栏展示可编辑的绝对路径输入，Enter 或前往按钮提交后清理旧选择与展开状态并读取目标目录；默认查询隐藏项关闭，切换后重新读取当前目录与展开节点，按钮具备可访问名称和明确按下状态。

**Stop Conditions:**

- 若共享 `Input` 无法嵌入紧凑工具栏或现有 Dialog 在 320px 宽度发生不可消除的结构冲突，停止并拆分共享路径工具栏组件。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/host-attachment-picker-dialog.test.tsx`

Expected: 静态组件测试确认路径输入、提交动作、默认隐藏状态、切换按钮和 Windows 根目录选择器同时存在。

### Task 3: 覆盖真实文件选择交互并完成质量验证

**Files:**

- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `tests/e2e/app-shell-composer.spec.ts`

**Interfaces:**

- Consumes: `/v1/host-files` E2E 路由、`HostAttachmentPickerDialog` 用户交互
- Produces: 绝对路径导航、隐藏项显隐和窄屏布局的 Playwright 回归证据

**Behavior:**

- 验证文件选择器初始请求不显示隐藏项，输入绝对目录并提交会发起目标路径请求，开启显示隐藏项后请求携带 `includeHidden=true` 并显示隐藏文件，同时 320px 视口不产生横向溢出。

**Stop Conditions:**

- 若现有全局 E2E fixture 无法按查询参数返回不同目录内容，停止并先增加局部路由覆盖，不能降低断言为仅检查文案。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-composer.spec.ts --grep "host file picker"`

Expected: 绝对路径、隐藏项切换和窄屏布局回归用例通过；随后 `pnpm check` 与 `pnpm test:e2e` 全量通过。
