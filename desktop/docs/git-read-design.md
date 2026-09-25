# Git 读取设计

本设计面向桌面端本地仓库。使用已安装的原生 Git CLI 执行仓库查询，Rust 负责解析、资源预算与错误分类，WebView 只消费有界结果。

## 选择依据

采用 Git 官方稳定机器协议，不引入第二套 Git 实现。GitHub Desktop 的状态读取使用 `--no-optional-locks status --branch --porcelain=2 -z`；VS Code 同样使用无可选锁的 NUL 状态读取，并限制结果量。原生 Git 可直接使用用户现有的仓库格式、worktree 与 index 扩展。

Git 官方明确指出不存在适用于所有仓库的统一最优性能配置。本项目选择：后台聚合未跟踪目录、分页传输清单、按文件请求 Diff、缓存文件指纹、限制正文与进程存活时间，不擅自写入用户仓库的 fsmonitor 或 untracked-cache 配置。

## 读取职责

| 模块 | 职责 |
|---|---|
| `git_process.rs`、`git_capture.rs` | Git 定位、宿主环境隔离、无可选锁查询、超时和有界输出 |
| `git_stream.rs`、`git_status_page.rs` | NUL 清单流式消费、分页、共享路径缓存及过期回收 |
| `git_repository.rs` | 候选仓库发现、Git 根目录解析及平台路径规范化 |
| `git_protocol.rs` | NUL 记录、字面量 pathspec、完整元数据读取与统一预算 |
| `git_stats.rs` | 流式 `numstat -z`，独立于正文的文件行数与全仓汇总 |
| `git_status_parse.rs` | `porcelain v2` 的分支、普通变更、重命名、冲突及子模块解析 |
| `git_read.rs` | 状态读取编排、快照身份与一次性竞态重读 |
| `git_history.rs` | 提交历史、提交文件清单和单文件历史 Diff |
| `git_snapshot.rs` | 工作区内容指纹缓存、目录展开、gitlink HEAD 和写入前严格校验 |
| `git_diff.rs`、`git_patch.rs` | 补丁与路径关联、符号链接预览、截断及 hunk 修复 |
| `git_commit_context.rs`、`git_index_selection.rs` | 有界提交上下文、标准输入传递路径及复制所选 index |

## 协议与一致性

- 状态固定使用 `porcelain v2 -z --branch --no-ahead-behind`，一次读取分支、HEAD、index 对象及变更清单。分支列表与状态命令并行执行。
- `.git` 只用于发现候选目录。实际根目录由 `rev-parse --show-toplevel` 解析并规范化，支持 gitfile 和 linked worktree。项目 Git 范围仍为仓库根目录或直接子仓库，最多 256 个候选。
- 机器输出中的路径从 NUL 记录读取；只拆固定数量的元数据字段，不按整行空白拆分文件名。Git 专用 Schema 接受目录尾斜杠、中文、换行以及本机合法特殊字符；Rust 仍拒绝绝对路径、NUL 和父目录穿越。
- 用户选择的文件一律转换为 `:(top,literal)` pathspec，防止 `[]`、`*`、`?` 或路径前缀被解释为选择表达式。
- 历史使用 NUL 分隔的固定五字段格式，保留空标题和正文控制字符。提交对象 ID 严格支持完整 SHA-1 或 SHA-256。
- 合并提交的文件清单和单文件 Diff 都按第一父提交比较。工作区冲突使用 `--base` 普通补丁，避免把 combined diff 交给普通补丁渲染器。
- 读取时禁用颜色、外部 diff、textconv、自定义路径前缀和相对路径输出。符号链接只读取链接文本，不展开目标。

## 输出边界

stdout 与 stderr 采用不同策略：stdout 只能保留连续前缀；stderr 可以保留首尾诊断。禁止将首尾拼接的 stdout 当作完整 Git 协议。

| 结果 | 预算及处理 |
|---|---|
| 状态、提交文件清单、快照路径、index 条目 | 流式消费 NUL 记录，不因清单超过 2 MiB 失败；单条记录最多 64 KiB |
| 状态 IPC | 每页最多 1,000 个 staged/unstaged 条目；游标绑定快照 |
| 历史提交文件 IPC | 每页最多 100 个文件，只保留当前页数据 |
| 分页缓存 | 单个仓库、估算最多 32 MiB、60 秒过期回收；同路径共用字符串 |
| 引用、提交历史、worktree 元数据 | 2 MiB，异常输出仍保留独立错误 |
| 单文件 Diff | 512 KiB；保留完整行，修复末尾 hunk 的行数 |
| 生成提交信息 | 512 KiB；仅展开所选目录并遵循 Git ignore 规则 |
| Git stderr | 64 KiB；保留有界原始错误 |
| 本地/网络 Git | 分别最多 30/120 秒 |

`truncated` 经 IPC 传入 Diff 面板，界面提示部分内容省略；单文件预览的统计只涵盖返回补丁。清单通过 `git diff --numstat -z` 分别统计暂存区和工作区，无需生成、传输全部补丁；每页携带完整仓库的 `stats`，文件统计也保存在分页缓存中，不能拿当前页的合计充当全仓总数。二进制 `-` 记为零文本行，rename 的旧/新路径按 NUL 记录解析，禁用外部 diff 和 textconv，并为 status、numstat 和预览统一 rename 策略及 1000 项昂贵配对限制，避免用户配置造成路径错配。

未跟踪内容在既有指纹扫描中同步计行并缓存，不重复读取正文；目录按 Git ignore 规则展开后聚合行数，符号链接只统计链接文本，默认二进制探测及末尾无换行均单独处理。提交面板、项目汇总和文件树使用这些元数据，只有统计未就绪时隐藏占位零值。正文仍按当前文件读取，统计就绪不意味着正文已加载。

状态命令的 `diffPath` / `diffStaged` 请求只读取所选路径；Git 工作区补丁最多两个并发读取。前端按项目、根、仓库、快照、区域及路径缓存，最多保留 16 个已完成文件结果，30 秒回收。快速切换时忽略旧响应，显示加载状态。

提交列表和目录树共用一个虚拟窗口，固定 28 px 行高、每侧预渲染 8 行；分组勾选仅影响已加载文件。更多条目由用户继续加载，同快照追加，游标过期返回的新快照替换旧页。读取失败保留已有页并可再次加载。

大批量提交不再限制 500 个路径。`add` / `reset` 使用 `--pathspec-from-file=- --pathspec-file-nul`；复制暂存条目采用流式 `ls-files` 与 `update-index -z --index-info`。不支持 stdin pathspec 的 Diff/目录查询按约 8 KiB 参数分批；生成信息仅列出前 128 项摘要并在 512 KiB 范围内补充正文。提交仍只包含所选路径，暂存版本与未暂存版本保持隔离。

## 快照与性能

状态输出中的 index 对象与模式直接纳入快照，不再额外执行一次 cached diff。普通根仓库的基础读取由仓库解析、状态及分支列表三个 Git 命令组成。

未跟踪目录只在 IPC 中聚合，快照仍通过 Git 列表覆盖其中可提交的文件，否则目录内同名文件改写无法使快照失效。gitlink 纳入子仓库 HEAD，防止连续两次子模块提交拥有相同快照。生成提交信息遇到未跟踪的嵌套仓库同样只读取其 HEAD，不把目录当文件打开。

指纹缓存最多 16,384 项，只保存元数据、摘要及行数，不保存正文；哈希最多两个并发任务，使用固定读取缓冲区并响应取消。后台复用未改变文件的摘要，写入前绕过缓存重读内容。首次读取大型变更集仍需扫描内容；状态扫描期间 Rust 会暂存全量路径元数据，瞬时内存和首次耗时仍随文件数增长。超出分页缓存预算时允许重新扫描继续原游标，不伪装为完整首页或报容量错误。内容扫描可以取消，不能将缓存命中结果当作冷启动性能，也不承诺任意体积仓库恒定耗时。

## 错误语义

- `INVALID_PATH`：输入路径本身不合法。
- `GIT_OUTPUT_INVALID`：某项 Git 输出结构不完整或协议无效，保留读取阶段。
- `GIT_OUTPUT_TOO_LARGE`：引用等非流式元数据超过预算；状态、路径清单不再使用旧的 `GIT_STATUS_TOO_LARGE`。
- `GIT_PATH_ENCODING_UNSUPPORTED`：路径不是 UTF-8；当前字符串 IPC 无法无损表示，要求重命名。
- `GIT_REPOSITORY_UNAVAILABLE`：仓库选择失效或不是受支持的工作区根。
- `SNAPSHOT_MISMATCH`：读取/写入校验期间内容改变。
- `GIT_COMMAND_FAILED`：保留原始 Git 错误，不伪装成空仓库或无变更。

界面按错误码本地化提示，诊断日志保留原始信息。读取快照遇到内容竞态最多自动重读一次，不自动重试写入操作。

## 验证

`pnpm check` 覆盖协议、类型、前端检查和 Rust 检查。Git 真实仓库回归覆盖：空提交标题、控制字符、特殊路径、冲突、目录内改写、子模块 HEAD、符号链接、无可选 index 写入、连续前缀截断与 hunk 行数。解析器额外覆盖 unborn、detached、SHA-256、扩展头和非 UTF-8 错误。

`pnpm performance:rust` 包含 `git_read_collapsed_directory`：2,000 个未跟踪文件，记录冷读、缓存命中的 P50/P95，以及聚合后的 IPC 字节数。

大清单基准使用 1 万、5 万、10 万个 Git index 路径，每条同时产生暂存新增与未暂存删除，覆盖超过 2 MiB 的真实状态输出。测量首页、后续页和 IPC 字节数；它不代表所有文件均包含大型文本补丁的耗时。另以独立测试验证：其他文件的多 MiB 补丁不会消耗所选文件预算，600 个暂存路径可以一次提交且保留未暂存删除。

统计回归覆盖分页缓存、全仓汇总、未跟踪目录及 ignore、二进制文件、空文件、特殊路径 rename、unborn 分支、符号链接和超过补丁预算的大文件。

前端在 Chromium/WebKit 验证：无正文时汇总与文件行数可见、万级目录树与列表仅挂载可见行、末尾文件可打开、打开面板不预加载补丁、分页追加与快照替换、审核迟到响应不会覆盖当前文件。

本机 macOS Release 测量（index 路径数，暂存与未暂存条目合计为两倍）：

| 路径数 | 首页 | 缓存后续页 | 单页 IPC |
|---|---:|---:|---:|
| 10,000 | 784.3 ms | 0.026 ms | 246,339 B |
| 50,000 | 5,535.2 ms | 0.042 ms | 246,340 B |
| 100,000 | 8,517.0 ms | 0.058 ms | 246,342 B |

本次首页包含完整 numstat 扫描成本，不能套用先前仅元数据读取的耗时；大型仓库首次刷新仍需要等待统计，Git 计算在原生异步子进程执行。后续页耗时为 Rust 分页函数测量，不包含 WebView IPC 和渲染。缓存压缩前，10 万路径因缓存容量不足而重新扫描，后续页约 1.77 秒；共用路径并移除空字段后，同样的 32 MiB 预算可容纳该样本。

最终验证：`pnpm check:web` 通过，119 个测试文件 / 412 项单元测试，Modern 与 Legacy 构建及性能预算通过；`pnpm check:rust` 通过，654 项 Rust 单元测试、6 项集成测试及 6 项 Release 性能基准。本次统计修复的相关浏览器回归在 Chromium/WebKit 共 16 项通过。

## 参考资料

查阅日期：2026-09-16。

- [Git status：porcelain v2、后台刷新、未跟踪文件性能](https://git-scm.com/docs/git-status)
- [Git rev-parse：仓库根与对象 ID](https://git-scm.com/docs/git-rev-parse)
- [Git diff：numstat、NUL 输出、pathspec、合并比较和补丁格式](https://git-scm.com/docs/git-diff)
- [Git config：status/diff 的重命名策略与配对限制](https://git-scm.com/docs/git-config)
- [Git pretty-formats：自定义字段与分隔符](https://git-scm.com/docs/pretty-formats)
- [Git 命令环境与可选锁](https://git-scm.com/docs/git)
- [GitHub Desktop 状态读取源码](https://github.com/desktop/desktop/blob/development/app/src/lib/git/status.ts)
- [VS Code Git 执行与状态读取源码](https://github.com/microsoft/vscode/blob/main/extensions/git/src/git.ts)

- [Git update-index：NUL 标准输入和 index-info](https://git-scm.com/docs/git-update-index)
- [Git add：pathspec-from-file](https://git-scm.com/docs/git-add)
- [Git reset：pathspec-from-file](https://git-scm.com/docs/git-reset)
