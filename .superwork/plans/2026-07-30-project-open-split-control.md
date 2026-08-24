# Feature Implementation Plan

**Goal:** 将项目打开控件改为官方 App 风格的分段按钮：左侧显示并执行“在 xxx 中打开”，右侧下拉选择宿主已安装应用，并按 Project 恢复上次选择。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束全仓验证与跨包检查。
- `.superwork/spec/backend/directory-structure.md` — 约束受控 Project 路径和宿主应用白名单。
- `.superwork/spec/backend/quality-guidelines.md` — 约束进程探测、参数安全和路由测试。
- `.superwork/spec/frontend/component-guidelines.md` — 约束紧凑工作台、分段按钮和菜单可访问性。
- `.superwork/spec/frontend/state-management.md` — 约束服务端能力与本地 UI 偏好的状态边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束键盘、响应式和 Playwright 用户流程。
- `.superwork/spec/frontend/type-safety.md` — 约束应用目录必须经过 Protocol Schema。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Client、Server 和 Web 依赖方向。
- `docs/architecture-design.md` — 约束浏览器不接触本机路径和任意命令。
- `docs/project-structure.md` — 确认跨包实现与测试归属。
- `docs/web-design.md` — 保持工作台顶部操作区的紧凑视觉与稳定尺寸。

**Architecture:** Protocol 将笼统目标替换为固定应用 ID、名称和类别组成的宿主应用目录；Server 对 macOS、Linux、Windows 分别探测允许的编辑器、文件管理器和终端，并为每个应用保存固定启动参数；Web 用分段按钮消费目录，Project 级选择保存在版本化 localStorage，左侧执行选择、右侧只切换菜单。

**Tech Stack:** TypeScript、TypeBox、Fastify、React 19、TanStack Query、Lucide React、Vitest、Playwright、pnpm。

## Global Constraints

- 不保留旧的 `folder | vscode | terminal` 笼统协议，按新应用目录完整替换。
- 浏览器只能提交 Protocol 固定应用 ID，不提交路径、程序名或参数。
- Server 必须从 `ProjectRepository` 读取根目录，并使用参数数组、`shell: false` 与宿主可执行性检查。
- 左侧主按钮不显示图标，只显示“在 <应用名称> 中打开”；右侧 `ChevronDown` 独立控制菜单。
- 选择只按 Project ID 写入版本化浏览器存储；损坏、禁用或过期偏好回退到首个可用应用。
- 菜单支持 click、ArrowDown、Escape、外部点击和焦点离开关闭，不再由 hover 自动打开。

### Task 1: 将打开能力协议改为具体应用目录

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `CodexlyClient.#read`、`CodexlyClient.#mutation`
- Produces: `ProjectOpenAppId`、`ProjectOpenApp`、`ProjectOpenAppKind`、`ProjectOpenCapabilitiesResponse`、按 `appId` 请求的 `openProject()`

**Behavior:**

- 能力响应返回严格的应用对象数组，打开请求和响应使用固定应用 ID；未知 ID、额外路径和不完整应用对象必须被拒绝。

**Stop Conditions:**

- 如果应用 ID 不能覆盖三平台已批准的编辑器、文件管理器和终端，停止并修正白名单后继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts`

Expected: 新应用目录 Schema 与 Client 请求测试通过，旧目标形状不再通过。

### Task 2: 扩展三平台宿主应用目录与启动参数

**Files:**

- Modify: `packages/server/src/project-open.ts`
- Modify: `packages/server/src/project-open.test.ts`
- Modify: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `ProjectOpenAppId`、宿主环境变量、可执行路径检查
- Produces: macOS、Linux、Windows 的 `ProjectOpenApp[]` 能力目录和按应用 ID 启动行为

**Behavior:**

- macOS 探测 VS Code、Zed、Windsurf、Finder、Terminal、Ghostty、Xcode、Android Studio；Linux 和 Windows 探测各自允许的编辑器、文件管理器与终端，并保留每个已安装应用为独立选择。

**Stop Conditions:**

- 如果某个应用需要 Shell 字符串拼接、浏览器参数或未验证路径，停止并改用固定文件与参数数组。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/project-open.test.ts packages/server/src/app.test.ts`

Expected: 三平台应用过滤、顺序、显示名称、启动参数和路由幂等测试通过。

### Task 3: 实现 Project 级分段按钮与选择持久化

**Files:**

- Create: `apps/web/src/features/workbench/project-open-preferences.ts`
- Create: `apps/web/src/features/workbench/project-open-preferences.test.ts`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.test.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: `ProjectOpenApp[]`、`CodexlyProjectOpenClient`、Project ID、localStorage
- Produces: `readProjectOpenAppId()`、`writeProjectOpenAppId()`、左侧打开按钮、右侧选择按钮和应用菜单

**Behavior:**

- 左侧只显示“在 xxx 中打开”并直接调用当前应用；右侧下拉选择其他应用，选择后关闭菜单、更新左侧文案并按 Project 持久化，刷新后恢复；不可用旧选择自动回退。

**Stop Conditions:**

- 如果左右按钮职责混合、菜单仍由 hover 打开、文案溢出或偏好损坏会阻断控件，停止并修正后继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/project-open-preferences.test.ts apps/web/src/features/workbench/components/project-open-menu.test.tsx && pnpm test:e2e -- --grep "project open split control"`

Expected: 偏好与渲染测试通过，Playwright 验证右侧选择、左侧执行、刷新恢复和能力过滤。
