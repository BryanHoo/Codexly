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
- 定时任务五个写接口必须校验 `Idempotency-Key` 并复用 `runIdempotent`，按操作及任务隔离作用域，在 runner 内映射业务错误；覆盖并发、结果复用及参数冲突。幂等缓存仅限当前 Server 实例，重启不保留，具体边界见[幂等约定](../../../docs/scheduled-task-idempotency.md)。
- 定时任务预览和实际执行共用调度计算，显式转换任务时区；`COUNT` 从原始起点累计且跳过不存在的夏令时时间，`UNTIL` 按绝对时间判断。无次数限制的高频规则按完整周期跳过历史，预览只返回最多五次，不生成无限结果集。
- 数据库和 Codex 进程生命周期必须有明确启动、失败和清理路径。
- `turn/start` 在调用 Provider 前捕获事件 checkpoint，并将 checkpoint 与 Turn 作为同一幂等结果返回。
- 归档 Task 恢复不得预读 Goal 或历史快照；由 Provider 在 `thread/unarchive` 边界校验归属并返回恢复后的 Task。
- Codex standalone Task 仅以 `projectId: null` 归属；创建、列表、恢复和 Fork 不得使用 cwd 过滤或合成工作区覆盖原生运行时上下文。
- Project 列表继续按 Codex `position` 恢复用户手动顺序；仅校验 `recencyAt` 协议字段，不请求其排序语义。
- 宠物目录发现、清单校验和资产下载由 Provider 负责；Server 仅暴露 `/v1/pets`、资产交付和全局设置持久化。
- 自定义 Provider 同地址重连必须保留当前 `model_provider`，优先复用已持久化模型目录，目录缺失时从当前运行时恢复，禁止无 API Key 请求 HTTP `/models`；仅首次配置时创建默认 `OpenAI` Provider。
