# 工程规范入口

Codexly 在同一仓库发布 Web CLI 与桌面应用。根目录 `pnpm-workspace.yaml` 和 `pnpm-lock.yaml` 统一管理 `apps/*`、`packages/*` 与 `desktop/`；桌面端保留自己的 `package.json` 和 Rust 工程。

## 按代码位置阅读

| 代码                           | 规范                                             |
| ------------------------------ | ------------------------------------------------ |
| `src/`                         | [CLI 与启动](../root/backend/index.md)           |
| `apps/web/src/`                | [Web 前端](../web/frontend/index.md)             |
| `packages/protocol/src/`       | [公共协议](../protocol/shared/index.md)          |
| `packages/core/src/`           | [领域核心](../core/shared/index.md)              |
| `packages/frontend-core/src/`  | [前端共享逻辑](../frontend-core/shared/index.md) |
| `packages/ui/src/`             | [共享 UI](../ui/shared/index.md)                 |
| `packages/client/src/`         | [HTTP / 事件客户端](../client/shared/index.md)   |
| `packages/provider-codex/src/` | [Codex 集成](../provider-codex/backend/index.md) |
| `packages/server/src/`         | [服务端](../server/backend/index.md)             |
| `desktop/src/`                 | [桌面前端](../desktop/frontend/index.md)         |
| `desktop/src-tauri/`           | [桌面原生层](../desktop/backend/index.md)        |

## 通用约束

- Web 与桌面共用版本号、标签及根目录 `CHANGELOG.md`；共用变化合并描述，Release 正文与桌面离线日志仅从此文件提取，不维护第二份桌面日志。发布流程见 `docs/releasing.md`。
- 已推送发布标签保持不可变；代码、测试或工作流修复必须递增两端版本并创建新标签。失败版本尚未公开时，新版日志仍需覆盖上次正式发布以来的全部变化。
- GitHub Release 的产品与版本标题仅由页面标题显示；正文直接展示合并变更，首行保留桌面更新检查所需的 `codeagent-version` 隐藏标记，并通过 `pnpm test:release` 防止重复标题回归。
- 发布凭据、具体账户及证书标识不得明文进入源码或公开文档；CI 使用仓库 Secrets，本地配置保持 Git 忽略。公开文档仅保留安装、使用、开发和验证所需的信息；个人目录、账户标识、内部地址与任务记录不得进入公开证据，原始日志和截图保存在 Git 忽略的本地目录，性能证据中的进程标识需匿名化；发布门禁回归执行 `pnpm exec vitest run tests/release-workflow.test.ts`。

- 依赖方向以 `dependency-cruiser.config.cjs` 和各包 `package.json` 为准；跨层改动参照[契约检查](./cross-layer-thinking-guide.md)。
- Codex App Server Schema 只维护仓库根目录 `schemas/codex-app-server/<version>.schema-baseline.json`；Web 与桌面分别运行 `pnpm codex:schema:check` 和 `pnpm codex:protocol:check` 校验同一基线。
- 复用规则参照[代码复用](./code-reuse-thinking-guide.md)；平台差异参照[跨平台检查](./cross-platform-thinking-guide.md)。
- Web/CLI 提交门槛为根目录 `pnpm check`；浏览器流程使用 `pnpm test:e2e`。桌面工程在 `desktop/` 运行 `pnpm check`；细分为 `pnpm check:web`、`pnpm check:rust`。
- 根目录普通 Vitest 测试及生命周期钩子默认各预留 60 秒，覆盖 Windows 原生进程、SQLite Worker 冷启动和多实例磁盘操作；集成用例的显式超时不得意外缩短此预算。生产请求与重试时限独立维护，性能验收继续使用 `vitest.performance.config.ts` 及性能断言，不能随普通测试预算一起放宽。
- 改动公共协议时同步 Schema、契约测试与 `CHANGELOG.md`；用户文档 `README.md` 和 `README.zh-CN.md` 保持同步，见 `CONTRIBUTING.md`。
