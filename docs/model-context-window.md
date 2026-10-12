# 本机通用上下文窗口

在「设置 → 智能体配置 → 模型默认设置」中编辑「上下文窗口」。数字框以 **k tokens（千 tokens）** 为单位，填写 **272–1000 的整数**，例如 `400` 表示 400k，`1000` 表示 1M。失焦或按 Enter 保存；留空恢复模型默认值，Escape 取消当前输入。输入框与上方选择框统一为 160px 宽、32px 高，并靠右对齐；窄屏宽度受容器限制。

该范围是 Codexly 的输入约束，并非所有模型的官方容量范围。官方 GPT-5.4 文档将 272K 作为长上下文计费分界，标注最大上下文为 1,050,000 tokens。已有的其他合法 Codex 配置值会原样读取、按千 tokens 显示，不会因打开设置页而被截断或覆盖。

配置作用于运行 Codex 的主机。Web 和移动端修改服务端主机的配置，桌面端修改本机配置；它们在共用同一 Codex 配置目录时共用该值。目录由 Codex 定位，默认是 `~/.codex/config.toml`，也支持 `CODEX_HOME`。任务新建或恢复时读取配置，正在运行的会话沿用现有窗口。

优先保留自动模式。`model_context_window` 覆盖所有所选模型的窗口元数据，不会扩大模型或提供商的实际容量。已知最大窗口时，Codex 会限制覆盖值；窗口使用量显示也可能包含 Codex 预留空间。项目配置、profile 或启动参数仍可覆盖用户全局配置。

Codexly 不联动写入 `model_auto_compact_token_limit`：该字段有独立的默认值与限制，由 Codex 处理。如果已经在其他客户端配置过自动压缩阈值，它仍按 Codex 的配置规则生效。

## 实现契约

- 全局协议字段 `modelContextWindow` 为 `null` 或 `1..Number.MAX_SAFE_INTEGER` 的整数，两端共用相同 Schema 边界。
- 两端 UI 只接受空值或 272–1000 的整数，提交前乘以 1000；协议保留官方配置的整数兼容范围。
- 使用官方 `config/read` 和 `config/batchWrite`；不传项目 cwd 或文件路径，写入后重载用户配置并刷新读取缓存。
- 只提交变更字段。`null` 通过官方 API 删除 `model_context_window`，不写入 `0` 或字符串。
- Codex 配置是权威来源；窗口不在 SQLite 或桌面应用偏好文件中维护第二份配置，也不进入项目默认值或回合参数。
- 两端共用 `ModelContextWindowInput` 和输入解析函数；编辑期间只维护组件草稿，提交合法值后复用全局设置保存队列。

## 验证

`runtime-default-settings.test.ts` 和 `global-default-settings.test.ts` 验证 HTTP 端的保存、清空、缓存刷新及非法值拒绝；`model-context-window.test.ts` 验证输入边界；桌面 `context_window_should_*` 验证原生配置往返和应用偏好文件隔离。

## 官方依据

- [配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)：`model_context_window` 与自动压缩阈值定义。
- [配置基础](https://learn.chatgpt.com/docs/config-file/config-basic)：用户配置目录与配置优先级。
- [GPT-5.4 模型文档](https://developers.openai.com/api/docs/models/gpt-5.4)：272K 长上下文计费分界和 1,050,000 tokens 最大窗口。
- 官方源码：`codex-rs/config/src/config_toml.rs` 定义整数配置；`codex-rs/models-manager/src/model_info.rs` 应用模型窗口覆盖及最大值限制；`codex-rs/app-server/src/config_manager_service.rs` 处理 `null` 删除与配置写入。
