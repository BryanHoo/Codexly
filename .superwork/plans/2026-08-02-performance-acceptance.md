# Performance Acceptance Implementation Plan

**Goal:** 为已文档化的高风险负载建立可重复执行的压力测试和性能回归阈值。

**Suggested Spec Reads:**

- `.superwork/spec/backend/runtime-lifecycle.md` — 定义 Delta 合并、WebSocket 背压、附件和资源释放边界。
- `.superwork/spec/backend/quality-guidelines.md` — 定义 Event Stream、附件与 Fastify 测试要求。
- `.superwork/spec/frontend/quality-guidelines.md` — 定义长历史、DOM 规模和流式渲染检查要求。
- `.superwork/spec/shared/quality-guidelines.md` — 定义跨层容量、附件和事件契约。
- `docs/architecture-design.md` — 提供系统性能目标和性能测试范围。
- `docs/web-design.md` — 提供长历史虚拟化、渲染和 Heap 验收目标。

**Architecture:** 使用独立 Vitest 配置串行运行固定规模负载；测试直接调用真实 Store、Timeline、Event Stream、Attachment Store 和 Git 状态实现，以集中 JSON 预算作为回归阈值。普通单测排除压力用例，`pnpm test:performance` 单独执行，并由 `pnpm check` 纳入门禁。

**Tech Stack:** TypeScript、React SSR、Vitest、Node.js、pnpm。

## Global Constraints

- 压力输入必须固定、离线且不依赖真实 Codex、网络、Git 仓库规模或墙钟等待。
- 时间阈值保留 CI 抖动余量，同时用结果规模、命令次数、DOM 挂载量和 Heap 增量等确定性断言约束复杂度。
- Heap 验收必须在显式 GC 可用时执行，测试入口负责以 `--expose-gc` 启动 Vitest。
- 普通 `pnpm test` 不执行性能套件；`pnpm check` 必须执行性能门禁。
- 覆盖率阈值只锁定现有整数基线：Statements 63、Branches 59、Functions 59、Lines 64。
- 不启动开发服务器，不依赖 Chrome 或外部服务完成默认验收。

### Task 1: 建立独立性能门禁与集中预算

**Files:**

- Create: `vitest.performance.config.ts`
- Create: `tests/performance-budgets.json`
- Modify: `vitest.config.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `VitestConfig`、`PackageScripts`。
- Produces: `PerformanceTestCommand`、`PerformanceBudgets`。

**Behavior:**

- 普通测试排除 `*.performance.test.{ts,tsx}`；性能入口单 Worker 串行运行这些文件，并通过显式 GC 支持 Heap 验收；`pnpm check` 同时执行普通测试、性能测试和现有构建门禁。
- 覆盖率配置拒绝低于当前整数基线的回归。

**Stop Conditions:**

- 如果 Vitest 4 无法通过独立配置发现性能文件，停止并修正配置接口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run --config vitest.performance.config.ts --passWithNoTests`

Expected: 独立性能配置成功加载；尚无性能测试时允许空套件通过。

### Task 2: 验收长历史、高频 Delta 与前端 Heap

**Files:**

- Create: `apps/web/src/features/workbench/components/task-timeline.performance.test.tsx`
- Create: `apps/web/src/features/conversation/runtime/task-store.performance.test.ts`

**Interfaces:**

- Consumes: `TaskTimeline`、`createTaskStore`、`AgentTaskSnapshotResponse`、`AgentEvent`、`PerformanceBudgets`。
- Produces: `WebPerformanceEvidence`。

**Behavior:**

- 固定构造 1,000 Turn、每 Turn 10 Item 的历史，验证归一化数量、虚拟挂载 Turn 数、SSR 输出规模和耗时阈值。
- 固定向单个活动 Item 回放 50,000 个 Delta，验证只触发一次 Item 发布、最终内容完整且耗时受限。
- 重复创建、更新并释放 Store，在显式 GC 后验证 Heap 增量低于预算。

**Stop Conditions:**

- 如果测试必须依赖浏览器布局才能观察虚拟化边界，停止并改用现有 Playwright Fake Server 场景。

- [x] **Task Status:** completed

Run: `pnpm test:performance apps/web/src/features`

Expected: 长历史、高频 Delta 与前端 Heap 压力测试全部通过。

### Task 3: 验收事件流、大附件、大 Git 状态与服务端 Heap

**Files:**

- Create: `packages/server/src/event-socket-sender.ts`
- Create: `packages/server/src/performance.performance.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `tests/performance-budgets.json`

**Interfaces:**

- Consumes: `AgentEventStream`、`AttachmentStore`、`readGitWorkingTreeStatus`、`EventStreamSocket`、`PerformanceBudgets`。
- Produces: `ServerPerformanceEvidence`。

**Behavior:**

- 固定发布 100,000 个同 key Delta 并施加软背压，验证仅发布一个合并事件、指标准确且耗时受限。
- 使用可控 `bufferedAmount` 验证软背压不阻塞发送、硬背压停止发送并以 `1013` 关闭连接。
- 以固定大小 Chunk 流式写入 50 MiB 附件，验证磁盘大小、堆增量和处理耗时受限，完成后清理临时目录。
- 模拟 500 个 tracked Git 变更，验证只执行 staged/unstaged 两次批量 diff、结果完整且耗时受限。
- 重复创建、关闭 Event Stream 并执行显式 GC，验证 Heap 无持续超预算增长。

**Stop Conditions:**

- 如果测试依赖平台文件系统速度导致稳定性不足，停止并将时间预算与内存/调用次数预算拆分。

- [x] **Task Status:** completed

Run: `pnpm test:performance packages/server/src/performance.performance.test.ts`

Expected: 高频事件、慢客户端背压、大附件、大 Git 状态和服务端 Heap 压力测试全部通过。

### Task 4: 更新性能验收文档并完成全量验证

**Files:**

- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: `PerformanceTestCommand`、`PerformanceBudgets`、`WebPerformanceEvidence`、`ServerPerformanceEvidence`。
- Produces: `DocumentedPerformanceAcceptance`。

**Behavior:**

- 将性能目标从建议列表连接到实际命令与预算文件，明确固定负载、失败含义和阈值调整要求。
- 运行覆盖率、性能套件与统一门禁，确认新增验收不会遗漏普通构建和 E2E 风险。

**Stop Conditions:**

- 如果全量门禁暴露与本改动无关且无法安全修复的问题，记录失败证据并停止。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:coverage && pnpm test:e2e`

Expected: 统一门禁、覆盖率阈值和浏览器 E2E 全部通过。
