# Codex 执行适配器

## 位置与职责

`packages/provider-codex/src` 实现 Core 端口，维护 App Server 生命周期、JSONL / RPC、事件映射、会话和模型目录。关键入口为 `app-server-process.ts`、`codex-rpc-client.ts`、`agent-provider.ts`；见 [包说明](../../../../packages/provider-codex/README.md)。

## 契约与检查项

- [ ] 不依赖 Server、Client 或 Web UI；上游协议保持在适配边界映射，不向公共 Protocol 泄漏专有编排。
- [ ] 本地上游源码路径读取根 `.local/project-paths.json` 的 `codexSource`；未配置时使用官方仓库，不提交个人路径。
- [ ] 进程、RPC、审批、取消与会话恢复沿用现有生命周期，队列、历史及事件缓冲保持有界。
- [ ] 模型目录与思考档位以 [模型能力契约](../../../../docs/model-discovery.md) 为准，保持账号 / 端点隔离及明确回退，不额外启动逐模型轮询。
- [ ] 执行 `pnpm exec vitest run packages/provider-codex/src`、`pnpm codex:schema:check`、`pnpm typecheck`；契约变化同时核对桌面原生适配和 Server。

能力差异与原生配置见 [智能体引擎参考](../../../../docs/agent-engines.md)。

## 线程空闲卸载

- Codex 0.164+ 使用线程级 `thread_unload_delay_secs`。普通会话创建、恢复、分叉及本地目录延迟物化均设置 300 秒热缓存；标题、提交说明等辅助线程设置 0 秒，完成或中断并退订后立即释放。
- 沿用上游卸载调度，不新增轮询或周期定时器，不写全局配置；运行回合、提交租约、排队消息及后台终端继续阻止退订。两端恢复会话时重新建立订阅，磁盘历史不受影响。
- Web 回归为 `agent-provider-lifecycle.test.ts`、`agent-provider-ownership.test.ts`、`agent-provider-background-lifecycle.test.ts`、`task-title-generation.test.ts` 与 Server 的 `app-submissions.test.ts`；桌面覆盖 `conversation_command_tests.rs`、`task_title_tests.rs`、`tasks_tests.rs` 和 `commit_message.rs`。用户语义见 [会话加载与性能](../../../../docs/conversation-performance.md)。

## 生成图片的持久引用

- `imageGeneration` 同时含 `fileId` 与旧 `result` 时采用文件引用语义；Worker 不解码或暂存旧正文。优先读取有效 `savedPath`，仅有引用且无可读取正文的完成项显示 `[图片]`，运行中或失败项保留工具状态。
- 引用不得解释成本地路径或猜测远程下载地址；`inputImages` 的路径、摘要和内部 fileId 不进入公开消息。图片附件继续由任务授权和既有容量限制管理。
- 回归入口为 `codex-164-contract.test.ts`，原生消费端对应 `desktop/src-tauri/src/infrastructure/codex/codex_164_contract_tests.rs`；升级依据见 [0.164.0 升级评估](../../../../docs/codex-0.164.0-upgrade.md)。
