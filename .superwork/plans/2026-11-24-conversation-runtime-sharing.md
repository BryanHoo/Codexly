# 双端会话运行时收敛

**Goal:** 共用 Web 与桌面快照恢复、任务 Store 生命周期和事件批次提交。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md`
- `.superwork/spec/frontend-core/shared/index.md`
- `.superwork/spec/web/frontend/index.md`
- `.superwork/spec/desktop/frontend/index.md`

**Architecture:** Frontend Core 承载任务状态更新和恢复控制器，平台入口注入存储、事件策略、诊断回调与 Store 实现。

**Tech Stack:** TypeScript、Zustand、Vitest。

## Global Constraints

- 保留 Web HTTP／WebSocket 与桌面 Tauri 传输边界。
- 事件按任务身份、会话及 checkpoint 顺序提交，目标 Item 每批最多通知一次。
- 保留桌面可见性、写权限和警告策略，以及 Web 访问错误处理。

### Task 1: 共用快照恢复控制器

**Files:**

- Create: `packages/frontend-core/src/task-snapshot-recovery.ts`
- Test: `packages/frontend-core/src/task-snapshot-recovery.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime-recovery.ts`
- Modify: `desktop/src/features/conversation/runtime/project-runtime-recovery.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime-history.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime-events.ts`
- Modify: `desktop/src/features/conversation/runtime/project-runtime-history.ts`
- Modify: `desktop/src/features/conversation/runtime/project-runtime-events.ts`

**Interfaces:**

- Consumes: 异步快照读取、发布与诊断回调。
- Produces: `SnapshotRecoveryController` 与 `ActiveTaskSnapshotRecoveryController`。

**Behavior:**

- 共用退避、并发限制和取消逻辑。同一任务取消后再次排队时丢弃旧响应。

**Stop Conditions:**

- 平台传输或前后台发布语义无法通过现有适配层保留。

- [x] **Task Status:** completed

Run: `pnpm test packages/frontend-core/src/task-snapshot-recovery.test.ts apps/web/src/features/conversation/runtime/project-runtime`

Expected: 取消后的迟到响应被丢弃，Web 项目恢复回归通过。

### Task 2: 共用任务 Store 生命周期与批次提交

**Files:**

- Create: `packages/frontend-core/src/task-store-runtime.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-factory.ts`
- Modify: `desktop/src/features/conversation/runtime/task-store-factory.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-core.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-events.ts`
- Modify: `desktop/src/features/conversation/runtime/task-store-core.ts`
- Modify: `desktop/src/features/conversation/runtime/task-store-events.ts`
- Test: `packages/frontend-core/src/testing/interrupted-replies-contract.ts`
- Test: `apps/web/src/features/conversation/runtime/task-store-interrupted-replies.test.ts`
- Test: `desktop/src/features/conversation/runtime/task-store-interrupted-replies.test.ts`

**Interfaces:**

- Consumes: 平台的快照归一化、事件 reducer、Item Store、存储与通知保留策略。
- Produces: 共用任务 Store 状态初始化和生命周期方法。

**Behavior:**

- 创建、恢复、历史拼接及增量批次使用同一份实现，按现有实体策略记录命令输出预算并发布目标 Item。
- 打开与 Store 身份不符的初始快照时，在读取中断恢复存储前拒绝。

**Stop Conditions:**

- 共享逻辑无法保留桌面原生实体类型或既有通知时序。

- [x] **Task Status:** completed

Run: `pnpm test apps/web/src/features/conversation/runtime && pnpm --dir desktop test:run src/features/conversation/runtime`

Expected: 双端会话运行时测试通过。

## 最终验证

双端执行类型检查、静态检查、构建及包体预算，根目录运行架构与性能检查。

- 恢复控制器回归先复现取消后发布旧快照，再确认只发布新快照。初始快照的身份回归先复现错误的存储读取，再经双端真实 Store 验证。
- 根目录 `pnpm test` 通过 4,246 项，跳过 20 项。最终类型调整后，重新验证共享恢复及 Web 会话用例 202 项、桌面会话用例 119 项。
- `pnpm --dir desktop check:web` 通过，含 845 项单元测试、类型检查、构建与包体预算。Chromium 和 WebKit 的会话结构、容量、活动恢复、可见性共通过 24 项。
- `pnpm test:performance` 通过 15 项，跳过 1 项。`pnpm build`、`pnpm bundle:check`、`pnpm package:check`、静态检查与架构检查均通过。
- 根目录格式脚本将本地忽略的协作公告纳入检查并报告格式问题。使用 Git 文件清单检查全部受版本控制及待加入文件，格式检查通过。
- 共享规范记录 Store 状态提交和快照恢复的边界。本次验证范围为双端前端及共享 TypeScript，浏览器使用 Chromium 和 WebKit。
