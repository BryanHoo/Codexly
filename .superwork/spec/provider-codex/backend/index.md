# Codex 集成

`packages/provider-codex/src/` 实现 `packages/core/src/agent-provider.ts` 所定义的 Provider 能力，并使用公共协议向服务端交付事件与结果。

- Codex 版本与协议基线以根目录 `package.json`、`schemas/codex-app-server/` 为准；升级时运行 `pnpm codex:schema:check`。
- Provider 层不引入 Web、HTTP 客户端或服务端交付逻辑；用相邻测试及 `pnpm lint:architecture` 验证。

- 模型目录以当前 Codex App Server 为权威来源；刷新失败直接传播错误，空目录保持为空，不从旧进程或持久化快照恢复已失效模型。保留有界 TTL 缓存及并发请求合并，不增加轮询；回归覆盖空目录、刷新失败与缓存复用。

- `plugin/reconcile` 仅合并同一 RPC 客户端的在途同步，完成或失败后释放；严格校验变化标记与失败列表，只投影公共字段，不增加周期性同步。

- 历史文件压缩通过无参数的 `rollout/compress` 提交给原生 worker；只返回 `scheduled`，不宣称完成、不修改自动压缩开关，也不添加后台轮询。冷文件筛选、写锁、跨进程维护锁与原子替换由 Codex 负责。
- Web 补充读取必须覆盖 `sessions` 和 `archived_sessions` 中的 `.jsonl` / `.jsonl.zst`，压缩、恢复或归档导致路径消失时重新发现。Zstd 使用 Node 原生流式解码，限制并发解码器、窗口、每次解压字节与行大小；保留分段游标，空闲和缓存淘汰时释放资源。
- 升级 Codex 或改动历史读取后，执行 `CODEXLY_REAL_RUNTIME_TEST=1 pnpm exec vitest run packages/provider-codex/src/history-storage-runtime.test.ts`，仅使用隔离的临时 `CODEX_HOME` 验证真实压缩、读取、搜索和恢复。`0.160.0` 的 `thread/searchOccurrences` 本地实现仍返回不支持，不能把线程搜索通过等同于精确命中搜索可用。
