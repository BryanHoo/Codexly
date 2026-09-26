# 工程规范入口

Codexly 在同一仓库发布 Web CLI 与独立桌面应用。根目录 `pnpm-workspace.yaml` 管理 `apps/*`、`packages/*`；`desktop/package.json` 和 `desktop/pnpm-lock.yaml` 属于独立工程。

## 按代码位置阅读

| 代码                           | 规范                                             |
| ------------------------------ | ------------------------------------------------ |
| `src/`                         | [CLI 与启动](../root/backend/index.md)           |
| `apps/web/src/`                | [Web 前端](../web/frontend/index.md)             |
| `packages/protocol/src/`       | [公共协议](../protocol/shared/index.md)          |
| `packages/core/src/`           | [领域核心](../core/shared/index.md)              |
| `packages/client/src/`         | [HTTP / 事件客户端](../client/shared/index.md)   |
| `packages/provider-codex/src/` | [Codex 集成](../provider-codex/backend/index.md) |
| `packages/server/src/`         | [服务端](../server/backend/index.md)             |
| `desktop/src/`                 | [桌面前端](../desktop/frontend/index.md)         |
| `desktop/src-tauri/`           | [桌面原生层](../desktop/backend/index.md)        |

## 通用约束

- 依赖方向以 `dependency-cruiser.config.cjs` 和各包 `package.json` 为准；跨层改动参照[契约检查](./cross-layer-thinking-guide.md)。
- 复用规则参照[代码复用](./code-reuse-thinking-guide.md)；平台差异参照[跨平台检查](./cross-platform-thinking-guide.md)。
- Web/CLI 提交门槛为根目录 `pnpm check`；浏览器流程使用 `pnpm test:e2e`。桌面工程在 `desktop/` 运行 `pnpm check`；细分为 `pnpm check:web`、`pnpm check:rust`。
- 改动公共协议时同步 Schema、契约测试与 `CHANGELOG.md`；用户文档 `README.md` 和 `README.zh-CN.md` 保持同步，见 `CONTRIBUTING.md`。
