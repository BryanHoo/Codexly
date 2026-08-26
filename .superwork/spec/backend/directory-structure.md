# 后端目录结构

## 包职责

- `src/cli.ts`：唯一公开 CLI 入口，只负责命令解析、配置装配和进程退出码。
- `packages/server`：Fastify 插件、HTTP/WebSocket、SQLite Project 投影和 Database Worker；不得生成 Project 身份或直接实现 Project Mutation。
- `packages/provider-codex`：Codex Binary 定位、App Server 子进程、JSONL/RPC、Codex 权威 Project Repository 和事件映射。
- `packages/core`：Provider 接口、领域状态机和用例；不得导入 Fastify、SQLite 或 Codex 实现。
- `packages/protocol`：Provider 无关的 Schema、类型和 API 版本。

## 规则

- Fastify 路由只做 Schema 校验、身份与 Project 校验、用例调用和响应映射。
- Core 分离 `ProjectRepository` 与 `ProjectProjectionStore`：前者由 `provider-codex` 实现并保证所有 Mutation 先写 Codex，后者由 `packages/server` 的 SQLite Adapter 实现且只接受完整 Codex Project 投影。Codexly 公共 `Project.id` 必须原样使用 Codex `projectId`，有序 `roots[]` 必须完整投影，首项是 primary folder。
- `packages/server/src/app.ts` 只装配 Fastify、共享资源、根级 Access Hook、错误处理和领域路由；HTTP/WebSocket 路由按 Access、Runtime、Project、Task、Turn、Event 领域放入 `routes/*-routes.ts` 插件。插件通过显式 `ServerRouteContext` 获取依赖，不自行关闭共享资源，也不引入字符串 Service Locator。
- `packages/provider-codex/src/agent-provider.ts` 只编排 RPC 与 Provider 生命周期；无状态的 Codex 协议转换放入纯映射模块，Task 运行状态、Pending Request 终态与定时器、Runtime Owner 分别由单一对象维护，禁止在 Provider 中复制同类 Map。
- Project Git 状态只通过固定端点暴露，不接受浏览器传入的命令或任意文件路径；浏览器必须显式提交 `rootPath`，Server 只允许 Project `roots[]` 的精确成员。默认只读取 Porcelain 文件状态并为每项返回空 `diff`，只有严格 `includeDiff=true` 才读取完整 Diff。读取当前分支、当前分支优先的去重本地分支候选和本地/远端基础分支候选，远端默认分支可解析时排在基础分支首位；分支候选使用有界 TTL 缓存，当前分支仍需每次读取并在分支 Mutation 后主动失效。分支候选缓存、Git Mutation 锁和状态缓存必须同时按 `projectId + rootPath` 隔离。根目录不是 Git 仓库时仅聚合其直属子目录中的 Git 仓库，以子目录名作为变更路径前缀并返回空分支上下文；都不是仓库时返回 `repositoryMode: "none"` 的稳定空状态，不得作为读取异常。
- Project Git 历史只通过固定的只读分页端点读取已配置根目录；根仓库不接受仓库参数，非根仓库只允许选择最新枚举出的直属 Git 子目录。历史命令固定以所选仓库当前 `HEAD` 为起点，不使用 `--all` 或接受其他分支名称；每次响应必须从同一仓库目录读取并返回该仓库可空的当前分支。响应返回有界子仓库 Tab 列表，每页固定最多 20 条提交和下一页游标，不跨子仓库混合记录，也不暴露宿主绝对路径。历史命令必须复用受控 `simple-git` Adapter，并使用固定参数数组与 NUL 字段分隔解析。
- Git 提交审核只接受历史响应中的 40 至 64 位十六进制 SHA、最新枚举的仓库和严格 Project 相对路径。提交文件每页最多返回 `100` 条；单文件 Diff 按选择读取，响应最多保留前 `512 KiB` UTF-8 内容并返回截断状态。文件清单与 Diff 命令必须使用固定参数数组、`--no-ext-diff`、`--no-textconv` 和 `--no-renames`，不得接受任意 revision、pathspec 或 Git 参数。
- Git 状态必须携带由分支、仓库模式、staged/unstaged 文件状态和文件活动元数据增量计算的稳定 `snapshot`，轻量与详细读取必须生成相同结果且不得为哈希序列化完整 Diff；固定 Git Mutation 只接受严格校验的结构化字段，不接受命令。Git 读取与分支命令统一通过受控 `simple-git` Adapter 执行，必须保留参数数组边界、硬超时、合并输出上限、危险 Git 环境变量过滤和 `GIT_OPTIONAL_LOCKS=0`；精确部分提交继续使用支持 stdin 与 literal pathspec 的专用执行器，但必须复用同一受控环境构造，只能额外设置提交所需的非交互变量。环境过滤回归测试必须覆盖 `GIT_CONFIG_COUNT`、`GIT_EXEC_PATH`、`GIT_EXTERNAL_DIFF`、`GIT_SSH_COMMAND` 和 `GIT_ASKPASS`。部分文件提交必须保留未选 staged/unstaged 变更；同一路径同时存在 staged 与 unstaged 变更时提交暂存版本并保留未暂存内容，只有 unstaged 变更的已选路径提交当前工作区版本。push 不使用 force、不自动创建 upstream，并将 commit 成功后的 push 失败作为部分成功结果返回。分支切换只允许根仓库模式、匹配当前 `snapshot` 且存在于最新本地分支候选中的精确名称，通过参数数组执行 `git switch --no-guess`；分支创建同样只允许根仓库模式和匹配当前 `snapshot`，必须先用 `git check-ref-format --branch` 校验不存在的精确名称，再通过参数数组执行 `git switch -c`。两种 Mutation 都返回重新读取的 Git 状态，不得接受远端引用、命令或自动猜测分支。提交、分支切换和分支创建共享 Project 级 Git Mutation 锁；聚合直属子仓库提交必须先选择最新枚举出的真实直属 Git 目录，并以所选仓库自己的相对路径和 `snapshot` 生成 message、提交与推送，不得跨仓库混合变更。
- 详细 Git Diff 读取必须用状态结果中的精确路径构造 literal pathspec。批量输出超过命令上限时必须递归拆分；单文件仍超限时只省略该文件 Diff，保留路径和变更类型，不能阻断状态读取或提交信息生成。
- Project 文件树只通过固定的只读端点读取已配置根目录；端点必须先把 `rootPath` 解析为 Project `roots[]` 的精确成员，再解析经过严格校验的相对目录。每次只返回该目录的直接子项，不提供绝对路径或文件系统透传。文件树不得使用任意层级的 `.gitignore` 隐藏文件或目录，并必须允许继续读取被规则匹配的目录；同时跳过符号链接、`.git` 与大型生成目录，并保留固定目录深度限制，不设置条目数量上限。Windows 目录枚举必须对报告为 link 的 reparse point 使用 `lstat` 二次分类，保留云盘实际目录并继续排除真实符号链接。
- Project 文件重命名与删除只通过固定 Mutation 端点操作已配置根目录内的非根相对路径；每次执行前必须重新解析根目录与目标父目录，拒绝绝对路径、越界、符号链接、特殊文件、非法名称和重名目标。目录删除允许递归删除其内容但不得跟随符号链接；响应与错误不得暴露宿主绝对路径。
- Project 文件搜索必须通过 `AgentRuntimeProvider.fileSearch` 使用 Codex `0.149.0` 原生 `fuzzyFileSearch/sessionStart|sessionUpdate|sessionStop`，禁止在 Server 中递归扫描 Project。浏览器为一次文件菜单生命周期持有稳定 `sessionId`，连续查询复用 App Server 的多线程索引，查询替换、Abort、菜单关闭、空闲超时和 Project 释放必须清理各自等待或原生会话。Server 继续验证 Project 根，并只对原生返回的最多 `50` 个候选执行有界普通文件、生成目录、符号链接和深度检查；每项携带稳定 `rootId`、绝对 `rootPath` 和根内相对 `path`。Composer 选择结果必须按 `rootId + path` 去重，并序列化为可见的宿主绝对 `@<path>` 文本随普通文本提交；文件夹不得进入引用入口，浏览器协议和 Provider 不建立结构化文件 `mention`。
- Project 目录选择与 Composer 宿主附件选择的目录响应必须携带可切换的文件系统根目录；Windows 必须稳定列出所有实际可访问盘符，使两个选择器均可跨盘浏览。Composer 宿主附件选择只通过固定的 `GET /v1/host-files` 浏览 Codexly 运行设备；端点从宿主主目录或严格校验的绝对目录开始，仅列出真实直接子目录和当前 `file | image` 种类支持的普通文件，跳过符号链接。确认选择后由 `POST /v1/projects/:projectId/attachments/:kind/host` 重新解析文件并流式写入统一 `AttachmentStore`，待提交预览只允许通过 `GET /v1/projects/:projectId/attachments/:attachmentId` 和随机附件 ID 读取，不能向 Web 或 Turn 透传宿主绝对路径，也不能建立第二套存储。
- `GET /v1/project-directories` 与 `GET /v1/host-files` 默认过滤名称以 `.` 开头的直接子项；只有严格布尔查询参数 `includeHidden=true` 才允许列出这些隐藏项。项目目录接口仍只列真实直接子目录，宿主文件接口不得放宽符号链接、普通文件、附件种类或绝对路径校验。
- Project 宿主打开能力只返回固定白名单中的具体应用 ID、名称与类别；普通打开菜单提交 Project 相对路径并拒绝符号链接和越界目标，AI 文件引用的显式绝对路径允许指向 Project 外的本机可读文件或目录。临时 Task 必须通过 `/v1/temporary/open-capabilities` 与 `/v1/temporary/open` 使用相同能力，不能暴露内部 Project。Server 按宿主实际可执行程序或应用包过滤目录，并使用参数数组和 `shell: false` 启动。文件交给编辑器或工具，文件管理器定位文件或打开其父目录，终端固定在文件父目录启动；`system-default` 只允许文件目标，并调用宿主系统的默认关联应用。
- Task 历史附件的读取与系统打开统一放在独立附件路由模块；系统打开必须先验证 Project、Task、随机附件 ID 和 `file` 类型，再把受权内容复制到 Server 管理的临时文件并复用 Project `system-default` 打开服务，不能向浏览器返回或记录该路径。
- Project 图片预览只允许 GIF、JPEG、PNG、WebP 的有效内容签名和有界普通文件；相对路径限制在 Project 内，显式绝对路径允许读取 Project 外目标。临时 Task 的流式消息文件引用必须通过 `/v1/temporary/files/source` 与 `/v1/temporary/files/image` 使用同一受控预览能力。响应固定使用受检媒体类型与 `nosniff`，路径缺失、不可读、超限或签名不匹配统一返回不可用。
- Core、Protocol 和 Server 公开使用 Project/Task；Codex 原生 Thread 命名只允许出现在 `provider-codex` 适配边界。
- 基础设施通过 Core 端口接入，不让同步 SQLite 或子进程细节进入领域层。
- 每个包只从 `src/index.ts` 暴露公共入口。
- 不提供任意 JSON-RPC、文件系统或命令执行透传接口。
