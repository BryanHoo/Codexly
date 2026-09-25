# 全局搜索

点击侧栏搜索按钮或按 `Cmd+F`（Windows/Linux 为 `Ctrl+F`）打开聚合搜索弹窗。默认检索所有项目和临时任务，可按任务、历史记录、项目文件分类查看；勾选“已归档任务”切换至归档任务范围。

## 数据源与交互

| 数据源 | 实现 | 点击结果 |
| --- | --- | --- |
| 任务标题 | Codex `thread/list`，传入 `searchTerm`，不设置项目或固定分区过滤 | 打开对应任务 |
| 历史记录 | Codex `thread/search` 提供候选；展示前用 `thread/searchOccurrences(limit=1)` 校验并附带消息 ID、回合游标和 UTF-16 命中范围 | 默认定位首个命中；选中历史结果后可查看其他匹配位置 |
| 项目文件 | 复用 Rust `ProjectFileSearch`，搜索各项目根目录内的文件名和相对路径 | 文本/图片内部预览，其他格式或预览读取失败时使用系统默认应用 |

文件检索不扫描源码正文。历史检索以 Codex 定义的可见用户消息和助手最终答复为准，不搜索内部推理或工具输出。精确历史定位使用 0.156.0 的分页历史协议；服务端拒绝定位或消息已删除时保留搜索结果并提示错误，不把任务首页伪装成命中位置。

## 性能与一致性

- 弹窗和历史定位视图按需加载，关闭时没有搜索轮询。关闭时保留当前窗口的搜索词、分类、分页、结果与滚动位置；再次打开聚焦并全选输入内容，不因缓存过期重新搜索。关闭期间取消请求，保留当前结果的 Query observer；不写入磁盘，重启窗口后清空。
- 输入防抖 180ms，中文输入法组合期间不发送查询；查询词变化立即切换 Query key，使旧响应不能覆盖新结果。
- 任务、历史、文件源独立加载与报错；任务每页 30 条；历史每页最多校验 30 个候选、并发上限 4，过滤后保留原始下一页游标，使用游标翻页，不全量展开任务或会话。
- 文件请求最多并发两个根目录，复用现有 Rust 索引缓存、扫描信号量和取消机制；前端最多保留 50 条文件结果并明确提示截断。
- 原生任务请求接入 `AbortSignal` → `cancel_native_request`；文件请求使用独立 session ID，避免取消旧查询误伤新查询。客户端取消不承诺中断官方服务端已经开始的内部磁盘操作。
- 历史跳转通过命中位置的 inclusive `turnCursor` 读取一页，用独立只读 Store 展示。禁止将这页覆盖进实时 Task Store，避免覆盖正在运行的回合或破坏最新历史分页游标。
- 复用虚拟列表定位接口；命中消息拥有稳定锚点，整条消息高亮，同时通过 CSS Custom Highlight 标记可见关键词。未支持该 API 的 WebView 仍保留消息级高亮与准确摘要。
- 预览预检与正式预览共用 Query 缓存，只读取首个受限源码页面。路径授权和系统打开仍经过现有 Rust 命令。

## 定位一致性与视觉

官方 `thread/search` 扫描 rollout 中的用户/助手文本，包含过程答复；`thread/searchOccurrences` 只搜索当前可见用户消息和回合最终答复。两者范围不同，不能把前者的每个候选直接视为可定位消息。本地真实协议抽查 10 个候选时，4 个没有 occurrence；其余 12 个抽查位置的回合和消息均存在。

现在在后端用有界并发验证候选，丢弃无锚点结果，并使用 occurrence 的摘要替换 rollout 摘要。点击复用已验证锚点，不再二次检索。快照投影确实改变消息身份时，仅在同回合完整摘要唯一匹配时重新绑定，禁止只凭关键词误跳。

输入框的焦点由圆角外壳绘制，内部不叠加全局直角 outline。关键词、摘要和正文共用品牌色浅底；历史消息采用低对比底色、留白和侧边细线，不增加外描边或改变消息尺寸。浅色与深色主题均使用现有设计变量。

## 方案依据

优先使用已有权威能力，比另建 SQLite/向量索引更适合本项目：无需复制全部历史、维护索引迁移和监视器，也不增加桌面端常驻内存。这里不将“最优”解释为脱离当前架构的普适性能结论；后续只有实测表明官方检索成为瓶颈时，再考虑独立持久化索引。

- [Codex 官方协议源码](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/thread.rs)：实施以仓库内 `schemas/codex-app-server/0.156.0/` 与本地 0.156.0 源码为准，而非浮动的 main 分支。
- [VS Code 社区项目的搜索架构实践](https://github.com/microsoft/vscode/wiki/Search-Issues)：将文件搜索交给原生搜索进程，保持忽略规则和文件系统边界。
- [TanStack Query 请求取消](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)：查询函数消费 `AbortSignal`。
- [WAI-ARIA Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) 与 [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)：弹窗焦点管理、组合框结果列表、方向键、Enter 和 Escape。

## 验证

- `pnpm check`：Web/Rust 类型、测试、构建与性能预算。
- `pnpm exec vitest run --config vitest.browser.config.ts src/features/search src/features/workbench/components/project-sidebar-header.browser.test.tsx`：Chromium/WebKit 弹窗聚合、键盘入口、源错误隔离、精确历史定位及高亮。
- `src-tauri/src/infrastructure/codex/search_tests.rs`：官方方法与参数、跨项目映射、查询边界、游标和 UTF-16 范围。
