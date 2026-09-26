# 跨层契约检查

- Web 请求链为 `apps/web/src/` → `packages/client/src/` → `packages/server/src/routes/`；类型和共享事件在 `packages/protocol/src/`。
- 改动 HTTP 路由时核对 `packages/server/src/routes/schemas.ts`、对应 `http-client-*`、协议类型与服务端路由测试。
- 任务事件横跨服务端 `agent-event-stream.ts`、客户端 `event-client.ts` 与 Web `features/conversation/runtime/`；检查断线恢复、事件顺序和重复处理。
- 公共协议变更还需执行 `pnpm codex:schema:check`、`pnpm lint:architecture`，并按 `CONTRIBUTING.md` 更新契约测试与 `CHANGELOG.md`。
