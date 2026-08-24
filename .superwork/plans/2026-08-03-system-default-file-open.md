# Feature Implementation Plan

**Goal:** 在 Inspector Project 文件树的文件右键“打开方式”中新增“系统默认应用”，由 macOS、Linux 和 Windows 使用该文件的系统默认关联应用打开。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包验证命令和宿主应用 smoke 范围。
- `.superwork/spec/backend/directory-structure.md` — 约束固定应用 ID、Project 相对路径和受控子进程参数。
- `.superwork/spec/backend/quality-guidelines.md` — 约束跨平台宿主打开测试与路径安全。
- `.superwork/spec/frontend/component-guidelines.md` — 约束文件树右键菜单复用、焦点和副作用单飞。
- `.superwork/spec/frontend/type-safety.md` — 约束 Web 只消费 Protocol 校验后的能力目录。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Client、Server 和 Web 的依赖方向。
- `docs/architecture-design.md` — 约束浏览器通过本地 Server 的固定能力操作宿主系统。
- `docs/project-structure.md` — 确认协议、服务端和前端测试归属。
- `docs/web-design.md` — 保持 Inspector 文件树菜单的紧凑交互。

**Architecture:** 在 Protocol 中增加固定 `system-default` 应用 ID 与类别；Server 将它加入三平台能力目录并使用固定系统启动器打开已安全解析的文件，同时拒绝目录目标。Web 根据文件树节点类型，仅在文件右键菜单保留该类别，不允许它进入项目根目录分段按钮或全局默认设置。

**Tech Stack:** TypeScript、TypeBox、Node.js child process、React 19、TanStack Query、Lucide React、Vitest、Playwright、pnpm。

## Global Constraints

- 浏览器仍只提交 `projectId`、固定 `appId` 与经过 Schema 校验的 Project 相对路径，不新增命令、绝对路径或 Shell 字符串输入。
- `system-default` 只接受真实文件目标；Project 根目录和任意目录节点不得展示或执行该能力。
- macOS 使用 `/usr/bin/open`，Linux 使用 `xdg-open`，Windows 使用受控系统代理；全部使用参数数组和 `shell: false`。
- 系统默认应用不参与 Project 本地偏好与全局默认打开方式，避免保存一个无法打开目录的选项。
- 在关键平台分支和文件专用过滤处添加简短、清晰的中文注释。
- 保留工作区中已有的未提交改动，不启动开发服务器。

### Task 1: 扩展协议并实现三平台系统默认应用命令

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Test: `packages/protocol/src/project.test.ts`
- Modify: `packages/server/src/project-open.ts`
- Test: `packages/server/src/project-open.test.ts`
- Modify: `.superwork/spec/backend/directory-structure.md`

**Interfaces:**

- Consumes: `ProjectOpenAppIdSchema`、`ProjectOpenAppKindSchema`、`ProjectOpenTarget`
- Produces: `ProjectOpenAppId = "system-default"`、`ProjectOpenAppKind = "system-default"`、三平台固定系统打开命令

**Behavior:**

- 能力响应严格接受 `{ id: "system-default", kind: "system-default" }`；三平台探测到系统启动器时返回该能力，并对文件目标分别生成系统默认应用命令；目录目标在启动子进程前返回受控非法目标错误。

**Stop Conditions:**

- 如果 Windows 实现必须拼接来自浏览器的 Shell 命令字符串，停止并改用固定系统代理及独立参数数组。

- [x] **Task Status:** completed

Run: `pnpm test -- packages/protocol/src/project.test.ts packages/server/src/project-open.test.ts`

Expected: 新协议枚举、三平台能力目录、文件打开参数和目录拒绝测试全部通过。

### Task 2: 仅在文件右键菜单展示系统默认应用

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-open-menu.tsx`
- Test: `apps/web/src/features/workbench/components/project-open-menu.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Test: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: `ProjectOpenApp.kind`、`ProjectFileTreeEntry.type`、`ProjectOpenContextMenuTarget`
- Produces: 文件专用 `system-default` 菜单项、`openProject(projectId, { appId: "system-default", path })` 请求

**Behavior:**

- 文件节点右键菜单以本地化名称展示系统默认应用并发送对应文件路径；目录节点菜单、项目根目录分段按钮和全局默认设置过滤该类别，现有应用选择及偏好行为保持不变。

**Stop Conditions:**

- 如果目标节点类型无法随右键事件稳定传递，停止并先补齐 `ProjectOpenContextMenuTarget` 的严格文件或目录类型契约。

- [x] **Task Status:** completed

Run: `pnpm test -- apps/web/src/features/workbench/components/project-open-menu.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx && pnpm test:e2e -- --grep "project file tree context menu"`

Expected: 组件测试证明类别过滤和本地化名称正确，Playwright 证明系统默认应用只出现在文件菜单并发送文件目标请求。
