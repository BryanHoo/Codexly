# Documentation Consolidation Plan

**Goal:** 精简当前用户与维护者文档，删除已由持久规范覆盖的重复架构快照，并确保所有说明与仓库行为一致。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 定义项目命名、验证命令和文档维护边界。
- `.superwork/spec/backend/directory-structure.md` — 维护 Server、Provider 和 Project 根边界。
- `.superwork/spec/frontend/state-management.md` — 维护 Web Project 根状态规则。
- `.superwork/spec/shared/quality-guidelines.md` — 维护 Project roots 和跨包协议约束。

**Architecture:** 以源码、`package.json` 和 `.superwork/spec/**` 为事实源；公开 README 只承担安装与常用工作流，维护者文档各自保持单一职责。

**Tech Stack:** Markdown、Prettier、ripgrep、pnpm。

## Global Constraints

- 保留中英文 README、历史 `CHANGELOG.md`、包职责摘要、PRD 和历史计划。
- 不复制 CLI `--help`、功能实现细节或 `.superwork/spec/**` 中的工程约束。
- 不启动开发服务器。

### Task 1: 精简公开使用文档

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**

- Consumes: `package.json`、`src/cli-command-options.ts` 和当前产品工作流
- Produces: 对等、精炼的中英文安装与使用入口

**Behavior:**

- 保留定位、要求、启动、项目任务、局域网、更新和故障排查，删除功能清单与操作章节之间的重复描述及易过期的界面细节。

**Stop Conditions:**

- 如果中英文文档无法保持相同结构或命令与 CLI 行为不一致，则停止修改。

- [x] **Task Status:** completed

Run: `pnpm exec prettier --check README.md README.zh-CN.md`

Expected: 两份 README 格式通过，章节与命令保持对等。

### Task 2: 收敛维护者文档职责

**Files:**

- Modify: `CONTRIBUTING.md`
- Modify: `SECURITY.md`
- Modify: `docs/releasing.md`

**Interfaces:**

- Consumes: `package.json` scripts、`.github/workflows/release.yml` 和 `.superwork/spec/guides/index.md`
- Produces: 无重复的贡献、安全与发布操作指南

**Behavior:**

- 让贡献文档只保留开发入口和变更约束，安全文档只保留报告与边界，发布文档只保留配置、发布步骤和失败恢复。

**Stop Conditions:**

- 如果发布工作流与文档描述不一致且无法从仓库确认正确行为，则停止修改。

- [x] **Task Status:** completed

Run: `pnpm exec prettier --check CONTRIBUTING.md SECURITY.md docs/releasing.md`

Expected: 三份文档格式通过，验证命令和链接准确且不重复展开规范正文。

### Task 3: 删除重复架构快照并验证文档集

**Files:**

- Delete: `docs/architecture-design.md`
- Delete: `docs/project-structure.md`

**Interfaces:**

- Consumes: `.superwork/spec/backend/directory-structure.md`、`.superwork/spec/backend/runtime-lifecycle.md`、`.superwork/spec/frontend/state-management.md` 和 `.superwork/spec/shared/quality-guidelines.md`
- Produces: 只保留当前发布指南的 `docs/` 目录和无失效链接的活动文档集

**Behavior:**

- 删除未被索引且内容已由分层规范覆盖的多根 Project 架构与文件清单快照，并检查活动文档引用和 Markdown 格式。

**Stop Conditions:**

- 如果待删除文档含有未被持久规范覆盖的有效规则，则停止删除并先补充规范。

- [x] **Task Status:** completed

Run: `test "$(find docs -maxdepth 1 -type f -name '*.md' -print | sort)" = 'docs/releasing.md' && ! rg -n -g '*.md' 'docs/(architecture-design|project-structure)\.md' README.md README.zh-CN.md CONTRIBUTING.md SECURITY.md .superwork/spec packages && pnpm exec prettier --check README.md README.zh-CN.md CONTRIBUTING.md SECURITY.md docs/releasing.md packages/*/README.md`

Expected: `docs/` 只保留发布指南，活动文档无失效引用，全部维护文档格式通过。
