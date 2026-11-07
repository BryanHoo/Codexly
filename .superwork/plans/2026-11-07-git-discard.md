# Feature Implementation Plan

**Goal:** 为 Web 与桌面提供单文件和多文件丢弃变更。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 跨端和验证约束
- `.superwork/spec/protocol/shared/index.md` — 请求与传输一致
- `.superwork/spec/server/backend/index.md` — Git 写锁与幂等
- `.superwork/spec/desktop/backend/index.md` — 原生权限与路径校验

**Architecture:** 共享确认 UI，HTTP 与原生分别执行 Git 字面量路径操作，复用快照与写操作串行范围。

**Tech Stack:** TypeScript、React、Fastify、Rust、Tauri、Vitest、pnpm。

## Global Constraints

- 不影响未选文件；丢弃前校验快照，确认列表固定请求范围。
- 保持中文关键注释；无后台轮询，批量路径使用 NUL stdin 或有界分批。
- 不改动并行发布任务占用的 CHANGELOG.md；新增契约记录到 Git 工作流文档。

### Task 1: 实现受控批量丢弃及两端传输

**Files:**

- Create: `packages/server/src/git-discard.ts`
- Test: `packages/server/src/git-discard.test.ts`
- Modify: `packages/protocol/src/project-git.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/client/src/http-client-git-push.ts`
- Modify: `packages/server/src/routes/project-git-routes.ts`
- Modify: `desktop/src/platform/tauri/workspace-client.ts`
- Modify: `desktop/src/platform/tauri/native-client.ts`
- Modify: `desktop/src/protocol/index.ts`
- Create: `desktop/src-tauri/src/infrastructure/workspace/git_discard.rs`
- Modify: `desktop/src-tauri/src/infrastructure/workspace/mod.rs`
- Create: `desktop/src-tauri/src/application/workspace_discard_commands.rs`
- Modify: `desktop/src-tauri/src/application/mod.rs`
- Modify: `desktop/src-tauri/build.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src-tauri/permissions/window-command-sets.toml`

**Interfaces:**

- Consumes: `ProjectGitStatus.snapshot` 与已选择路径。
- Produces: `DiscardProjectChangesRequest`、`discardProjectChanges` 与更新状态。

**Behavior:**

- 恢复所选跟踪文件，删除所选新增文件，拒绝过期或非法选择，保留其他暂存内容。

**Stop Conditions:**

- 所选路径无法与当前 Git 状态匹配时拒绝写入。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/git-discard.test.ts`

Expected: 批量、单文件、重命名、字面量和过期快照测试通过。

### Task 2: 接入共享确认流程与刷新

**Files:**

- Modify: `packages/ui/src/core/git-commit-workspace.tsx`
- Modify: `packages/frontend-core/src/git-workspace-contract.ts`
- Create: `packages/ui/src/core/git-discard-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-panel.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-controller.tsx`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `desktop/src/features/workbench/components/commit-changes-panel.tsx`
- Modify: `desktop/src/features/workbench/components/commit-changes-controller.tsx`
- Modify: `desktop/src/features/projects/project-query-contracts.ts`
- Test: `desktop/tests/browser/git-discard.browser.test.tsx`
- Modify: `docs/git-workflow.md`

**Interfaces:**

- Consumes: `DiscardProjectChangesRequest`。
- Produces: 共享选择确认弹窗与 Git 状态、文件列表和预览缓存刷新。

**Behavior:**

- 勾选一个或多个文件后确认丢弃；取消不写入，失败保留范围并允许重试。

**Stop Conditions:**

- 两端选择或快照契约不一致时停止。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop exec vitest run --config vitest.browser.config.ts tests/browser/git-discard.browser.test.tsx`

Expected: 两端共享操作的确认、取消、单多选及失败保护用例通过。

## 执行与验证证据

- 公告身份：`git-discard-20261107` / `codex-git-discard`；当前工作区、当前分支执行，未创建提交，不修改其他任务公告及发布文件。
- RED：`pnpm exec vitest run packages/server/src/git-discard.test.ts` 首次因缺少实现失败；追加已暂存删除回归后，因被删除文件未恢复失败，修正 HEAD 路径分类后通过。
- UI RED：浏览器双端在新增操作之前均因缺少「丢弃所选变更」入口失败。实现后的 Chromium / WebKit 双端确认、取消、单选与失败重试通过。
- GREEN：最新 Protocol 全目录、Client Git、Server 丢弃及现有 Git mutation 共 121 项通过；两端相关浏览器回归 14 项通过。Rust workspace 117 项通过、5 项既有忽略；Clippy 全目标及全特性通过。
- 扩展验证：根全量 4041 项通过、13 项跳过；桌面全量 697 项通过。全量之后的懒加载及纯声明优化再以相关浏览器、协议和消费者测试验证，未修改引擎及持久存储。
- 简化结论 `changed`：共享按需加载的确认弹窗、两端仅注入传输；复用生成请求的快照及路径校验。请求构造标注无副作用以移除前端不消费的运行时代码，保留 Node 校验。
- 规范结论 `update`：`.superwork/spec/protocol/shared/index.md` 记录批量范围、快照、重命名与已暂存删除恢复、ACL 和验证入口；`docs/git-workflow.md` 补充使用说明。发布任务占用 CHANGELOG，故不写入。
- 性能：Web 构建与包体检查通过（工作台 gzip 519.87 / 520 KiB）；桌面现代、Legacy 构建与原预算通过。没有提高预算。共享常驻路径不新增轮询、补丁传输或逐文件串行请求。
- 尚未验证 Windows / Ubuntu 真机；已使用 Git 字面量路径、NUL stdin 及有界批次避免 shell/命令行长度差异。

- 最终补充回归：Git 进程异常不会被误认为空仓库；RED 时旧实现错误删除所选文件，修正为只接受 `rev-parse --quiet` 的明确退出码 1 后，6 项丢弃执行测试和 121 项关联测试全部通过。路径按 8 KiB 字节预算批处理。
- 最终静态与产物检查：根及桌面 lint、两端类型、根架构、Prettier 全仓格式、桌面 ACL/约束及 500 行限制、Node 构建与 npm 打包校验通过。Rust Clippy/工作区测试、两端浏览器和性能 16 项沿用本轮对应最后实现之后的通过证据。
