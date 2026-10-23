# 领域规则与端口

## 位置与职责

`packages/core/src` 维护领域模型、应用用例、Provider / Repository 端口、任务状态和调度边界；`agent-provider.ts`、`engine-router.ts`、`local-catalog.ts` 是相关入口。依赖约束见 [Core README](../../../../packages/core/README.md)。

## 契约与检查项

- [ ] 内部依赖仅限 Protocol，不导入具体 Provider、数据库、HTTP 或浏览器实现。
- [ ] 任务目录、引擎身份和状态迁移通过端口表达，由交付层注入实现；保持应用任务 ID 与原生会话 ID 分离。
- [ ] 队列、历史附件与保留工作预算遵循现有有界实现，取消或删除不能遗留后台工作。
- [ ] 执行 `pnpm exec vitest run packages/core/src`、`pnpm typecheck`、`pnpm lint:architecture`，接口变化补充 Provider / Server 消费者测试。

跨端数据语义见 [本地目录与任务](../../../../docs/local-catalog.md)，引擎语义见 [智能体引擎](../../../../docs/agent-engines.md)。
