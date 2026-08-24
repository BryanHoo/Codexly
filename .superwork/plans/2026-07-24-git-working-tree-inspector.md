# Feature Implementation Plan

**Goal:** 右侧变更栏始终展示当前 Project 的真实 Git 未提交文件，按未暂存与已暂存分组，并在当前 Task 运行期间持续刷新。

**Suggested Spec Reads:**

- `.superwork/spec/backend/directory-structure.md` - Git 能力必须通过明确的 Project API 暴露，不能提供任意命令透传。
- `.superwork/spec/backend/quality-guidelines.md` - Project 路径操作需要绝对路径与 `realpath` 校验。
- `.superwork/spec/frontend/component-guidelines.md` - Inspector 通过专用 Query 获取数据，文件行继续复用 Diff 弹窗。

**Architecture:** 新增 Project Git Working Tree 协议与只读 HTTP 端点；Server 使用参数化 `git` 子进程读取配置中 Project 根目录的 porcelain 状态和逐文件 Diff。Client 暴露类型安全方法，Web 使用 React Query 始终读取一次，并仅在当前 Task 为 `running` 时启用固定间隔轮询；Task 结束时执行最终刷新。Inspector 不再从 Task Snapshot 推导文件列表，只消费 Project Git Query，并分别渲染未暂存和已暂存条目。

**Tech Stack:** TypeBox、Fastify、Node.js `child_process`、React Query、React 19、Vitest。

## Global Constraints

- Git 命令只作用于服务端配置的 Project 根目录，不接受来自浏览器的文件路径或命令。
- 同一文件部分暂存时允许同时出现在两个分组，各自携带对应 Diff。
- 未跟踪文件归入未暂存，并生成可供现有 Diff Viewer 打开的新增文件补丁。
- 轮询仅在当前 Task 运行时启用；无 Task 或 Task 空闲时仍保留首次读取和正常 Query 重验证。
- Git 状态读取失败必须进入显式错误状态，不能回退到 Task Snapshot 或演示数据。
- 关键状态解析、路径边界和轮询收尾位置添加简短中文注释。

### Task 1: 定义协议与 Git 状态读取边界

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Create: `packages/server/src/git-working-tree.ts`
- Create: `packages/server/src/git-working-tree.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`

**Behavior Slice:**

协议返回 `staged` 与 `unstaged` 两组可复用 Diff 变更；服务端安全读取 Git 状态，覆盖已暂存、未暂存、未跟踪和部分暂存文件，并校验 Project 身份。

**Verification:**

Run `pnpm vitest run packages/server/src/git-working-tree.test.ts packages/server/src/app.test.ts packages/protocol/src/project.test.ts`.

### Task 2: 接入类型安全 Client 与运行期轮询

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`

**Behavior Slice:**

Client 校验 Project Git 响应；Query 始终可读取状态，并根据当前 Task 是否运行返回轮询间隔配置。

**Verification:**

Run focused Client and Web Query tests.

### Task 3: 重构 Inspector 并执行最终刷新

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Behavior Slice:**

Inspector 展示当前 Project 的非空未暂存和已暂存列表及各自 Diff；空分组不占位，标题固定在面板顶部且只有文件区域滚动，不展示未实现的提交按钮。Task 运行期间持续更新，并在运行结束时补做一次最终刷新。

**Verification:**

Run focused Inspector tests, then `pnpm check`.
