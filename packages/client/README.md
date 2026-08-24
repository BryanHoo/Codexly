# `@code-agent/client`

维护 Web 使用的轻量 HTTP/WebSocket 客户端和协议解码边界，负责 Agent Event 校验、Sequence Gap 检测、重连与取消清理。

该包只依赖 Protocol，不得导入 Server、Core 或具体 Provider 实现。
