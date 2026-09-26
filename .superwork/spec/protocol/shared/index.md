# 公共协议

`packages/protocol/src/` 定义 Web、客户端、服务端共享的数据结构、事件和访问契约，公开出口为 `src/index.ts`。它不依赖其他工程包，见 `dependency-cruiser.config.cjs`。

- 协议字段变化须追踪所有消费者、Schema、契约测试和 `CHANGELOG.md`；不要把传输或持久化实现放入此包。
- 用相邻 `*.test.ts` 验证边界数据，并运行 `pnpm codex:schema:check`、`pnpm lint:architecture`、`pnpm typecheck`。
