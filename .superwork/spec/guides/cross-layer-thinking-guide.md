# Codexly 跨层契约

## 两条执行链路

- Web / 移动浏览器：`apps/web` → `packages/client` → `packages/server` → Core 端口 → Codex / Claude Provider。
- 桌面：`desktop/src` → Tauri IPC → `desktop/src-tauri/src/application` → `domain` / `infrastructure`；Claude 通过共享适配器的独立 stdio 宿主执行。

## 长期契约

- 公开请求、响应、Agent Event 与 checkpoint 定义在 `packages/protocol/src`；协议变化同时检查 HTTP 客户端、服务端、桌面 `protocol` 与原生应用命令。
- 项目和任务目录由应用管理，任务 ID 与 provider session ID 分开，既有任务的引擎绑定保持稳定。仅配置 Claude 的路径不能要求启动 Codex。见 [引擎参考](../../../docs/agent-engines.md)。
- 两端业务数据共用 `~/.codexly`，目录 Schema 和迁移契约见 `packages/protocol/src/local-catalog-schema.json`、`app-storage-migration.json` 及 [本地目录与任务](../../../docs/local-catalog.md)。不得从 Codex 配置目录或 Tauri 应用目录派生新业务存储。
- 事件更新保持序列、重连与 checkpoint 一致；流式正文增量不应触发全量历史重建、额外轮询或重复持久化。详见 [会话加载与性能](../../../docs/conversation-performance.md)。
- Git 写操作、幂等键和目录权限遵循 [Git 工作流](../../../docs/git-workflow.md)；文件条件保存遵循 [文本编辑契约](../../../docs/text-file-editing.md)。

## 检查项

- [ ] 从输入 Schema 跟踪到执行、存储、事件投影和两端展示，核对取消、错误与重试。
- [ ] 同时核对 Codex / Claude，保持原生配置、审批语义与能力差异。
- [ ] 修改共享存储时同时检查 Node 与 Rust 实现，覆盖迁移、幂等与并发读取。
- [ ] 运行相关协议 / Provider / 交付测试、`pnpm lint:architecture` 和两端类型检查；Codex 协议变化补充 `pnpm codex:schema:check`。
