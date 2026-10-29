# Claude 执行适配器与宿主

## 位置与职责

`packages/provider-claude/src` 实现 Claude Agent SDK 适配、原生配置、会话恢复、审批、历史与工具投影。`provider.ts`、`runtime.ts`、`session.ts` 承载执行，`host.ts` 是桌面 stdio 宿主入口。见 [包说明](../../../../packages/provider-claude/README.md)。

## 契约与检查项

- [ ] Web 服务与桌面宿主复用同一适配器，不依赖 Server、Client 或 Web UI。
- [ ] 任务 ID 与 Claude session ID 分开，凭据和用户设置沿用 Claude 原生配置；仅启用 Claude 不要求配置或启动 Codex。
- [ ] 能力、审批和模型语义遵循 Claude 实际接口，不复制 Codex 沙盒假设；macOS Legacy 不提供 Claude。
- [ ] 历史分页、渲染缓冲、宿主输出与用量投影保持有界；状态终结与统计失败分离，参照 [会话性能](../../../../docs/conversation-performance.md)、[用量统计](../../../../docs/usage-statistics.md)。
- [ ] 执行 `pnpm exec vitest run packages/provider-claude/src`、`pnpm test:claude-host`、`pnpm typecheck`；宿主 / 资源变化核对 [桌面运行时分发](../../../../desktop/docs/provider-runtime-management.md) 和原生侧消费者。

## 停止后归档与删除

- 目录中的 `active` 可能来自宿主退出、目录终态写入失败或待恢复的持久化事务，不能仅凭此标记认定任务仍在执行。归档、删除必须先检查启动占用、终态提交及前台/后台真实工作，再在同一任务占用内校正过期标记，通过 Web 与桌面目录的运行保护；无需先打开聊天或读取完整正文。
- 归档保留历史，先重试待恢复终态；持久化仍失败时保留任务和恢复入口。永久删除沿用显式清理语义，清理恢复记录后才解除遗留标记并移除目录，防止后续重试复活历史。校正期间禁止启动新回合或并发移除，失败必须释放本次占用以便重试。
- 回归入口为 `packages/provider-claude/src/provider.test.ts`：覆盖完成、停止及空闲查询遗留状态、重启后直接操作、真实后台工作保护、归档竞争与持久化失败重试；桌面交付执行 `pnpm test:claude-host`。
