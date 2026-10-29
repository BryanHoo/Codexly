# Feature Implementation Plan

**Goal:** 统一 Web / 桌面的任务事件消费契约和状态更新主干，用同一组确定性回放验证实际 Store。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 全局约束。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 共享包与平台适配边界。
- `.superwork/spec/guides/cross-layer-thinking-guide.md` — 事件、审批与 checkpoint。
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 增量性能和原生差异。
- `.superwork/spec/protocol/shared/index.md` — 公开类型依赖。
- `.superwork/spec/frontend-core/shared/index.md` — 共享增量状态。
- `.superwork/spec/web/frontend/index.md` — Web Store 和移动浏览器。
- `.superwork/spec/desktop/frontend/index.md` — 原生链路、公开推理摘要及文件行数。

**Architecture:** 从现有 AgentEvent 派生参数化消费模型，以实体类型参数保留桌面扩展和推理摘要表示；共享 reducer 管理事件分派、条目身份、元数据、审批和终态合并。平台只提供条目工厂、通知策略和终态错误权威性。保持原有 Schema、传输、序号检查、字节预算和增量缓冲，无运行时模型转换或额外网络请求。

**Tech Stack:** TypeScript、TypeBox 既有协议、Zustand 既有 Store、Vitest、pnpm。

## Global Constraints

- 同时覆盖 Web / 移动浏览器和 macOS / Windows / Ubuntu 桌面；原生副作用不进入共享包。
- 不逐 token 物化全文或扫描历史，保留目标 Item 通知和字节预算。
- 桌面只展示公开推理摘要，保留原生终态错误的权威性和 message.skills_updated。
- 关键执行逻辑使用中文注释；桌面源文件与测试不得超过 500 行。
- 不修改既有传输 Schema / 原生协议；CHANGELOG.md 由其他已登记发布任务占用，本次结果记录于本计划和共享规范。
- parallelTask: shared-task-events-20261029 / codex-shared-events-20261029，recordPath: `.superwork/parallel/shared-task-events-20261029.json`。

### Task 1: 建立跨端事件回放契约

**Files:**

- Create: `packages/frontend-core/src/testing/task-event-replay.ts`
- Create: `apps/web/src/features/conversation/runtime/task-store-event-replay.test.ts`
- Create: `desktop/src/features/conversation/runtime/task-store-event-replay.test.ts`

**Interfaces:**

- Consumes: 两端 createTaskStore、AgentEvent、AgentTaskSnapshotResponse。
- Produces: 两端共用 runTaskEventReplayContract，接受真实 Store 工厂及推理事件适配。

**Behavior:**

- 回放两种引擎、单事件/批量事件、重复/错任务/错会话事件、审批生命周期、正文/推理/命令增量、终态接管。
- 验证晚到的空启动事件保留提交占位，权威用户消息原位接管，不移动到助手输出之后。

**Stop Conditions:**

- 如果回放必须加载原生运行时或真实模型，修正测试边界后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-store-event-replay.test.ts`

Expected: 在现有 Web 实现上观察到晚到启动或占位接管的预期 RED；共享 reducer 后两端同一契约全部通过。

### Task 2: 提取共享事件模型与状态更新

**Files:**

- Create: `packages/protocol/src/task-event-model.ts`
- Modify: `packages/protocol/src/index.ts`
- Create: `packages/frontend-core/src/task-event-model.ts`
- Create: `packages/frontend-core/src/task-event-reducer.ts`
- Create: `packages/frontend-core/src/task-event-timing.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-timing.ts`
- Modify: `desktop/src/features/conversation/runtime/task-store-timing.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-events.ts`
- Modify: `desktop/src/features/conversation/runtime/task-store-events.ts`

**Interfaces:**

- Consumes: AgentEvent、平台实体类型、TaskItemStore、原有计时和通知规则。
- Produces: TaskEventModel、TaskEventState、createTaskEventReducer，两端只保留显式适配。

**Behavior:**

- 主事件 switch 只维护一份；两端保留实体扩展、原生终态错误和通知策略。
- 共享身份接管修复 Web 的空启动覆盖和用户消息重排。
- 增量仍原位更新 Item Store，并由原批次统一发布。

**Stop Conditions:**

- 如果需要修改原生协议、丢失桌面扩展或引入不安全跨平台强制转换，先修订设计。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime packages/frontend-core/src`

Expected: 共享回放及现有身份、审批、历史、错误和字节预算用例通过；桌面通过对应 runtime 单测。

### Task 3: 验证边界、性能并记录长期契约

**Files:**

- Modify: `.superwork/spec/frontend-core/shared/index.md`
- Modify: `.superwork/plans/2026-10-29-shared-task-events.md`

**Interfaces:**

- Consumes: 两端回放、类型检查、依赖边界、性能和构建结果。
- Produces: 共享规范及当前执行的验证证据。

**Behavior:**

- 验证两端类型、runtime 测试、相关生产构建与既有性能门槛，记录尚未验证的平台。

**Stop Conditions:**

- 必需检查失败时先判断是否由本改动引起；不得把失败记录为通过。

- [x] **Task Status:** completed

Run: `pnpm typecheck`

Expected: 根与桌面类型、架构和相关性能检查通过，记录各命令实际结果。

## 执行证据

- Task 1 RED：`pnpm exec vitest run apps/web/src/features/conversation/runtime/task-store-event-replay.test.ts` 在现有实现中 4 失败 / 8 通过，分别复现两种引擎的空启动清空提交和用户接管重排。
- Task 1 / 2 GREEN：共享后 Web 与 Frontend Core 90 文件 / 586 用例通过，桌面 runtime 18 文件 / 101 用例通过；两端 TypeScript 检查退出 0。
- 收敛后检查发现旧计时辅助逻辑只剩桌面测试引用，将两份旧文件改为共享计时模块的兼容导出，避免维护不再执行的副本；后续验证重新覆盖。

## 最终验证与交接

工作目录均为仓库根目录，`pnpm --dir desktop` 由命令切换到桌面子项目。依赖和锁文件未修改；测试使用原有 fixture 与真实平台 Store，无模型或真实网络服务依赖。

- 简化结果：changed。共享事件分派、终态条目合并与计时规则，两端旧计时入口仅做类型绑定和共享导出；公共 index 删除已由 project-git 星号导出的重复类型行以保持 500 行门槛。
- 规范决策：update。已更新 `.superwork/spec/frontend-core/shared/index.md`，说明消费模型、平台实体扩展、原生终态权威性及回放要求。索引内所有本地链接已验证存在。
- `pnpm test`：660 文件通过 / 6 文件跳过，3778 用例通过 / 28 用例跳过，退出 0。该全量结果复用于既有协议、Provider、Client 与 Server 的覆盖；末次计时兼容导出简化后，对受影响的两端回放、runtime 和计时用例重新验证，未修改后端实现或 fixture。
- `pnpm --dir desktop test:run`：166 文件 / 670 用例通过，退出 0。原有原生错误、技能补丁、通知和身份行为保持通过；末次简化后的对应回归见下项。
- `pnpm exec vitest run apps/web/src/features/conversation/runtime packages/frontend-core/src`：90 文件 / 586 用例通过，退出 0。
- `pnpm --dir desktop test:run src/features/conversation/runtime`：18 文件 / 101 用例通过，退出 0。
- 最后一次兼容导出类型简化后，再运行两端 `task-store-event-replay.test.ts` 与 `task-store-timing.test.ts`，均退出 0；只复用未被后续改动影响的全量测试证据。
- `pnpm typecheck` 与 `pnpm --dir desktop typecheck`：最终源码均退出 0；默认 TaskEventModel 与 AgentEvent 双向类型兼容，审批状态保持判别。
- `pnpm lint`、`pnpm --dir desktop lint`、`pnpm lint:architecture`、`pnpm --dir desktop source:lines`：最终源码均退出 0。依赖检查覆盖 1916 模块、6213 依赖，无违规。
- `pnpm format:check`、`git diff --check`：退出 0。
- `pnpm build`、`pnpm --dir desktop build`、`pnpm --dir desktop build:legacy`：退出 0。
- `pnpm bundle:check`：退出 0，初始包 314.48 KiB / 320 KiB，工作台就绪 469.61 KiB / 500 KiB。
- `pnpm --dir desktop performance:budget`、`pnpm package:check`、`pnpm codex:schema:check`：退出 0；Codex Schema 仍为 0.164.0。
- `pnpm test:performance`：9 文件 / 17 用例通过，退出 0。该检查在构建与其他测试结束后单独执行。
- `pnpm exec playwright test tests/e2e/app-shell-runtime-recovery.spec.ts tests/e2e/app-shell-runtime-requests.spec.ts tests/e2e/app-shell-runtime-queue.spec.ts --workers=2`：25 用例通过，退出 0，涵盖 Chromium、Firefox、WebKit 及 390px 审批。
- `pnpm --dir desktop test:browser src/features/workbench/components/task-timeline-running.browser.test.tsx src/features/workbench/components/task-timeline-async-question.browser.test.tsx`：4 文件 / 8 用例通过，退出 0，涵盖 Chromium / WebKit。
- 验证平台为 macOS。未运行 Windows / Ubuntu 原生安装包和实机回归；本次未修改 Rust、IPC 或进程执行代码。未扩大为整仓浏览器或完整 Rust 构建检查。

公共影响：未来修改公共事件处理必须改共享 reducer，并同时执行两端回放；传输 Schema 保持原状，实体类型由平台绑定，不能借共享化丢弃公开摘要、文件 stats 或桌面审批扩展。CHANGELOG.md 属于已有发布任务范围，未交叉写入。此任务无需用户确认，未提交 Git。
