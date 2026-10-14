# Git 工作区重构实现计划

**Goal:** 在 Web、移动 Web 和桌面端提供保留草稿、准确提交范围及可继续处理推送失败的 Git 工作区。
**Scope:** 共享前端状态与控件、Git 消息上下文、远端协议及两端执行适配；不自动改写历史或强制推送。
**Acceptance:** 刷新和重新打开保留草稿，AI 不覆盖用户编辑，部分暂存上下文与提交一致，远端入口始终可用且错误提供对应处理动作。

### Task 1: 保留草稿与统一提交范围

**Files:**

- Modify: `packages/frontend-core/src/git-commit-draft.ts`
- Modify: `packages/server/src/git-commit-message.ts`
- Modify: `desktop/src-tauri/src/infrastructure/workspace/git_commit_context.rs`
- Test: `packages/frontend-core/src/git-commit-draft.test.ts`
- Test: `packages/server/src/git-commit-message.test.ts`

**Behavior:** 按仓库、工作树及分支保存草稿，刷新保留选择，新变更不静默加入；部分暂存只生成将提交的内容。
**Proof:** `pnpm exec vitest run packages/frontend-core/src/git-commit-draft.test.ts packages/server/src/git-commit-message.test.ts`
**Stop Conditions:** 现有原生提交范围语义与服务端不同且不能通过明确适配统一时停止该切片并重新核对。

- [x] **Task Status:** completed

### Task 2: 共用提交工作区和 AI 建议

**Files:**

- Modify: `packages/ui/src/core/git-commit-workspace.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-panel.tsx`
- Modify: `desktop/src/features/workbench/components/commit-changes-panel.tsx`
- Test: `apps/web/src/features/workbench/components/commit-changes-panel.test.tsx`

**Behavior:** 顶部常驻远端动作，中间单份文件列表，底部草稿；生成建议可采用、撤销，迟到结果不覆盖编辑，成功提交才清除草稿。
**Proof:** Web 组件回归和桌面 browser 回归，加 Chrome CDP 窄屏与宽屏验证。
**Stop Conditions:** 必须引入未授权外部发布才能验证时使用本地临时仓库。

- [x] **Task Status:** completed

### Task 3: 远端状态、发布及失败恢复

**Files:**

- Modify: `packages/protocol/src/project-git.ts`
- Modify: `packages/server/src/routes/project-git-push-routes.ts`
- Modify: `desktop/src-tauri/src/application/workspace_commands.rs`
- Modify: 两端客户端和提交 controller
- Test: Git 临时仓库集成及协议测试

**Behavior:** 展示远端目标、领先落后状态；首次发布设置上游；失败按原因提供操作，整合远端更新可继续或中止，未知结果先检查。
**Proof:** 临时 bare 远端验证发布、更新、拒绝、冲突和重试；两端类型检查。
**Stop Conditions:** 凭据缺失只验证本地远端和恢复文案，不向用户真实仓库推送。

- [x] **Task Status:** completed

### Task 4: 跨端验收与文档

**Files:**

- Modify: `docs/git-workflow.md`
- Modify: `.superwork/spec/` 相关层说明
- Test: 两端相关测试、类型检查、lint、生产构建

**Behavior:** 宽窄屏可操作、分页选择无歧义、共享边界保持、关键路径低开销。
**Proof:** 相关回归、构建、Chrome CDP 操作和最终 diff 检查。
**Stop Conditions:** 环境或无关基线失败须单独记录，不将其伪称为变更通过。

- [ ] **Task Status:** pending
