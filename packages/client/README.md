# `@codexly/client`

维护电脑 Web 与移动浏览器使用的轻量 HTTP/WebSocket 客户端和协议解码边界，负责 Agent Event 校验、Sequence Gap 检测、重连与取消清理。

该客户端承载 Codex / Claude 共用协议；桌面应用使用 Tauri 原生传输，不为复用界面而绕行 Web 服务。

该包只依赖 Protocol，不得导入 Server、Core 或具体 Provider 实现。
