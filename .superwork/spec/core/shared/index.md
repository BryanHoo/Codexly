# 领域核心

`packages/core/src/` 保存任务、项目、提交和 Provider 抽象等与传输无关的领域规则；只依赖 `@codexly/protocol`。

- 领域行为与不变量放在本包，Fastify 路由、Codex 进程和 React 状态留在各自层。
- 对行为变更运行同目录测试、`pnpm lint:architecture` 与 `pnpm typecheck`。
