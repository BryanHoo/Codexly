# Feature Implementation Plan

**Goal:** 每次本地启动 Codexly 后直接打开新的 Web 页面，并完整移除旧页面检测与重连刷新功能。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包契约删除、测试与验证方式。
- `.superwork/spec/backend/runtime-lifecycle.md` — 定义 CLI 启动、浏览器打开和 Server 生命周期。
- `.superwork/spec/frontend/directory-structure.md` — 当前记录 Web 浏览器会话监控职责，需要随功能删除更新。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Client、Server 与 Web 的依赖方向。

**Architecture:** CLI 在本地 Server 监听成功后直接调用系统浏览器；删除 Browser Session HTTP Schema、Client 方法、Server 路由、Web 轮询及 WebSocket 断开桥接，不保留兼容接口。LAN 模式继续不自动打开浏览器，自定义端口继续用于监听与打开地址。

**Tech Stack:** TypeScript、Fastify、React、Vitest、pnpm。

## Global Constraints

- 保留 `--port` 的 `1-65535` 校验、本地/LAN 监听和地址输出行为。
- 仅移除启动页面复用功能，不改变 Project Runtime WebSocket 自身的连接恢复逻辑。
- 删除无消费者旧接口，不保留 `/v1/browser-session`、`BrowserSessionResponse` 或空壳适配。
- 所有项目命令使用 pnpm，最终运行 `pnpm check` 与 `pnpm test:e2e`。

### Task 1: 直接打开新页面并删除浏览器会话握手链路

**Files:**

- Modify: `src/cli-command.ts`
- Test: `src/cli-command.test.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime-events.ts`
- Delete: `apps/web/src/app/browser-session.ts`
- Delete: `apps/web/src/app/browser-session.test.ts`
- Delete: `apps/web/src/shared/browser-session-events.ts`
- Modify: `packages/protocol/src/agent-runtime.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/http-client-transport.ts`
- Test: `packages/client/src/http-client.test.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/app.ts`
- Delete: `packages/server/src/routes/browser-session-route.ts`
- Test: `packages/server/src/app.test.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/directory-structure.md`

**Interfaces:**

- Consumes: `CliManagedServer.listen`、`CliDependencies.openBrowser`、解析后的 `port`。
- Produces: 本地启动监听成功后无条件调用 `openBrowser(http://127.0.0.1:<port>)`；移除 `waitForBrowserConnection`、`onBrowserConnection`、`GET /v1/browser-session`、`BrowserSessionResponseSchema`、`CodexlyClient.getBrowserSession` 与 Web Browser Session Monitor。

**Behavior:**

- 本地 `codexly start` 每次监听成功后都立即打开一个新页面，不探测或刷新已打开页面；浏览器打开失败仍只输出警告并保持 Server 运行。`--lan` 仍不自动打开页面，`--port` 仍决定监听和浏览器 URL。

**Stop Conditions:**

- 如果 Browser Session 契约仍有启动页面复用之外的真实消费者，停止并重新评估删除范围。
- 如果删除断开通知会改变 Project Runtime WebSocket 自身的重连状态机，停止并保留该独立能力。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run src/cli-command.test.ts packages/server/src/app.test.ts packages/client/src/http-client.test.ts packages/protocol/src/project.test.ts`

Expected: 目标测试通过，类型与源码搜索中不再存在 Browser Session 握手接口，CLI 测试确认每次本地启动均调用 `openBrowser`。
