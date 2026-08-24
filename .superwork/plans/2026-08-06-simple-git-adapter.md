# Simple Git Adapter Implementation Plan

**Goal:** 使用 `simple-git` 统一 Server 的受控 Git 读取与分支命令执行，同时保持现有安全边界、状态快照、资源预算和部分提交语义。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束生产依赖审计、发布包与统一验证。
- `.superwork/spec/backend/directory-structure.md` — 约束 Git 参数数组、Project 根目录、状态快照、部分提交和分支切换。
- `.superwork/spec/backend/quality-guidelines.md` — 约束外部进程错误、资源上限和测试。
- `docs/project-structure.md` — 约束 Workspace 依赖归属与 Catalog 管理。

**Architecture:** 在 `packages/server` 新增只暴露固定 `GitCommandExecutor` 的 `simple-git` Adapter，以每条命令独立实例、参数数组、固定环境变量、硬超时和合计输出字节上限执行现有受控命令；工作树读取与分支切换改用该 Adapter，业务解析和 Mutation 规则不进入三方包。部分提交继续使用现有 stdin、literal pathspec 和精确回滚执行器。

**Tech Stack:** TypeScript、Node.js 24、simple-git 3.36.0、pnpm 11 Catalog、Vitest 4

## Global Constraints

- 不接受浏览器命令或自定义 Git 参数；所有命令继续由 Server 固定构造并使用参数数组。
- 保留 `10 MiB` 合计输出上限、读取命令 `10s` 硬超时、`GIT_OPTIONAL_LOCKS=0` 和 `trimmed: false`。
- 保留 Porcelain NUL 路径解析、批量 Diff、未跟踪文件 Diff、全局资源预算、直属子仓库聚合和稳定 `snapshot`。
- 保留部分文件提交的 stdin message、literal pathspec、未选 staged/unstaged 变更和 push 部分成功语义。
- 仅修改 Server Git 相关文件、依赖清单、锁文件、计划与必要规范，不触碰现有前端工作区改动。

### Task 1: 建立有界 simple-git Adapter

**Files:**

- Modify: `pnpm-workspace.yaml`
- Modify: `packages/server/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/server/src/git-command.ts`
- Test: `packages/server/src/git-command.test.ts`

**Interfaces:**

- Consumes: `simpleGit()`、`SimpleGitOptions`、参数数组、Project 真实根目录。
- Produces: `GitCommandExecutor`、`createGitCommandExecutor()`、默认 `executeGit()`。

**Behavior:**

- Adapter 使用 `simple-git@3.36.0` 原样执行参数数组并保留 NUL 与尾部输出；为每条命令设置 `GIT_OPTIONAL_LOCKS=0`、固定硬超时和 stdout/stderr 合计字节上限，超限或超时立即终止且不返回部分结果。

**Stop Conditions:**

- 如果 `simple-git` 无法通过公开 API 同时提供参数数组、原始输出、进程终止和输出流观察能力，则停止迁移并保留现有执行器。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/git-command.test.ts`

Expected: Adapter 的参数保真、环境变量、NUL 输出、输出上限和硬超时测试全部通过。

### Task 2: 迁移工作树与分支命令并验证语义

**Files:**

- Modify: `packages/server/src/git-working-tree-diff.ts`
- Modify: `packages/server/src/git-working-tree.ts`
- Modify: `packages/server/src/git-branch.ts`
- Test: `packages/server/src/git-working-tree-adapter.test.ts`
- Test: `packages/server/src/git-working-tree.test.ts`
- Test: `packages/server/src/git-branch.test.ts`
- Test: `packages/server/src/git-commit.test.ts`
- Test: `packages/server/src/performance.performance.test.ts`

**Interfaces:**

- Consumes: `GitCommandExecutor`、现有 Porcelain/Diff 解析器、`readGitWorkingTreeStatus()`、`switchProjectBranch()`。
- Produces: 由 `simple-git` Adapter 驱动且 HTTP/Protocol 行为不变的 Git 状态与分支切换服务。

**Behavior:**

- 删除工作树模块中的直接 `execFile` 执行器并改用统一 Adapter；保留可注入 Executor 的测试边界、最大并发、状态排序与快照计算，确认真实仓库读取、复杂 staged/unstaged 状态、直属子仓库、分支切换和部分提交结果不变。

**Stop Conditions:**

- 如果迁移改变 NUL 路径、部分 staged、未跟踪文件、分支候选、稳定快照、literal pathspec 或未选 staged 文件保留语义，则停止并修复 Adapter 边界，不放宽既有规则。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/git-command.test.ts packages/server/src/git-working-tree.test.ts packages/server/src/git-branch.test.ts packages/server/src/git-commit.test.ts`

Expected: 新 Adapter 与现有 Git 行为回归测试全部通过，部分提交仍由原有精确执行器完成。
