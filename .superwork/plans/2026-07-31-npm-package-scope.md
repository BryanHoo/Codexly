# Feature Implementation Plan

**Goal:** 将首次发布的 npm 包名更新为 `@bryanhu/codexly`，修复标签检出时的发布校验，并完成 GitHub Release 与 npm `0.0.1` 发布。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md`

**Architecture:** 根包使用 scoped npm 包名，继续暴露稳定的 `codexly` CLI 命令；Release workflow 从 `package.json` 读取包名，标签触发后依次校验、发布 npm、创建 GitHub Release。

**Tech Stack:** pnpm、TypeScript、Vitest、GitHub Actions、npm、GitHub CLI

## Global Constraints

- 保留内部 workspace 包名 `@codexly/*`、CLI 命令 `codexly` 和 `CODEX_HOME/codexly` 数据目录。
- npm 发布包名必须精确为 `@bryanhu/codexly`，版本保持 `0.0.1`。
- 发布前必须通过项目质量检查、E2E 和 package dry-run。

### Task 1: 更新 npm 包元数据和发布校验

**Files:**

- Modify: `package.json`
- Modify: `.github/workflows/release.yml`
- Modify: `tools/verify-package.mjs`
- Modify if generated: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `RootPackageManifest`
- Produces: `ScopedPackageManifest`

**Behavior:**

- 根包以 `@bryanhu/codexly` 发布，CLI 仍通过 `codexly` 执行，workflow 不硬编码旧包名。

**Stop Conditions:**

- package dry-run 未包含预期名称、bin 或发布文件时停止。

- [x] **Task Status:** completed

Run: `pnpm run package:check`

Expected: package verification 通过，manifest 名称为 `@bryanhu/codexly` 且 bin 为 `codexly`。

### Task 2: 修复标签检出时的 Git 状态测试

**Files:**

- Modify: `packages/server/src/git-working-tree.test.ts`

**Interfaces:**

- Consumes: `GitWorkingTreeStatus`
- Produces: `NullableBranchTestContract`

**Behavior:**

- 正常分支返回字符串；GitHub Actions 标签触发产生 detached HEAD 时允许 `branch` 为 `null`。

**Stop Conditions:**

- 目标测试仍在 detached HEAD 合法状态下失败时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/git-working-tree.test.ts`

Expected: 目标测试全部通过。

### Task 3: 同步用户文档和稳定约束

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/releasing.md`
- Modify: `.superwork/spec/guides/index.md`

**Interfaces:**

- Consumes: `ScopedPackageManifest`
- Produces: `ScopedPackageDocumentation`

**Behavior:**

- 所有面向 npm 发布的引用使用 `@bryanhu/codexly`，CLI 相关引用继续使用 `codexly`。

**Stop Conditions:**

- 搜索仍发现把根 npm 包误写为旧的 `codexly` 时停止。

- [x] **Task Status:** completed

Run: `rg -n 'npm install.*codexly|npx codexly|npmjs.com/package/codexly|npm 包.*codexly' README.md CHANGELOG.md docs .superwork/spec/guides/index.md`

Expected: 不再出现旧 npm 包安装、执行、链接或命名约束。

### Task 4: 验证并完成首次发布

**Files:**

- Verify: repository worktree and GitHub Actions

**Interfaces:**

- Consumes: `ScopedPackageManifest`
- Produces: `PublishedReleaseArtifacts`

**Behavior:**

- 提交并推送全部改动，重建失败且未产生产物的 `v0.0.1` 标签，Release workflow 自动发布 npm 包并创建 GitHub Release。

**Stop Conditions:**

- 任一质量检查失败，或 npm/GitHub 已存在冲突的 `0.0.1` 发布物时停止。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e && pnpm pack --dry-run --json`

Expected: 全部检查通过；`@bryanhu/codexly@0.0.1` 和 GitHub Release `v0.0.1` 均可查询。
