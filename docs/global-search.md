# 全局搜索

Web（含移动端）与桌面端共用搜索契约，支持任务标题、可见历史和项目文件。

## 引擎与数据源

两端读取依赖向导的启用集合，传递 `engines=codex`、`claude` 或 `codex,claude`。单引擎不查询另一个引擎，双引擎按本地 `updatedAt DESC, id DESC` 综合搜索；旧客户端省略筛选时默认包含两种引擎。任务名称、固定与归档状态以应用目录为准，正文检索按持久化 provider 身份路由。

| 来源        | 实现                                                                | 定位                                       |
| ----------- | ------------------------------------------------------------------- | ------------------------------------------ |
| 标题        | 应用目录先按引擎、标题与归档状态过滤，再分页；不启动引擎            | 打开任务                                   |
| Codex 历史  | `thread/searchOccurrences`；仅 `-32601` 时回退可见消息分页匹配      | 官方 inclusive 游标                        |
| Claude 历史 | Web/桌面复用已有问题与最终答复摘要检索；不创建 SDK 会话或模型请求   | 原消息 ID、回合 ID 与摘要页 inclusive 游标 |
| 文件        | Web 使用 Node 扫描，桌面使用 Rust `ProjectFileSearch`，均独立于引擎 | 内部预览或系统打开                         |

Claude 官方文档公开会话列举与消息读取，未给出与 Codex 等价的全文检索接口；本项目因此检索应用的可见摘要。摘要仅负责展示，执行上下文始终由官方 SDK 管理。历史不检索推理、工具输出或过程答复，文件搜索不检索源码正文。

## 分页与故障

- 标题每页 30 条；历史每批最多检查 10 个本地候选，并发上限 4，候选仅取首个精确命中。无匹配的候选页自动继续读取，直到找到命中、出现部分故障或范围耗尽，不能把较早任务误报成无结果。
- 综合游标绑定查询、类别、归档与引擎集合；切换依赖重置弹窗分页和定位状态，Query key 同时包含引擎集合。
- 单引擎失败保留健康源命中，通过 `unavailableEngines` 返回失败源，界面提示部分结果加载失败；精确匹配保留错误，取消不能转成部分成功。
- 精确匹配每页最多 30 条。Claude 续查绑定任务、查询与摘要页，记录页内命中偏移；新回合到来不改变固定的续查位置。Codex 兼容路径与 Claude 共用 UTF-16 匹配范围及摘要截取函数。
- 跳转以 `summary: true` 读取 inclusive 页，使用独立只读 Store，禁止覆盖实时任务 Store。定位失败保留结果并报错，不把任务首页当作命中。
- 消息身份变化时，仅在同回合完整摘要唯一匹配后重新绑定，禁止只按关键词误跳。保留消息级高亮与现有虚拟列表定位，高亮不改变消息尺寸。

## 性能与取消

- 输入防抖 180ms，中文组合输入期间不查询；关闭弹窗取消请求并保留窗口内结果和滚动位置，不写磁盘、不轮询。
- Claude 只分页读取摘要，不读取工具正文或完整 transcript。旧格式按已有规则补建摘要，稳定读取不另建全文索引或监视器。
- HTTP 断连传播取消信号；桌面通过宿主 `cancelId` 在摘要页之间停止后续 I/O，不中断同宿主对话。有界队列饱和时取消帧为尽力交付，不承诺中断已开始的单次磁盘或官方内部操作。
- 文件搜索使用大小写不敏感的相对路径子串匹配，最多两个并发扫描、50 条结果；跳过符号链接、隐藏文件、生成目录和项目 `.gitignore`/`.ignore` 匹配项。
- 文件索引单根最多 16 MiB，总计最多 32 MiB/8 根，TTL 5 秒；超预算仍扫描目录尾部，只保留排序最前的 50 个命中。Web 定期释放 ignore 匹配缓存，不新增常驻监视器。
- 文件预览与系统打开复用既有根目录授权；前端明确提示文件结果截断。

## 官方依据

- [Codex App Server](https://developers.openai.com/codex/app-server)：结合固定的 0.163.0 协议与 `.local/project-paths.json` 指向的官方本地源码验证接口。
- [Claude 会话文档](https://code.claude.com/docs/en/agent-sdk/sessions)：会话列举、消息读取与持久化；本项目 SDK 固定为 0.3.300。
- [node-ignore](https://github.com/kaelzhang/node-ignore)：使用 Git ignore 语义处理项目忽略规则。
- [TanStack Query 请求取消](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)：查询函数消费 `AbortSignal`。

## 验证

- 根目录与桌面目录分别运行 `pnpm check`。
- `pnpm test:claude-host` 覆盖真实独立宿主重启后的搜索及定位，并断言搜索无新增模型请求。
- `src/cli-claude-start.test.ts` 覆盖真实 HTTP、SQLite、单/双引擎选择、Codex 离线与部分故障。
- `catalog-search.test.ts`、Claude `global-search.test.ts` 及 Rust `application/catalog_search.rs` 测试覆盖聚合、归属、取消和分页。
- 浏览器交互调试使用 Chrome DevTools MCP，通过 CDP 连接用户正在运行的 Chrome；自动测试不替代跨平台实机验收。
