# Feature Implementation Plan

**Goal:** 右栏项目树通过右键和三点菜单新增空文件与文件夹，覆盖 Web、移动浏览器及桌面。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 验证入口及工程约束。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 共享组件与平台传输边界。
- `.superwork/spec/protocol/shared/index.md` — 创建请求、响应和错误契约。
- `.superwork/spec/server/backend/index.md` — HTTP 幂等和项目根授权。
- `.superwork/spec/desktop/backend/index.md` — 原生命令、ACL 与 Rust 检查。
- `.superwork/spec/web/frontend/index.md` — 移动浏览器和缓存。
- `.superwork/spec/desktop/frontend/index.md` — 桌面交互及 500 行限制。
- `.superwork/spec/ui/shared/index.md` — 共享弹窗、焦点和提交保护。

**Architecture:** CreateProjectFileRequest 为 `{ parentPath: string | null, name, type: "file" | "directory" }`，HTTP / Tauri 返回 `{ path, tree }`。Node 独占 wx、Tokio create_new / create_dir 不覆盖既有内容。共享创建弹窗、菜单、名称校验与中英文文案，平台仅注入传输及当前语言。权威响应只更新父目录缓存，刷新完成后展开父目录。

**Tech Stack:** TypeScript、React、TanStack Query、TypeBox、Fastify、Tauri、Tokio、Vitest、Playwright。

## Global Constraints

- 使用 pnpm；Python 命令使用 Python 3.11+ 的 python3；关键逻辑使用中文注释。
- 桌面源文件和测试文件不得超过 500 行；两端共用 UI，HTTP 与原生保留独立传输。
- 拒绝路径越界、分隔符、控制字符及 Windows 保留名称；并发创建只有一个成功，不覆盖文件、目录或链接。
- 无新增依赖、轮询或整树刷新。创建协议独立模块，新增中英文文案随功能加载；桌面首屏保持 450000 字节预算。
- parallelTask: file-creation-20261030 / codex-file-creation-20261030。
- CHANGELOG.md 在发布任务的协作声明范围内，本任务不写入；创建契约和验证记录保留于本计划及 Protocol 规范。

## 官方依据

- Node 文件独占创建与竞态处理：https://nodejs.org/api/fs.html
- Tokio OpenOptions::create_new：https://docs.rs/tokio/latest/tokio/fs/struct.OpenOptions.html
- Radix 菜单关闭和焦点事件：https://www.radix-ui.com/primitives/docs/components/dropdown-menu
- Base UI Dialog 焦点与关闭：https://base-ui.com/react/components/dialog
- TanStack Query 响应更新缓存：https://tanstack.com/query/latest/docs/framework/react/guides/updates-from-mutation-responses

### Task 1: 实现跨端独占创建契约

**Files:**

- Modify: `desktop/src-tauri/build.rs`
- Modify: `desktop/src-tauri/permissions/window-command-sets.toml`
- Modify: `desktop/src-tauri/src/application/error.rs`
- Modify: `desktop/src-tauri/src/application/mod.rs`
- Modify: `desktop/src-tauri/src/infrastructure/workspace/mod.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src/platform/tauri/workspace-client.test.ts`
- Modify: `desktop/src/platform/tauri/workspace-client.ts`
- Modify: `packages/client/src/http-client-projects.test.ts`
- Modify: `packages/client/src/http-client-projects.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/project-file-mutations.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/project-file-mutation-routes.ts`
- Modify: `packages/server/src/server-options.ts`
- Create: `desktop/src-tauri/src/application/workspace_file_creation_commands.rs`
- Create: `desktop/src-tauri/src/infrastructure/workspace/file_creation.rs`
- Create: `packages/client/src/http-client-file-creation.ts`
- Create: `packages/protocol/src/project-file-creation-name.ts`
- Create: `packages/protocol/src/project-workspace.ts`
- Create: `packages/protocol/src/project-file-creation.ts`
- Create: `packages/server/src/app-file-creation.test.ts`
- Create: `packages/server/src/project-file-creation.test.ts`

**Interfaces:**

- Consumes: ProjectRootQuery、ProjectFileTree、Dialog。
- Produces: CreateProjectFileRequest、CreateProjectFileResponse、createProjectFile、create_project_file。

**Behavior:**

- 提供 createProjectFile / create_project_file，校验父目录和名称，空文件及目录独占创建；HTTP 重试幂等、冲突返回 409，响应带父目录快照。

**Stop Conditions:**

- 协作公告出现文件交叉，或独占创建和父目录边界无法保证时暂停受影响部分。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/project-file-creation.test.ts packages/server/src/app-file-creation.test.ts packages/client/src/http-client-projects.test.ts`

Expected: 针对性创建测试及跨端交互测试通过。

### Task 2: 接入共用创建交互与局部刷新

**Files:**

- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/project-open-dropdown-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-file-tree.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-project-file-tree-row-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-project-file-tree.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-project-file-tree.tsx`
- Modify: `desktop/src/features/projects/project-query-contracts.ts`
- Modify: `desktop/src/features/workbench/components/project-open-dropdown-menu.tsx`
- Modify: `desktop/src/features/workbench/components/project-open-menu.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-inspector-file-tree.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-project-file-tree.browser.test.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-project-file-tree.tsx`
- Create: `apps/web/src/features/workbench/components/project-file-tree-row.tsx`
- Create: `apps/web/src/features/workbench/components/use-project-file-creation.tsx`
- Create: `desktop/src/features/workbench/components/project-file-creation.browser.test.tsx`
- Create: `desktop/src/features/workbench/components/project-file-tree-row.tsx`
- Create: `desktop/src/features/workbench/components/use-project-file-creation.tsx`
- Create: `packages/ui/src/core/project-file-creation-labels.tsx`
- Create: `packages/ui/src/core/project-file-creation-menu.tsx`
- Create: `packages/ui/src/core/project-file-creation.tsx`
- Create: `tests/e2e/app-shell-file-creation.spec.ts`

**Interfaces:**

- Consumes: ProjectRootQuery、ProjectFileTree、Dialog。
- Produces: useProjectFileCreation、ProjectFileCreationMenuItems。

**Behavior:**

- 项目根与子目录两种菜单均可创建；名称校验、取消、提交锁、冲突重试与焦点恢复一致，创建后刷新并展开目标目录，覆盖三浏览器真实触屏。

**Stop Conditions:**

- 协作公告出现文件交叉，或独占创建和父目录边界无法保证时暂停受影响部分。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/features/workbench/components/project-file-creation.browser.test.tsx`

Expected: 针对性创建测试及跨端交互测试通过。

## 验证证据

执行目录均为仓库根目录，环境为 macOS arm64、Node 24；pnpm 使用项目固定版本。Windows / Ubuntu 实机未执行。

| 范围           | 命令                                                                                                                                                                                                                                                                                                       | 结果                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| TDD RED        | 创建服务/路由测试，桌面 file_creation，创建浏览器测试                                                                                                                                                                                                                                                      | 预期因缺失接口/菜单失败，日志 `.local/file-creation-*-red.log`                |
| 创建集成       | `pnpm exec vitest run packages/server/src/project-file-creation.test.ts packages/server/src/app-file-creation.test.ts packages/server/src/project-file-mutations.test.ts packages/client/src/http-client-projects.test.ts apps/web/src/features/workbench/components/workbench-project-file-tree.test.tsx` | 44 通过，17 个既有平台用例跳过；最终文件结构变更后重跑                        |
| 全量 TS        | `pnpm test --maxWorkers=4 --pool=threads`                                                                                                                                                                                                                                                                  | 664 个文件、3823 项通过，6 个文件和 28 项既有用例跳过                         |
| 桌面浏览器     | `pnpm --dir desktop test:browser src/features/workbench/components/project-file-creation.browser.test.tsx src/features/workbench/components/workbench-project-file-tree.browser.test.tsx`                                                                                                                  | Chromium / WebKit 共 8 项通过，最终文案与格式调整后重跑                       |
| Web 浏览器     | `pnpm exec playwright test tests/e2e/app-shell-file-creation.spec.ts tests/e2e/app-shell-composer-file-tree.spec.ts --workers=2`                                                                                                                                                                           | 9 项通过，含三浏览器宽屏与真实触屏以及既有文件树动作                          |
| 构建与静态     | `pnpm build`、`pnpm lint`、`pnpm lint:architecture`                                                                                                                                                                                                                                                        | 通过；最终产物由 package/bundle 验证                                          |
| 桌面完整前端   | `pnpm --dir desktop check:web`                                                                                                                                                                                                                                                                             | 674 单元测试、ACL、格式/类型、现代及 Legacy 构建与包体门槛通过                |
| 原生           | `pnpm --dir desktop check:rust`                                                                                                                                                                                                                                                                            | 812 个库测试、6 个集成测试及 6 项 Release 性能基线通过；含创建的 2 项磁盘测试 |
| 原生新鲜度补充 | `pnpm --dir desktop rust:clippy`、`pnpm --dir desktop rust:fmt:check`                                                                                                                                                                                                                                      | 命令拆分后再次通过                                                            |
| Web 性能       | `pnpm test:performance`、`pnpm bundle:check`                                                                                                                                                                                                                                                               | 性能用例通过；首屏 350.80 / 360 KiB，工作台 508.11 / 520 KiB                  |
| 桌面预算       | `pnpm --dir desktop performance:budget`，由 check:web 执行                                                                                                                                                                                                                                                 | 首屏 449972 / 450000 字节，通过，未修改预算                                   |
| 契约及发布包   | `pnpm codex:schema:check`、`pnpm package:check`                                                                                                                                                                                                                                                            | Schema 0.164.0、921 文件 tarball 验证通过                                     |

首次默认并发全量测试有 2 项失败，独立复跑和四线程完整复跑均通过；无相关生产代码修改。全量测试之后仅调整创建文案加载及独立协议模块，对应最终集成与浏览器测试已再次验证；无关套件复用同一执行期的证据。

## 最终审查

- Simplification: changed。独立协议模块与共用文案减少首屏工作，拆出树行和原生命令满足 500 行限制，目标创建/回归测试重新通过。
- Spec: update，更新 `.superwork/spec/protocol/shared/index.md` 的长期创建契约、焦点交接和刷新后展开规则。
- 共享影响：新增 HTTP/Tauri 创建能力，复用创建菜单/弹窗/文案；目录缓存只更新对应父目录，未修改其他任务声明的文件。
