# Claude 执行适配器与宿主

## 位置与职责

`packages/provider-claude/src` 实现 Claude Agent SDK 适配、原生配置、会话恢复、审批、历史与工具投影。`provider.ts`、`runtime.ts`、`session.ts` 承载执行，`host.ts` 是桌面 stdio 宿主入口。见 [包说明](../../../../packages/provider-claude/README.md)。

## 契约与检查项

- [ ] Web 服务与桌面宿主复用同一适配器，不依赖 Server、Client 或 Web UI。
- [ ] 任务 ID 与 Claude session ID 分开，凭据和用户设置沿用 Claude 原生配置；仅启用 Claude 不要求配置或启动 Codex。
- [ ] 能力、审批和模型语义遵循 Claude 实际接口，不复制 Codex 沙盒假设；macOS Legacy 不提供 Claude。
- [ ] 历史分页、渲染缓冲、宿主输出与用量投影保持有界；状态终结与统计失败分离，参照 [会话性能](../../../../docs/conversation-performance.md)、[用量统计](../../../../docs/usage-statistics.md)。
- [ ] 执行 `pnpm exec vitest run packages/provider-claude/src`、`pnpm test:claude-host`、`pnpm typecheck`；宿主 / 资源变化核对 [桌面运行时分发](../../../../desktop/docs/provider-runtime-management.md) 和原生侧消费者。
