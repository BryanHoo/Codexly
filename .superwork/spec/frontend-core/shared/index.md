# 前端共享逻辑

## 位置与职责

`packages/frontend-core/src` 承载 Web / 桌面共用的视图模型、状态推导、增量 Markdown 和事件处理；`document-workspace.ts`、`split-workspace.ts`、`event-flush-scheduler.ts` 是现有复用入口。导出由本包 `package.json` 的根入口和子路径规则定义。

## 契约与检查项

- [ ] 不导入具体 Web / 桌面应用、Client、Core、Provider、Server 或根 CLI，传输与原生副作用由平台适配器承接。
- [ ] 文档、分屏、草稿与任务选择保持两端一致；修改共享规则时检查全部消费者。
- [ ] 沿用增量文本、字节 LRU 与批量事件调度，避免逐 token 重扫历史或无界缓存。
- [ ] 执行 `pnpm exec vitest run packages/frontend-core/src`、`pnpm typecheck`、`pnpm lint:architecture`；渲染状态变化补充两端交互验证与 `pnpm test:performance`。

相关契约：[文档工作区](../../../../docs/document-workspace.md)、[会话加载与性能](../../../../docs/conversation-performance.md)、[复用边界](../../guides/code-reuse-thinking-guide.md)。
