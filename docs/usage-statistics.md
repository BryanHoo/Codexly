# 用量统计

在 **设置 → 用量统计** 查看 Codex 与 Claude 的实际 Token 用量。Web、移动浏览器与桌面共用页面；同一台主机上的 Web 和桌面共用 `~/.codexly/state.sqlite3`，不会因切换客户端重复累计。

## 页面

- 年度热力图：颜色表示当天已记录的总 Token 数，可切换年份和引擎。
- 总量、活跃天数与单日峰值采用等宽等高概览卡片；月度趋势与引擎占比保持统一边界与间距。
- 点击热力图或使用图内日期选择器查看当天任务，按用量展示前 50 项；有实际分类或已选日期时才展开明细区。
- 统计口径收在默认折叠的“统计说明”中。仅在引擎实际提供分类字段时展示明细；`—` 表示未提供，`≥` 表示只有部分活动提供了该分类。
- 日期统一按 UTC 归属，手机上的热力图可独立横向滚动，默认定位到最近日期。键盘可使用方向键、Home 和 End 浏览日期，Enter 选择。

统计反映应用观测到的实际新增用量，**不代表订阅剩余额度、费用或官方账单**。功能不会扫描历史会话来回填旧记录。

## 数据口径

### Codex

消费 `thread/tokenUsage/updated` 的 `tokenUsage.total` 累计值，以原生会话 ID 持久化计数水位；首次使用 `total - last` 建立旧记录基线，随后只累计实际增长。重复、迟到的旧通知不重复计数。

优先使用实际返回的 `totalTokens`，只有输入与输出均存在时才允许将二者相加。Codex 的 `inputTokens` 包含 `cachedInputTokens`，展示输入明细时扣除已单列的缓存读取；输出已经包含推理 Token，不再另加一次。协议未返回缓存写入时不推测该值。

上下文指示器仍使用 `tokenUsage.last`，与累计消耗相互独立。

### Claude

优先消费 SDK `result.modelUsage` 的模型累计用量，它包含子代理及辅助模型调用。实际返回的普通输入、输出、缓存读取与写入互不重叠，可相加得到已报告总量；不会重复叠加 `result.usage`。提供方只返回 `usage` 时按回合 ID 幂等记录其实际字段。

SDK 可能在恢复会话时带回旧累计量。已有统计水位优先于首次基线；旧会话首次接入统计时，只归属本次可确认的字段，避免将以前的消耗错误计入今天。assistant 消息按原生消息 ID 去重；其输出占位值不能用来补算实际输出。进程异常终止且未返回可靠结果时不估算缺失用量。

## 性能与持久化

采集仅处理结构化用量及结果边界；正文 Token 增量不产生统计存储调用。Web 在既有 SQLite Worker 中执行短事务；桌面使用有界 FIFO 队列和 Tokio 阻塞池，流式投递不等待统计写盘。同步和异步存储错误均与任务执行隔离。

两端执行同一份 SQL：计数水位更新与日汇总在同一事务中提交；上游后来补充的分类先建立水位，只记录此后可确认的增量，不将旧分类回填到今天；计数未变化的重复通知不修改数据库，不增加 WAL 帧。统计表不外键级联到任务，删除任务不会抹除已消耗的用量。统计不保存提示词、模型输出、密钥或账单。

页面只读取有日期索引的年度汇总与有界任务明细，不启动引擎，不扫描聊天正文，不新增 WebSocket 或轮询。年度汇总按年份共用缓存，引擎标签在本地即时筛选最多 732 条日汇总，首次切换也不新增年度请求或重挂统计区域；当天前 50 项任务仍按所选引擎查询，避免先截断再筛选而漏项。组件、样式及响应校验器按需加载，年度数据缓存 30 秒、闲置查询缓存保留 5 分钟，可手动刷新。

## 接口与验证

- Web：`GET /v1/usage?year=2026&engine=codex&day=2026-10-22`，`engine` 和 `day` 可省略。复用访问控制，年份限制为 2000–9999，响应不允许 HTTP 缓存。
- 桌面：`get_token_usage`，主窗口 ACL 授权，不依赖 Codex 运行时。
- 共用协议及 SQL：`packages/protocol/src/token-usage.ts`、`token-usage-sql.json`。
- 回归：`usage-statistics.test.ts`、`token-usage.test.ts`、`token-usage-routes.test.ts`、`usage-statistics-model.test.ts` 以及 Rust `local_catalog::token_usage`。
- 性能回归：`token-usage.performance.test.ts` 验证十万条正文增量没有统计存储调用；WAL 用例验证重复通知不写盘。

## 官方依据

- [OpenAI Codex App Server](https://developers.openai.com/codex/app-server)：使用官方用量通知，字段以仓库锁定的协议版本及本地官方源码为准。
- [Claude Agent SDK 用量跟踪](https://code.claude.com/docs/en/agent-sdk/cost-tracking)：区分主循环用量与全树累计模型用量、恢复会话及并行消息去重。
- [GitHub 贡献日历](https://docs.github.com/en/account-and-profile/concepts/contributions-on-your-profile)：年度日历热力图及 UTC 日期参考。
