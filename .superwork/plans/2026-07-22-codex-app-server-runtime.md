# Codex App Server Runtime Implementation Plan

**Goal:** 实现可由根 CLI 使用的 Codex Binary 定位、App Server JSONL/RPC 长驻进程与 Fake App Server 契约测试。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束统一命名、验证门禁和发布结构。
- `.superwork/spec/backend/directory-structure.md` — 明确根 CLI 与 `provider-codex` 的职责边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 App Server 启动参数、RPC 超时和幂等关闭。
- `.superwork/spec/backend/quality-guidelines.md` — 要求使用 Fake App Server 覆盖 Provider 集成行为。
- `.superwork/spec/shared/directory-structure.md` — 约束 Workspace 依赖方向和公开入口。

**Architecture:** `provider-codex` 分为 Binary 发现与版本门禁、JSONL/RPC 传输、App Server 子进程生命周期三层；根 CLI 只解析基础命令并装配 Provider。所有进程测试通过独立 Fake App Server 可执行 fixture 完成，不依赖真实账号。

**Tech Stack:** TypeScript ESM、Node.js 24 子进程与流 API、Vitest 4、pnpm Workspace、Codex App Server JSONL 协议。

## Global Constraints

- 保持 `provider-codex` 只依赖允许的 Node.js、Core、Protocol 和固定 `@openai/codex` 生产依赖。
- 使用参数数组、`shell: false`、`stdio://` 和 `--strict-config` 启动长驻 App Server。
- 所有外部 JSONL 数据先按 `unknown` 校验，禁止 `any` 和任意 RPC 透传到上层。
- 所有 RPC 都必须有超时；协议失败、进程退出和显式关闭必须 Reject 全部 Pending RPC。
- 在关键协议分帧、进程竞态和关闭顺序处添加简短清晰的中文注释。
- 不引入旧实现兼容分支，不实现阶段二的 Fastify、HTTP/WebSocket 或领域事件映射。

### Task 1: Codex Binary 定位与版本门禁

- [x] **Task Status:** completed

**Files:**

- Create: `packages/provider-codex/src/binary.ts`
- Create: `packages/provider-codex/src/binary.test.ts`
- Modify: `packages/provider-codex/src/index.ts`
- Modify: `packages/provider-codex/package.json`

**Interfaces:**

- Consumes: `@openai/codex` package binary contract
- Produces: `CodexBinary`
- Produces: `locateCodexBinary(options?: LocateCodexBinaryOptions): Promise<CodexBinary>`
- Produces: `checkCodexVersion(binaryPath: string): Promise<CodexVersionInfo>`

**Behavior Slice:**

按 `explicit option -> CODE_AGENT_CODEX_BIN -> bundled @openai/codex -> PATH` 定位可执行文件；包内版本直接解析平台可选依赖中的原生 `codex`/`codex.exe`，避免额外 launcher 进程；执行 `--version`，解析 `codex-cli <semver>`，并拒绝非固定支持版本 `0.145.0`、不可执行路径、非零退出或非法输出。

**Proof:**

使用临时可执行 fixture 覆盖显式路径优先级、环境变量、PATH、版本成功和版本不兼容，并验证默认包内路径落到当前平台的原生可执行文件。

**Verification:**

Run: `pnpm exec vitest run packages/provider-codex/src/binary.test.ts`

Expected: 测试全部通过，且不调用真实账号或 App Server。

**Stop Conditions:**

- 固定 `@openai/codex` 包不再暴露可解析的 `bin/codex.js` 时停止并修订 Binary 定位契约。
- 实际 `codex --version` 输出不包含可确定的 SemVer 时停止并修订版本解析规则。

### Task 2: JSONL/RPC Client

- [x] **Task Status:** completed

**Files:**

- Create: `packages/provider-codex/src/jsonl-rpc-client.ts`
- Create: `packages/provider-codex/src/jsonl-rpc-client.test.ts`
- Modify: `packages/provider-codex/src/index.ts`
- Modify: `packages/provider-codex/tsconfig.json`

**Interfaces:**

- Consumes: `node:stream Readable/Writable contract`
- Produces: `JsonlRpcClient`
- Produces: `RpcConnectionClosedError`
- Produces: `RpcProtocolError`
- Produces: `RpcResponseError`
- Produces: `RpcTimeoutError`
- Produces: `RpcServerRequest`

**Behavior Slice:**

实现跨 chunk JSONL 分帧、请求 ID 关联、通知发送与订阅、服务端请求订阅与同 ID 响应、逐请求超时、RPC error 转换、非法 JSONL 终止连接，以及幂等关闭时统一 Reject Pending RPC。

**Proof:**

使用内存流验证分片与同 chunk 多行响应、乱序关联、超时、RPC error、非法 JSONL、通知、服务端请求响应和重复关闭。

**Verification:**

Run: `pnpm exec vitest run packages/provider-codex/src/jsonl-rpc-client.test.ts`

Expected: JSONL/RPC 单元测试全部通过且无未处理 Promise rejection。

**Stop Conditions:**

- 固定 Codex 协议改为包含 `jsonrpc` 强制字段或非 JSONL stdio 帧时停止并修订消息校验契约。
- Node.js 流错误无法通过当前 Reader/Writer 生命周期统一收敛时停止并拆分传输适配层。

### Task 3: App Server 进程与 Fake 契约测试

- [x] **Task Status:** completed

**Files:**

- Create: `packages/provider-codex/src/app-server-process.ts`
- Create: `packages/provider-codex/src/app-server-process.test.ts`
- Create: `packages/provider-codex/test/fixtures/fake-app-server.mjs`
- Modify: `packages/provider-codex/src/index.ts`

**Interfaces:**

- Consumes: `CodexBinary`
- Consumes: `checkCodexVersion(binaryPath: string): Promise<CodexVersionInfo>`
- Consumes: `JsonlRpcClient`
- Produces: `CodexAppServerProcess`
- Produces: `startCodexAppServer(options?: StartCodexAppServerOptions): Promise<CodexAppServerProcess>`

**Behavior Slice:**

以固定参数启动长驻子进程，完成单次 `initialize` 请求和 `initialized` 通知；处理启动错误、stderr 摘要、非法 JSONL、异常退出、Pending RPC Reject，并通过关闭 stdin、等待与超时终止实现幂等关闭。

**Proof:**

Fake App Server 校验真实 argv 和握手顺序，并覆盖正常启动与响应、RPC 超时、非法 JSONL、异常退出、Pending RPC Reject 和重复关闭。

**Verification:**

Run: `pnpm exec vitest run packages/provider-codex/src/app-server-process.test.ts`

Expected: 所有 Fake App Server 契约场景通过，测试结束后没有残留子进程。

**Stop Conditions:**

- `initialize` 的稳定字段或 `initialized` 通知顺序与固定 Codex 版本实际协议不一致时停止并以生成 Schema 修订握手。
- Fake App Server 无法可靠检测残留进程时停止并增加显式 PID/退出确认协议。

### Task 4: `code-agent` 基础命令装配

- [x] **Task Status:** completed

**Files:**

- Create: `src/cli-command.ts`
- Create: `src/cli-command.test.ts`
- Modify: `src/cli.ts`
- Modify: `README.md`
- Modify: `tsconfig.node.json`
- Modify: `tsup.config.ts`
- Modify: `vitest.config.ts`

**Interfaces:**

- Consumes: `locateCodexBinary(options?: LocateCodexBinaryOptions): Promise<CodexBinary>`
- Consumes: `startCodexAppServer(options?: StartCodexAppServerOptions): Promise<CodexAppServerProcess>`
- Produces: `runCli(argv: readonly string[], options?: RunCliOptions): Promise<number>`

**Behavior Slice:**

实现 `version`、`doctor`、`start` 和基础帮助/错误退出码；`doctor` 检查 Node.js 与 Codex Binary/版本，`start` 传入 Project/CODEX_HOME 配置并在 `SIGINT` 或 `SIGTERM` 后走同一幂等关闭路径。

**Proof:**

通过依赖注入测试命令解析、输出、失败退出码、Start 装配和 AbortSignal 关闭，不启动真实 Codex 账号会话。

**Verification:**

Run: `pnpm exec vitest run src/cli-command.test.ts`

Expected: CLI 基础命令测试全部通过，`version` 与包版本一致，错误参数返回非零退出码。

**Stop Conditions:**

- `start` 被要求在本阶段同时提供尚不存在的 Fastify/Web 服务时停止并新建阶段二计划。
- CLI 发布 bundle 无法从根包稳定注入应用版本时停止并调整构建时版本注入方式。
