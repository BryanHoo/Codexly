# 领域核心

`packages/core/src/` 保存任务、项目、提交和 Provider 抽象等与传输无关的领域规则；只依赖 `@codexly/protocol`。

- 领域行为与不变量放在本包，Fastify 路由、Codex 进程和 React 状态留在各自层。
- 对行为变更运行同目录测试、`pnpm lint:architecture` 与 `pnpm typecheck`。

- 目录和任务元数据由应用本地仓储独占管理；Project 必须恰好一个根目录。上游列表仅用于一次性事务导入；执行适配器翻译应用任务 ID 与 provider/sessionId，禁止用引擎列表覆盖本地管理状态。两端共享 SQL 契约和单选规则，变更须覆盖离线管理、迁移回滚与身份隔离测试。详见[本地目录与任务](../../../../docs/local-catalog.md)。

- 多引擎路由使用持久 provider 身份；新建选择不能修改历史任务。公共抽象只包含可证明的共同语义，Claude 契约见[Claude 执行适配](../../provider-claude/backend/index.md)。
