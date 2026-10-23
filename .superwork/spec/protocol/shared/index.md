# 公开协议与共享数据契约

## 位置与职责

`packages/protocol/src` 维护 Provider 无关请求 / 响应、JSON Schema、Agent Event、控制帧和 checkpoint。公开导出由本包 `package.json` 定义；边界说明见 [Protocol README](../../../../packages/protocol/README.md)。

## 契约与检查项

- [ ] 保持内部依赖图最底层，不导入其他内部包，也不承载运行时编排或 Provider 专有逻辑。
- [ ] 协议变化同时核对 Client、Server、两种 Provider 及桌面原生 / 前端映射，并更新契约测试和 `CHANGELOG.md`。
- [ ] 修改 `local-catalog-schema.json`、`app-storage-migration.json`、`token-usage-sql.json` 时同步验证 Node / Rust 消费者和同机共享存储兼容性。
- [ ] 执行 `pnpm exec vitest run packages/protocol/src`、`pnpm typecheck`、`pnpm lint:architecture`；按影响补充消费者测试。

事实来源：[本地目录与任务](../../../../docs/local-catalog.md)、[用量统计](../../../../docs/usage-statistics.md)、[跨层契约](../../guides/cross-layer-thinking-guide.md)。

## Web 诊断契约

- `packages/protocol/src/diagnostics.ts` 定义 `DiagnosticsResponseSchema` 和 `DiagnosticsResponse`，由 Client `getDiagnostics()` 与 Server `GET /v1/diagnostics` 共用；版本固定为 1，包含导出时间、运行环境、脱敏 JSON 日志行和淘汰计数。该 HTTP 快照不替换桌面原生 ZIP 导出协议。
