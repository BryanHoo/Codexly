# 后端开发规范

## 范围

适用于根目录 `src`、`packages/core`、`packages/provider-codex` 和 `packages/server`。

## 规范索引

| 文档                                     | 内容                             |
| ---------------------------------------- | -------------------------------- |
| [目录结构](./directory-structure.md)     | CLI、领域、Provider 和交付层职责 |
| [运行时生命周期](./runtime-lifecycle.md) | 进程、Server、Worker 和连接清理  |
| [质量规范](./quality-guidelines.md)      | 测试、架构和发布检查             |

## 开发前检查

- 确认变更所属层，并沿 `protocol -> core -> provider/server -> client` 检查影响。
- 路由仅处理输入输出适配，领域规则留在 `packages/core`。
- 普通提交与评审通过 `/v1/projects/:projectId/submissions` 进入 `core.submitTask`；临时任务公开路由为 `/v1/temporary/submissions`，不得遗漏临时作用域重写。
- CLI 必须注入 SQLite 提交记录：创建 Task 后、启动 Turn 前保存恢复阶段；Provider 调用结果不明时返回 `SUBMISSION_OUTCOME_UNKNOWN`，禁止自动重复执行。成功后的资源清理仅重试收尾，保存实际解析后的附件 ID。完成记录至少保留七天，未确定结果不按 TTL 淘汰；同一 Server 内继续通过 `runIdempotent` 合并并发请求。
- 待办正文、版本及附件二进制在同一 SQLite 事务提交；保存和删除必须比较 `expectedVersion`，拒绝跨设备过期编辑。附件恢复与预览只能读取同项目资源，不能依赖进程内附件 TTL。覆盖重启、并发版本冲突、删除级联和持久附件再次提交。
- 定时任务五个写接口必须校验 `Idempotency-Key` 并复用 `runIdempotent`，按操作及任务隔离作用域，在 runner 内映射业务错误；覆盖并发、结果复用及参数冲突。幂等缓存仅限当前 Server 实例，重启不保留，具体边界见[幂等约定](../../../docs/scheduled-task-idempotency.md)。
- 定时任务预览和实际执行共用调度计算，显式转换任务时区；`COUNT` 从原始起点累计且跳过不存在的夏令时时间，`UNTIL` 按绝对时间判断。无次数限制的高频规则按完整周期跳过历史，预览只返回最多五次，不生成无限结果集。
- 数据库和 Codex 进程生命周期必须有明确启动、失败和清理路径。
- 非阻塞异步问题通过 `async-questions` 查询、回答与关闭接口管理，CLI 必须注入 SQLite 状态仓库。稳定身份使用回合、问题内容及同内容出现次序，不依赖原生消息 ID；历史发现只补充记录，不能重置已回答或关闭状态。后端按当前回合选择 start/steer，原子占用后才调用 Provider；结果不明保留占用并禁止重发，成功结果在重启后可复用。待回答列表只返回仍在运行的所属 Turn，完成或中断后不得继续展示或因刷新复活。任务快照必须用持久结果补回 Provider 历史缺失的 steer 用户回答，Provider 已包含同一回答时不得重复。覆盖历史分页、跨项目校验、跨实例竞争、终态隐藏、快照刷新与重启。
- `turn/start` 在调用 Provider 前捕获事件 checkpoint，并将 checkpoint 与 Turn 作为同一幂等结果返回。
- 归档 Task 恢复不得预读 Goal 或历史快照；由 Provider 在 `thread/unarchive` 边界校验归属并返回恢复后的 Task。
- Codex standalone Task 仅以 `projectId: null` 归属；创建、列表、恢复和 Fork 不得使用 cwd 过滤或合成工作区覆盖原生运行时上下文。
- Project 列表继续按 Codex `position` 恢复用户手动顺序；仅校验 `recencyAt` 协议字段，不请求其排序语义。
- 宠物目录发现、清单校验和资产下载由 Provider 负责；Server 仅暴露 `/v1/pets`、资产交付和全局设置持久化。
- 自定义 Provider 同地址重连必须保留当前 `model_provider`，优先复用已持久化模型目录，目录缺失时从当前运行时恢复，禁止无 API Key 请求 HTTP `/models`；模型读取时以运行时目录更新同 ID 元数据并补入新模型，以持久化目录补齐手动模型，运行时读取失败则回退持久化目录；仅首次配置时创建默认 `OpenAI` Provider。

- HTTP 日志由请求完成阶段统一输出：正常读取与健康检查静默，写操作记录 info，业务拒绝与超过 3 秒的普通请求记录 warn，服务端和响应传输失败记录 error。WebSocket 不按存续时长告警。同一异常不在错误处理器重复输出；保留请求 ID、路由模板、状态码、耗时及项目/任务/回合 ID，不记录正文、原始 URL 或上游异常内容。
