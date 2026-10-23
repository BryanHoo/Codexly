# Codexly 代码复用边界

## 代码归属

- `packages/protocol` 维护公开 Schema、事件与共享 SQL 契约，不依赖其他内部包。
- `packages/core` 维护领域规则、Provider 与 Repository 端口，只依赖 Protocol。
- `packages/frontend-core` 维护与平台无关的视图模型、增量处理和状态推导。
- `packages/ui` 维护两端共用 React 组件，复用 Frontend Core，通过 props 接收平台行为和文案。
- `packages/client` 维护 Web HTTP/WebSocket 传输；桌面传输留在 `desktop/src/platform/tauri`，避免为复用界面绕行 Web 服务。
- Provider 实现 Core 端口，Server 负责交付装配；依赖边界以根 `dependency-cruiser.config.cjs` 与各包 README 为准。

## 可复用示例

`apps/web/src/shared/components/agent/code-block.tsx` 与 `desktop/src/shared/components/agent/code-block.tsx` 都包装 `@codexly/ui/agent/code-block`，各自注入翻译，桌面再注入 Legacy 主题。跨端渲染优化应优先修改 `packages/ui/src/agent/code-block.tsx`。

## 检查项

- [ ] 搜索共享包与两端调用者，确认现有导出和测试覆盖范围。
- [ ] 将共用纯逻辑放入 Frontend Core、共用组件放入 UI，保留文件系统、IPC、网络等平台实现。
- [ ] 共享包不得反向导入 `apps/web`、`desktop`、根 CLI 或具体交付实现。
- [ ] 运行根 `pnpm lint:architecture`、`pnpm typecheck` 和相关测试；共享 UI 同时核对 Web 与桌面浏览器用例。
