# Feature Implementation Plan

**Goal:** 让 Git message 提交弹窗在聚合直属子 Git 仓库时先选择仓库，并仅对所选仓库生成提交信息、提交和推送。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包验证与工程质量门禁。
- `.superwork/spec/backend/directory-structure.md` — 约束 Project Git 路由、受控子仓库和 Mutation 边界。
- `.superwork/spec/frontend/component-guidelines.md` — 约束弹窗组件职责与交互状态。
- `.superwork/spec/frontend/type-safety.md` — 约束 Web 仅消费 Protocol 与 Client 的受检契约。
- `.superwork/spec/shared/quality-guidelines.md` — 约束公开 Schema、类型与调用方同步更新。
- `docs/architecture-design.md` — 约束 Browser、Client、Server 和 Protocol 的依赖方向。
- `docs/web-design.md` — 约束工作台提交弹窗和多仓库交互。

**Architecture:** 在 Protocol 请求中加入可选的直属子仓库标识；Server 通过白名单解析 Project 根仓库或直属子仓库，读取所选仓库的独立状态与快照；Web 在聚合模式下先从变更路径提取仓库候选，选择后按独立 Query 加载状态，并将同一仓库标识贯穿 message 生成与提交 Mutation。

**Tech Stack:** TypeScript、TypeBox、Fastify、React 19、TanStack Query、shadcn/ui、Vitest、pnpm。

## Global Constraints

- 子仓库只能是已配置 Project 根目录的真实直属目录，必须存在自身 `.git`，不得接受路径穿越、嵌套仓库或任意文件系统路径。
- 根仓库继续使用未携带 `repository` 的请求；聚合子仓库提交必须携带 `repository`，并使用所选仓库自己的 `snapshot` 和相对文件路径。
- 生成 message、提交和推送必须绑定同一个仓库选择，不能跨仓库混合文件。
- 保留 Project 级 Git Mutation 锁、幂等键、部分提交和 push 部分成功语义。

### Task 1: 扩展子仓库提交协议与 Client

**Files:**

- Modify: `packages/protocol/src/project-git.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/http-client-projects.ts`
- Test: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: 现有 Project Git HTTP 路径与直属目录命名约束。
- Produces: `GitChildRepositorySchema`、`ProjectGitStatusQuery`、带可选 `repository` 的 `GenerateCommitMessageRequest` 与 `CommitProjectChangesRequest`、支持仓库查询的 `CodexlyClient.getProjectGitStatus`。

**Behavior:**

- 允许 Client 读取指定直属子仓库状态，并在 message 生成和提交请求中传递同一 `repository`；Schema 拒绝越界或非法仓库路径。

**Stop Conditions:**

- 如果现有 Project 相对路径 Schema 无法安全表达受服务端白名单约束的仓库标识，则停止并重新定义专用 Schema。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts`

Expected: 新增仓库查询与请求 Schema 测试通过，Client URL 和请求体断言通过。

### Task 2: 在 Server 中解析并提交直属子仓库

**Files:**

- Modify: `packages/server/src/git-working-tree.ts`
- Test: `packages/server/src/git-working-tree.test.ts`
- Modify: `packages/server/src/git-commit.ts`
- Test: `packages/server/src/git-commit.test.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/project-git-routes.ts`
- Test: `packages/server/src/app.test.ts`
- Modify: `.superwork/spec/backend/directory-structure.md`

**Interfaces:**

- Consumes: `ProjectGitStatusQuery`、带 `repository` 的提交请求、现有 Project 根路径与 Git Mutation 锁。
- Produces: 受控的根仓库/直属子仓库解析、所选仓库独立状态、message Prompt 与实际 Git Mutation。

**Behavior:**

- 状态路由按查询读取所选直属子仓库；message 生成和提交只校验并处理所选仓库的本地相对路径与快照；未知、嵌套或越界仓库统一拒绝且不泄露宿主路径。

**Stop Conditions:**

- 如果子仓库不能通过 Project 根目录下最新枚举结果精确确认，停止该请求且不得回退到上级或聚合仓库。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/git-working-tree.test.ts packages/server/src/git-commit.test.ts packages/server/src/app.test.ts`

Expected: 根仓库行为保持通过，直属子仓库可生成 message 和提交，非法仓库与陈旧快照被拒绝。

### Task 3: 在提交弹窗中先选择子仓库

**Files:**

- Create: `apps/web/src/shared/ui/select.tsx`
- Modify: `apps/web/src/features/projects/project-query-options.ts`
- Test: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-dialog.tsx`
- Test: `apps/web/src/features/workbench/components/commit-changes-dialog.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: 聚合 `ProjectGitStatus`、`projectGitRepositoryStatusQueryOptions`、带可选 `repository` 的 Mutation 请求。
- Produces: 子仓库优先选择步骤、所选仓库加载状态、仓库内文件选择和提交操作。

**Behavior:**

- 根仓库直接展示原提交流程；聚合子仓库模式先显示可访问的仓库选择，选定并加载其独立状态后才展示文件与 message 控件，切换仓库时清空旧选择、message、结果和错误状态。

**Stop Conditions:**

- 如果聚合状态存在变更但无法可靠映射到直属仓库候选，停止展示提交操作并显示可恢复错误。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/project-queries.test.tsx apps/web/src/features/workbench/components/commit-changes-dialog.test.tsx`

Expected: 根仓库弹窗行为通过，子仓库模式先显示选择控件，选择后请求和提交均携带目标仓库。

### Task 4: 完成跨包验证

**Files:**

- Modify: `.superwork/plans/2026-08-06-child-git-commit.md`

**Interfaces:**

- Consumes: 全部已完成代码切片与工程门禁。
- Produces: 完整静态检查、单元测试、构建和浏览器关键流程证据。

**Behavior:**

- 执行仓库规定的完整检查与 E2E，确认协议、服务端、Web 装配和现有用户流程无回归。

**Stop Conditions:**

- 如果失败来自本次改动，停止交付并修复；如果确认是外部依赖或既有失败，记录精确证据后进入最终检查判断。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 两个命令均以退出码 0 完成。
