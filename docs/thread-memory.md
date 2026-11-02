# 当前会话的记忆摘要

在 Web（含移动浏览器）和桌面工作台打开右栏“上下文”，有记忆摘要时显示“会话记忆摘要”。点击标题右侧的刷新图标可更新内容；没有摘要时整个模块隐藏。

摘要保留原始文本与换行。首次加载、空值、纯空白内容、会话未加载或接口不可用时均不显示模块，也不展示内部运行说明。刷新期间保留已有内容，图标旋转并禁止重复点击；刷新失败仍保留可读摘要，可再次点击重试。刷新返回空摘要时隐藏模块。

实现使用 `thread/memory/read`，初始化沿用 `capabilities.experimentalApi: true`。不会扫描全局记忆目录或回退读取其他记忆版本；只在上下文可见时读取，回合变化后更新，不轮询、不持久化摘要。HTTP 响应使用 `Cache-Control: no-store`，任务切换和关闭面板后释放查询缓存。

官方依据：

- [Codex App Server：实验接口和初始化](https://developers.openai.com/codex/app-server/#experimental-api-opt-in)。
- [0.166.0 官方接口定义](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/app-server-protocol/src/protocol/v2/memory.rs)。
- [0.166.0 官方记忆读取实现](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/app-server/src/request_processors/thread_memory.rs)。

设置中的记忆开关和重置继续负责全局配置。
