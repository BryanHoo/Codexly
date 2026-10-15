# 模型与思考强度

Web、移动端和桌面端均以 Codex App Server 的 `model/list` 为首选来源。按照返回的 `supportedReasoningEfforts`、`defaultReasoningEffort`、`isDefault` 和可见性展示模型，不维护模型名或思考档位白名单。

## 账号与自定义 API

- 官方账号：使用当前账号的原生目录及 Codex 自身的认证和目录缓存策略；失败时不复用自定义 API 的目录。
- 自定义 API：优先读取按当前配置创建的原生目录，失败或为空时尝试兼容 `/models`，再使用同一端点的持久化快照。重新连接后使用新认证刷新原生能力。
- 标准 OpenAI `/models` 只提供模型列表，不能假设每个模型支持低、中、高。兼容目录没有能力字段时保留空选项和空默认值，界面隐藏思考强度菜单；提交时转换为原生 `null`，保存全局设置时清除推理覆盖。
- 明确声明的 `none` 表示关闭推理，与未声明能力不同。`xhigh`、`max`、`ultra` 以及未来字符串均按目录原值保留。
- 手动命名可以覆盖展示名，不能清除已经取得的原生能力。切换端点不能复用旧凭据、旧目录地址或旧账号模型。

## 原生目录配置

`base_url` 是推理地址，`model_catalog_url` 可以是独立的目录地址。同端点重新连接和目录准备均保留用户配置的目录 URL。原生 Codex 会添加 `client_version`，处理 Provider 认证与目录协议；应用不自行复刻这套发现流程。`model_catalog_json` 的优先级仍由 Codex 决定。

保留目录 TTL 缓存、并发请求合并、响应大小和超时限制；不添加后台轮询或逐模型能力请求。

## 验证

共享样例位于 `packages/provider-codex/src/custom-model-catalog-fixtures.json`，由 TypeScript 与 Rust 测试同时读取。运行相关模型目录测试、协议测试、会话提交测试及两端类型检查。实际本机验证只读取目录，不创建付费推理回合。

## 官方依据

- [App Server model/list](https://learn.chatgpt.com/docs/app-server#list-models-modellist)：从返回数据读取模型能力和默认值。
- [自定义网关目录](https://learn.chatgpt.com/docs/enterprise/roll-out-a-gateway#serve-a-remote-catalog)：目录地址、完整元数据、认证与版本参数。
