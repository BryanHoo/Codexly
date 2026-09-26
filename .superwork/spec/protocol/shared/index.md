# 公共协议

`packages/protocol/src/` 定义 Web、客户端、服务端共享的数据结构、事件和访问契约，公开出口为 `src/index.ts`。它不依赖其他工程包，见 `dependency-cruiser.config.cjs`。

- 协议字段变化须追踪所有消费者、Schema 和契约测试；`CHANGELOG.md` 在发布流程更新，当前版本的 `Unreleased` 保持为空。不要把传输或持久化实现放入此包。
- 用相邻 `*.test.ts` 验证边界数据，并运行 `pnpm codex:schema:check`、`pnpm lint:architecture`、`pnpm typecheck`。
- `AgentTurn.itemTimings` 按 Item ID 保存可选的 `startedAtMs`、`completedAtMs`，时间单位为 Unix 毫秒；流式工具按事件更新，运行中显示临时耗时，完成后仅在开始与结束时间齐全时显示最终耗时。
- `AgentMcpServer.httpOrigin` 为可选的 Codex HTTP 来源；非 HTTP 服务不传此字段，界面不展示空来源。
