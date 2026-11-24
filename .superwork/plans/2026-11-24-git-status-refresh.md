# Git 状态刷新性能计划

**Goal:** 降低 Web 和桌面 Git 状态读取成本，保留提交前的快照校验并实测三组场景。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` 覆盖共用工程约束。
- `.superwork/spec/server/backend/index.md` 覆盖写锁和快照校验。
- `.superwork/spec/desktop/backend/index.md` 覆盖 Rust 性能基线。
- `.superwork/spec/web/frontend/index.md` 覆盖 Web 和移动端刷新。
- `docs/git-workflow.md` 覆盖文件选择和写入行为。

**Architecture:** Web 用 porcelain v2 合并状态读取并降低静默期轮询频率。桌面复用快照一致的统计和多个 worktree 的分页缓存。

**Tech Stack:** Git、TypeScript、Vitest、Rust、Tokio。

## Global Constraints

- 保留完整路径、写入锁和提交快照验证。Windows 大清单保留顺序统计与原超时预算。

### Task 1: 合并 Web 状态读取

**Files:**

- Modify: `packages/server/src/git-working-tree.ts`
- Modify: `packages/server/src/git-command.ts`
- Test: `packages/server/src/git-command.test.ts`
- Modify: `packages/server/src/git-working-tree-diff.ts`
- Test: `packages/server/src/git-working-tree-adapter.test.ts`
- Test: `packages/server/src/git-working-tree.test.ts`
- Test: `packages/server/src/git-branch.test.ts`
- Test: `packages/server/src/performance.performance.test.ts`

**Interfaces:**

- Consumes: Git porcelain v2 NUL 记录。
- Produces: `ProjectGitStatus` 和供写入重新校验的快照。

**Behavior:**

- 一次状态读取获取 HEAD、分支和暂存对象，保留完整未跟踪路径。

**Stop Conditions:**

- 暂存对象或文件变更未触发写入快照失效。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/git-`

Expected: Git 读取、变更及提交回归通过。

### Task 2: 降低静默期轮询频率

**Files:**

- Modify: `apps/web/src/features/projects/project-git-status-coordinator.ts`
- Test: `apps/web/src/features/projects/project-git-status-coordinator.test.ts`

**Interfaces:**

- Consumes: 查询状态及当前观察者。
- Produces: 唯一可见 worktree 轮询计时器。

**Behavior:**

- 静默轮询退避，发现变化或主动刷新后恢复短周期。

**Stop Conditions:**

- 焦点、手动刷新或者活动事件受到退避延误。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/project-git-status-coordinator.test.ts`

Expected: 可见性、事件刷新和计时回归通过。

### Task 3: 复用桌面行数统计和分页快照

**Files:**

- Modify: `desktop/src-tauri/src/infrastructure/workspace/git_read.rs`
- Modify: `desktop/src-tauri/src/infrastructure/workspace/git_status_page.rs`
- Modify: `desktop/src-tauri/src/infrastructure/workspace/git_stats.rs`
- Test: `desktop/src-tauri/src/infrastructure/workspace/git_scale_tests.rs`

**Interfaces:**

- Consumes: 日期有效且快照匹配的状态页缓存。
- Produces: 聚合行数和分页游标。

**Behavior:**

- 复用多个 worktree 的游标与统计。纯未跟踪变更从内容指纹读取行数。

**Stop Conditions:**

- 同路径内容变化后返回过时统计，或写入使用缓存跳过严格校验。

- [x] **Task Status:** completed

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib git_ --release --locked`

Expected: Rust Git 验证与分页回归通过。

### Task 4: 记录性能比较

**Files:**

- Modify: `desktop/docs/performance-baseline.md`

**Interfaces:**

- Consumes: Web 和桌面状态入口的基线样本。
- Produces: Git 进程数、读取量和 P95 对比。

**Behavior:**

- 覆盖大索引、大量未跟踪文件和两个 worktree 交替访问。

**Stop Conditions:**

- 任一指标缺少实测或计量口径。

- [x] **Task Status:** completed

Run: `git diff --check`

Expected: 对比表包含三组样本和复现方法，补丁无空白错误。

## 验证结果

- Web 和服务端定向验证覆盖 175 个测试文件，881 项通过，3 项跳过。
- Rust Release Git 验证通过 76 项，3 项按配置忽略。双 worktree 游标回归在旧单槽实现中复现，更新后通过。
- 三组正式测量结果和复测命令收录于 [性能基线](../../desktop/docs/performance-baseline.md#git-状态刷新)。
- 根目录 4,243 项测试通过。状态输出上限的最后调整另跑 Git 与轮询回归，96 项通过。类型、Lint、架构、Web 性能、构建、Bundle 与打包验证通过。
- 桌面 `pnpm --dir desktop check:rust` 通过，包含 Clippy、全特性测试以及 10k、50k、100k 分页基线。
- 根目录 `pnpm check` 的格式步骤扫描到 Git 忽略的本地协作记录。对 Git 跟踪文件和未忽略的新文件执行 Prettier 检查，其他检查分项执行。
