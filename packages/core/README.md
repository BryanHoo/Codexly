# `@codexly/core`

维护领域模型、应用用例、Provider 端口、状态机和调度边界，为 Web / 移动访问提供与 Codex / Claude 无关的应用规则。桌面原生层遵守共用协议与数据契约，前端能力尽量复用共享包。

该包只允许依赖 `@codexly/protocol`，不得依赖具体 Provider、HTTP、数据库或浏览器实现。
