# Feature Implementation Plan

**Goal:** 将共享 ACP 可重放历史改为总量受限的闲置缓存，保留无法重放的兼容历史及应用独有附件。

**Suggested Spec Reads:**

- `.superwork/spec/core/shared/index.md` — ACP 生产存储与恢复契约。
- `.superwork/spec/guides/cross-layer-thinking-guide.md` — 跨端存储与事件边界。
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 有界 I/O 与跨平台锁。

**Architecture:** 在 AcpHistory 旁增加共享缓存管理器，记录实际协商的 loadSession 能力。默认 256 MiB 闲置正文缓存，按最近访问淘汰；活动使用以 SQLite owner CAS 租约保护，无法重放或未知能力的数据不淘汰。任务读取/运行持有保护直到退订或关闭，释放时回收。重放保留一份旧代际供近期游标续读，不再保留七份；重建仍逐回合背压落盘。正文淘汰不删除任务或用户独有附件，新生成的回答续文和工具详情附件计入缓存预算；缓存缺失时强制 load 而不是跳过已绑定会话。当前使用中的临时正文和兼容存储不计入可淘汰容量目标，释放后重新收敛。

**Tech Stack:** TypeScript、Node.js 文件系统、共享 ACP SDK、Vitest、pnpm。

## Global Constraints

- Web/移动浏览器和桌面复用 packages/provider-acp，不新增平台专属存储路径。
- 仅实际握手确认 loadSession 的历史可淘汰；未知旧数据保守保留。
- 活动回合、分页读取和导出期间不得淘汰；不删除应用独有附件和原厂会话。
- 关键逻辑添加中文注释；缓存维护不扫描正文、不逐 Token 执行。

### Task 1: 实现受保护的缓存回收与代际预算

**Files:**

- Create: `packages/provider-acp/src/history-cache.ts`
- Create: `packages/provider-acp/src/history-cache.test.ts`
- Modify: `packages/provider-acp/src/history.ts`
- Modify: `packages/provider-acp/src/history.test.ts`

**Interfaces:**

- Consumes: `AcpStorageLeases`、AcpHistory 任务哈希目录。
- Produces: `AcpHistoryCache.acquire/setReplayable/prune`，容量与 LRU 回收。

**Behavior:**

- 超额优先淘汰最旧可重放闲置正文；跨实例占用、未知能力、兼容历史和附件保留。回收失败不得伪装成成功或删除其他文件。
- 重放只保留当前及一份旧代际，旧游标明确失效。

**Stop Conditions:**

- 若无法基于现有 owner CAS 排除活动会话，先修订保护设计。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-acp/src/history-cache.test.ts packages/provider-acp/src/history.test.ts`

Expected: 容量、LRU、跨实例保护、附件隔离、旧代际测试通过。

### Task 2: 接入读取、运行、冷搜索与退出生命周期

**Files:**

- Modify: `packages/provider-acp/src/provider.ts`
- Modify: `packages/provider-acp/src/session-loading.ts`
- Modify: `packages/provider-acp/src/runtime.ts`
- Modify: `packages/provider-acp/src/host.ts`
- Create: `src/acp-history-cache.test.ts`
- Create: `packages/provider-acp/src/provider-history-cache.test.ts`
- Create: `packages/provider-acp/src/history-use.ts`
- Modify: `packages/provider-acp/src/replay.ts`

**Interfaces:**

- Consumes: `AcpHistoryCache`、`loadAcpSession`、`AcpAgentProvider`。
- Produces: 可淘汰历史的按需重放、能力登记及持有/释放边界。

**Behavior:**

- 读取、执行前持有缓存保护；握手登记能力；退订/关闭释放并回收，冷搜索在读取及匹配完成前保持保护。缓存被淘汰后已绑定会话也能重新 load；运行中不重放覆盖。

**Stop Conditions:**

- 若需要更改公开传输协议才能满足生命周期，先修订计划。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-acp/src`

Expected: ACP 全部单元测试通过，包括缓存淘汰后恢复和仅 resume 的兼容路径。

### Task 3: 更新存储契约并验证两端宿主

**Files:**

- Modify: `docs/agent-engines.md`
- Modify: `docs/conversation-performance.md`
- Modify: `.superwork/spec/core/shared/index.md`

**Interfaces:**

- Consumes: 共享缓存实现与现有 Web/桌面 ACP 宿主。
- Produces: 缓存容量、兼容历史及冷重放行为的长期说明。

**Behavior:**

- 文档区分闲置缓存目标、活动临时正文、不可重放历史和独有附件；记录类型/架构/集成及编译宿主验证证据。

**Stop Conditions:**

- 两端共享宿主行为不一致或必需验证失败时不宣称完成。

- [x] **Task Status:** completed

Run: `pnpm typecheck && pnpm lint:architecture && pnpm test:acp-host`

Expected: 类型、架构及共享编译宿主验证成功。

## Execution Evidence

- Task 1 RED：新增缓存测试因缺少缓存实现失败；GREEN：缓存、分页、Provider 定向测试 18/18 通过。
- Task 2 RED：未登记能力与暖绑定跳过重放导致 2 条恢复测试失败；GREEN：共享 ACP 单元 267 条通过，7 条可选真实账号/Agent 测试跳过。宿主关闭回归通过；新增断开标志复用 PID 死亡恢复协议。
- SQLite / CLI 验证：`pnpm exec vitest run src/acp-history-cache.test.ts src/cli-acp-integration.test.ts src/acp-storage-lease.test.ts`，3 文件 8 条通过；覆盖两连接保护、写入竞争、回收后重建。
- 维护范围新增 host.ts 与根 SQLite 回归，已更新协作登记；不改变公开 HTTP/IPC/数据库 Schema。

- 补充行为切片：新生成的回答续文/工具详情从用户附件仓储拆出，纳入正文缓存尺寸及回收。RED：`cache.content is not a function`；GREEN：缓存/超长正文/重放 18 条通过。旧版混合附件不猜测来源、不自动删除。
- 简化结果 changed：将 Provider 使用租约归入 history-use.ts，将会话换绑 CAS 校验归回 session-loading.ts，保持 Provider 在 500 行门槛以内；后续重新执行 ACP 定向和编译宿主验证。
- 桌面完整 `check:web` 的既有阻断：HEAD 中未修改的 `src-tauri/src/infrastructure/local_catalog/mod.rs` 已有 512 行，超过 500 行。单独执行桌面 typecheck 与 Tauri 契约测试通过（68 条，2 条 Windows 条件跳过）。无 Rust/UI 修改，本次不进行跨平台真机或模型付费验证。

## Final Verification

执行目录均为本 worktree。最终代码编辑后：

- `pnpm exec vitest run packages/provider-acp/src src/acp-history-cache.test.ts src/cli-acp-integration.test.ts src/acp-storage-lease.test.ts src/acp-session-recovery.test.ts`：56 文件通过、285 条通过、7 条可选真实运行时测试跳过，退出 0。
- `pnpm test:acp-host`：重新编译当前 sidecar，12/12 通过，退出 0。
- `pnpm typecheck && pnpm lint && pnpm lint:architecture && pnpm format:check`：全部通过，退出 0；Provider 499 行，未放宽 500 行门槛。
- `pnpm build:node && pnpm package:check`：通过，退出 0。此前完整 `pnpm build` 和 Web `pnpm bundle:check` 通过；其后未修改 Web 输入，仅重新构建 Node 产物。
- 复用完整 `pnpm test` 的无关包证据：804 文件、4555 条通过，22 条条件跳过；后续仅 ACP 代码变化，以最终上述 ACP/根集成范围重新验证被影响的模块。
- 复用 `pnpm test:performance`：8 文件 16 条通过；该套件没有消费新修改的 ACP 缓存实现，输入未变。
- 桌面 `pnpm --dir desktop typecheck && pnpm --dir desktop tauri:constraints:test`：退出 0，68 条契约通过、2 条 Windows 条件跳过。`check:web` 首步被 HEAD 已有的 local_catalog/mod.rs 512 行阻断；未改动此 Rust 文件，完整桌面门槛没有宣称通过。
- Spec decision：update。缓存预算、不可重放历史保护、衍生附件回收和进程死亡接管属于长期契约，已更新 core/shared 索引；分类脚本默认 no-update 被人工覆核。
- Simplification：changed，使用 history-use.ts 管理使用保护，session-loading.ts 管理会话换绑；最终定向、静态及宿主重新验证有效。
- 真实账号模型调用、Windows/Ubuntu 真机和桌面完整浏览器套件未执行；本次没有 UI、公开 HTTP/IPC 或数据库 Schema 变化。

共享交接：两端沿用同一路径与 owner CAS 协议。缓存缺失使用 Agent 原 sessionId 重放，不重发旧 prompt。256 MiB 是闲置可重放正文及新衍生附件的回收目标；活动会话、唯一历史、用户附件和旧混合附件另行保留。没有主动操作用户实际历史目录，所有回收测试在隔离临时目录完成。
