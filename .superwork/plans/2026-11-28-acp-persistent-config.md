# Feature Implementation Plan

**Goal:** 两端启动复用 ACP 配置快照，按模型更新真实选项，发送优先于后台探测。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` 工程与验证约束
- `.superwork/spec/frontend-core/shared/index.md` 草稿和送达契约

**Architecture:** ACP 宿主负责原子存盘和探测生命周期。Web 和桌面消费同一快照协议。

**Tech Stack:** TypeScript、Fastify、React、Tauri、Vitest。

## Global Constraints

- 保留已启用 Agent 的有序预取和单项超时。缓存只用于展示，真实会话负责应用设置。
- 文件写入采用现有 ACP 存储互斥，后台操作可取消。

### Task 1: 宿主配置快照和真实会话协调

**Files:**

- Create: `packages/provider-acp/src/startup-config.ts`、`packages/provider-acp/src/startup-config-runtime.ts`
- Test: `packages/provider-acp/src/startup-config.test.ts`、`tools/acp-host.test.mjs`
- Modify: `packages/provider-acp/src/runtime.ts`、`packages/provider-acp/src/provider.ts`、`packages/core/src/acp-service.ts`、`packages/protocol/src/acp-service.ts`

**Interfaces:**

- Consumes: ACP 配置选项、设置存储和启动端口
- Produces: 单引擎缓存读取、独立探测、真实选项更新和优先取消

**Behavior:**

- 跨进程读取匹配快照，失败不清空缓存，模型选项隔离，用户发送可立即抢占探测。

**Stop Conditions:**

- 真实发送的作用域或权限边界无法保持。

- [x] 宿主快照、真实选项学习和发送优先

Run: `pnpm exec vitest run packages/provider-acp/src/startup-config.test.ts`

Expected: 快照、模型选项和取消测试通过。

### Task 2: 两端读取快照并刷新模型选项

**Files:**

- Create: `packages/server/src/routes/acp-config-cache-routes.ts`
- Modify: `packages/server/src/routes/acp-routes.ts`、`packages/client/src/http-client-acp.ts`、`packages/provider-acp/src/host-dispatch.ts`、`desktop/src-tauri/src/application/acp_commands.rs`、`desktop/src-tauri/src/application/acp_host/transport.rs`、`desktop/src/platform/tauri/acp-client.ts`
- Modify: `packages/ui/src/core/acp-preview-cache.ts`、`packages/ui/src/core/acp-engine-setup-gate.tsx`、`packages/ui/src/core/use-acp-draft.tsx`、`packages/ui/src/core/use-acp-session.tsx`、`packages/ui/src/core/acp-draft-composer.tsx`
- Test: `tests/e2e/app-shell-acp-draft.spec.ts`、`packages/ui/src/core/acp-preview-cache.test.ts`、`packages/server/src/acp-config-cache.test.ts`

**Interfaces:**

- Consumes: 宿主配置快照、实时会话配置和前端缓存
- Produces: 启动菜单缓存优先和即时模型切换

**Behavior:**

- 两端先读磁盘快照，再发布有序刷新结果。模型切换按缓存中对应模型展示思考或速度。

**Stop Conditions:**

- 有序刷新与启动缓存互相覆盖。

- [x] Web 和桌面接入快照，模型切换即时生效

Run: `pnpm exec vitest run packages/ui/src/core/acp-preview-cache.test.ts`

Expected: 缓存读写与等待边界回归通过。

## 验证结果

- 全仓类型检查、根目录和桌面 lint、架构检查与 Rust 格式检查通过。
- Web 在 Chromium、Firefox、WebKit 下的宽窄屏首发回归共 6 项通过。用例保持完整目录扫描和探测请求挂起。
- 桌面 Chromium 与 WebKit 的 ACP 浏览器回归共 38 项通过。编译宿主共 11 项通过，覆盖后台会话登记和配置缓存读写。macOS 的 ACP 命令 Rust 测试共 3 项通过。
- Web 和桌面生产构建及包体预算通过。
