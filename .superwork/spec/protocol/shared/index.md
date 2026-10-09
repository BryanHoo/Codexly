# 公共协议

`packages/protocol/src/` 定义 Web、客户端、服务端共享的数据结构、事件和访问契约，公开出口为 `src/index.ts`。它不依赖其他工程包，见 `dependency-cruiser.config.cjs`。

- 协议字段变化须追踪所有消费者、Schema 和契约测试；`CHANGELOG.md` 在发布流程更新，当前版本的 `Unreleased` 保持为空。不要把传输或持久化实现放入此包。
- 任务公共字段、事件公共信封与同义的事件 payload、项目实体及根目录由此包定义；桌面端通过组合共享 Schema 扩展原生字段，跨包契约测试需验证两端引用同一公共定义。
- 用相邻 `*.test.ts` 验证边界数据，并运行 `pnpm codex:schema:check`、`pnpm lint:architecture`、`pnpm typecheck`。
- `AgentTurn.itemTimings` 按 Item ID 保存可选的 `startedAtMs`、`completedAtMs`，时间单位为 Unix 毫秒；流式工具按事件更新，运行中显示临时耗时，完成后仅在开始与结束时间齐全时显示最终耗时。
- `AgentMcpServer.httpOrigin` 为可选的 Codex HTTP 来源；非 HTTP 服务不传此字段，界面不展示空来源。
- Codex app-server 的 `flexUnavailable` 错误映射为公共 `provider.error` 的 `flex_unavailable`，Web Provider 与桌面 Rust 端保持同一分类；升级时同时验证两端映射和协议 Schema。
- `tooManyDenials` 统一映射为 `too_many_denials`；Guardian 中断可能仅通过 `turn/completed` 和历史回合携带错误，必须保留 `interrupted` 状态及错误文本，不能依赖独立 `error` 通知或强制改成失败状态。

- 插件同步结果由共享 `PluginReconcileResultSchema` 定义：保留本次变化的能力标记、远端失败与物化失败 ID；Web POST 使用幂等键，桌面命令返回同一投影。不得把部分失败当成全部成功，也不得将本次变化当作持久累计结果。

- `HistoryCompressionResult` 只含 `status: "scheduled"`；该状态确认压缩维护请求已提交，不代表文件已压缩。两端不得推导完成进度、压缩数量或节省字节。

- 消息阶段共用 `AgentMessagePhaseSchema`，支持 `commentary`、`partial_answer`、`final_answer`；桌面直接引用公共定义。`partial_answer` 保留历史与实时正文，不能触发回合完成，也不能按过程旁白折叠；终态以 `turn/completed` 为准。升级时验证两端消息映射与时间线投影。
