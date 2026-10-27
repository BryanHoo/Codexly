# 领域规则与端口

## 位置与职责

`packages/core/src` 维护领域模型、应用用例、Provider / Repository 端口、任务状态和调度边界；`agent-provider.ts`、`engine-router.ts`、`local-catalog.ts` 是相关入口。依赖约束见 [Core README](../../../../packages/core/README.md)。

## 契约与检查项

- [ ] 内部依赖仅限 Protocol，不导入具体 Provider、数据库、HTTP 或浏览器实现。
- [ ] 任务目录、引擎身份和状态迁移通过端口表达，由交付层注入实现；保持应用任务 ID 与原生会话 ID 分离。
- [ ] 队列、历史附件与保留工作预算遵循现有有界实现，取消或删除不能遗留后台工作。
- [ ] 执行 `pnpm exec vitest run packages/core/src`、`pnpm typecheck`、`pnpm lint:architecture`，接口变化补充 Provider / Server 消费者测试。

跨端数据语义见 [本地目录与任务](../../../../docs/local-catalog.md)，引擎语义见 [智能体引擎](../../../../docs/agent-engines.md)。

## 排队消息的轮次切换与拒绝恢复

- [共享队列](../../../../packages/core/src/persistent-task-queue.ts) 与两端输入框一致，从时间升序历史中选择最新运行回合，避免命中旧会话残留的未完成标记。
- Provider 仅在明确保证输入未提交时抛出 `AgentTurnNotSubmittedError`。Codex 仅映射错误码 `-32600` 且完整消息为 `no active turn to steer`，或 expected ID 与本次目标一致的轮次不匹配响应；断线、超时、解析失败及相似错误文本保持结果未知。
- 明确拒绝后先持久化回退执行占用，再恢复可编辑、可发送状态。仓储以 `null` 表示回退，且仅允许从 `starting` 清除，禁止覆盖已接受的 `started` 结果。Web SQLite、内存与桌面 Claude 文件仓储保持一致。
- 未绑定回合的“立即发送”允许在同一任务锁内重新读取状态并补发一次；显式绑定回合的引导不得改投后来回合。连续拒绝保留队列；结果未知继续阻塞，不能自动重复发送。
- 回归入口为 `packages/server/src/persistent-task-queue.test.ts`、`app-queue-dispatch.test.ts`、`sqlite-queue-execution.test.ts`、`packages/provider-codex/src/agent-provider-steer-errors.test.ts` 与 `packages/provider-claude/src/queue-repository.test.ts`，覆盖轮次切换、历史残留、重启恢复、并发幂等及未知结果保护。
