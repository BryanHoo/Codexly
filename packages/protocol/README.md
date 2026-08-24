# `@code-agent/protocol`

维护 Provider 无关的公开协议、JSON Schema、Agent Event v1、WebSocket 控制帧和 Snapshot checkpoint。

该包是依赖图的最底层，不得依赖其他内部包，也不得包含运行时编排或 Provider 专有逻辑。
