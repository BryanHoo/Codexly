# 代码复用

- 公共数据结构先查 `packages/protocol/src/`；领域规则查 `packages/core/src/`，避免在 Web、HTTP 客户端和服务端重复实现。
- Web 与桌面应用各有 `features/`、`shared/`；跨应用复用前核对运行时与传输差异。
- 新功能优先扩展现有 `routes/`、`http-client-*`、`features/` 模块，并将测试放在所属模块附近。
