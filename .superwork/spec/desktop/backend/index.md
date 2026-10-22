# 桌面原生层

Windows 快捷打开 CMD 使用 `CREATE_NEW_CONSOLE` 和独立工作目录，不把路径拼接进 shell 命令；文件目标使用父目录。`cmd /K` 的 IPC 在进程创建后完成，不能等待交互会话退出。回归 Rust `workspace::open::` 的真实控制台探针，验证控制台隔离和带空格、中文、`&` 的目录；Web 对应 `project-open.test.ts`，保持有界启动确认。

项目根目录授权先匹配原始路径；不匹配时以文件系统 canonical 路径确认是否仍为已登记根目录，再验证 Git worktree。Windows 普通路径、斜杠、大小写和扩展路径前缀差异不得让非 Git 项目误入 worktree 分支；等价目录保留原 root ID，子目录和无关目录仍拒绝。回归运行 Rust `workspace_project_root` 测试，Web 对应 `project-root-scope.test.ts`。

`desktop/src-tauri/src/lib.rs` 注册 Tauri 命令与应用状态；`application/` 处理 IPC 与用例，`domain/` 放领域规则，`infrastructure/` 放持久化、Codex 和系统集成。

- 线程订阅释放前检查是否还有排队消息；终态后的短暂 idle 不代表队列已结束。有剩余队列则返回 busy，保留 Core 自动续发能力；检查只取首项并跳过正文、附件和技能映射。

- 新命令核对前端调用及输入输出类型，沿现有 `application/*_commands.rs` 和 `tauri::generate_handler!` 注册路径扩展；同时登记 `build.rs` 的 ACL 命令清单并在对应窗口权限集中显式授权。Git 远端检查、连接和推送共用 `push_project_commits`，仅授权主窗口；回归运行 `scripts/git-remote-acl.test.mjs`，验证构建清单与辅助窗口隔离。
- `scripts/tauri-acl.test.mjs` 全量对照命令处理函数、构建清单、手写权限、前端 IPC 调用与窗口授权；生产命令必须具备 ACL 定义和实际窗口授权，终端测试命令仅在 WebView 测试配置开放。目录创建和原生请求取消仅授权主窗口；独立文件窗口允许保存预览偏好、打开 HTTP/HTTPS 外链及关闭自身，不能继承 Git 写操作或任务控制权限。
- worktree 创建只登记 Git 工作树，不新增 Project；启动任务同时保留 `projectId` 并将 `cwd`、`runtimeWorkspaceRoots` 指向工作树。任务列表与快照返回 `workspacePath`，文件、Git 和终端访问必须校验工作树归属。
- 原生 `runtime_session_id()` 在进程内稳定、跨进程重启变化，Codex、Claude、快照、事件和 resync 控制包必须使用同一个标识。消息 `identityAliases` 只透出原生层已确认的关联（包括 Skill 展开归并），不得用正文或图片元数据推断普通消息身份；历史映射、完成事件、终态回合与应用快照保持一致。回归包含真实子进程身份测试 `runtime_session_tests` 和两端共享 `task-store-identity-contract.test.ts`。
- 数据存储、定时任务、诊断日志等修改检查相邻 Rust 测试；持续遵守 `desktop/AGENTS.md` 的性能约束。
- Windows 可信按键测试在发送前确认前台 PID；后台助手无法激活窗口时，仅点击已核验归属的可见测试窗口标题栏，并恢复临时置顶状态和光标位置。不得通过向其他窗口发送辅助按键来获取焦点，逐键校验仍须保留。回归使用 `tests/webview/terminal-ui.spec.ts` 的真实系统输入与原生关闭流程。
- 任务标题与 Web 端共用 `packages/provider-codex/src/task-title-instructions.json`，编译时嵌入。仅共用 Git 提交模型，不能共用提交提示词；辅助会话关闭项目文档加载，并使用专用基础指令与开发者指令防止全局 `AGENTS.md` 将标题变为提交格式。回归执行 Rust `task_title` 测试。
- 在 `desktop/` 执行 `pnpm check:rust`；完整门槛为 `pnpm check`。环境要求见 `desktop/docs/development.md`。
- ZIP 依赖须通过包含全部平台的 `cargo deny check advisories bans licenses sources`，不能只检查 Linux 编译图；更新插件的 Windows 可选依赖也在审计范围内。当前仅发布 Tauri v2 原生更新包，`tauri-plugin-updater` 关闭默认功能并显式保留 `rustls-tls`、`system-proxy`，不启用 Tauri v1 压缩更新兼容的 `zip` 功能。macOS `.app.tar.gz` 更新独立于该功能；升级 ZIP 后须验证技能安装的目录/符号链接约束与诊断归档读写。
- Codex 资源根目录为文件或不可读取时返回 `Failed`，不能因 Windows 将子路径查询归类为 `NotFound` 而误报 `Missing`；仅在二进制未找到的分支补查资源根目录，正常启动不增加文件系统读取。`runtime_manager_tests::startup_should_report_filesystem_failure_without_installing` 在 Windows 验证此边界。
- 外链启动的 `is-wsl` 依赖通过 `native/is-wsl` 本地适配，仅在 Linux 读取内核标识并缓存结果；其他平台直接返回 false。保留公开 API，验证 `cargo test --manifest-path desktop/src-tauri/native/is-wsl/Cargo.toml` 与桌面锁文件构建。
- Windows 原生键盘和关闭对话框测试与 WDIO 共用 `CODEAGENT_WEBVIEW_APP_BINARY`，指定独立 EXE 时必须按相同可执行路径定位测试进程；不能改用默认构建路径或按应用名称操作用户正在运行的实例。
- Windows 进程树资源采样需校验子进程创建时间不早于当前父进程创建时间，再沿 `ParentProcessId` 展开；父 PID 被复用时，旧进程及其后代不能归入应用。回归 `scripts/windows-resources.test.mjs` 同时验证旧父 PID 排除和真实后代保留；CPU 按逻辑核心计数，工作集求和可能重复计算共享页。
- 本地测试打包使用 `pnpm tauri:local`，通过配置覆盖关闭 `bundle.createUpdaterArtifacts` 并跳过代码签名。`--no-sign` 本身不能关闭更新签名；正式配置继续保留更新公钥与签名产物要求。打包脚本回归须验证两者独立，操作说明见 [源码开发与构建](../../../../desktop/docs/development.md)。
- 登录自启动开关通过 `enable_autostart` 启用、官方插件禁用和回读；启用操作在后台线程执行，Windows 补齐注册表可执行路径的引号，保留插件处理系统启动项禁用状态的能力。新命令必须进入构建 ACL 清单且仅授权主窗口。实机回归 `tests/webview/windows-autostart.spec.ts` 使用真实 IPC 和注册表，支持 `CODEAGENT_WEBVIEW_APP_BINARY` 指向含空格及中文的测试路径，结束时精确恢复原启动项；系统启动动作不等同于已验证注销后重新登录。
- Linux 登录项遵循 Desktop Entry 的字符串、Exec 引号和 `%` 字段转义；AppImage 使用原始 AppImage 路径。GLib 在字段展开前检查可执行文件，含 `%` 的路径通过 `/usr/bin/env --` 执行，不能直接将 `%%` 路径作为程序名。原生回归 `tests/webview/linux-autostart.spec.ts` 默认接入 Linux WDIO，精确恢复原登录文件；Rust 回归使用真实 `desktop-file-validate` 和 `gio launch`，依赖 `desktop-file-utils`、`libglib2.0-bin`。登录项登记和启动器执行不能替代完整桌面注销、重新登录验收。

- 模型目录以当前配置的官方 Codex `model/list` 为能力来源，保留模型可见性、默认值与完整思考档位。官方账号只走原生目录；自定义 API 才允许按“原生目录 → 兼容 API → 同端点持久化缓存”回退，不能从旧官方账号或其他端点借用能力。保留独立 `model_catalog_url`，不要强制改写为推理地址的 `/models`。只有非空成功目录更新缓存；保留有界 TTL、请求合并、大小/超时限制，不增加轮询或逐模型请求。无元数据时档位为空、默认值为空字符串，执行时转换为 null；显式 `none` 与未来自定义档位原样保留。两端共用 `packages/provider-codex/src/custom-model-catalog-fixtures.json`，验证完整档位、缺失能力、账号隔离、目录地址与缓存回退；详见[模型与思考强度](../../../../docs/model-discovery.md)。

- 插件同步按 App Server 连接合并在途请求，弱引用避免连接与共享 Future 循环持有；请求完成、失败或取消后不复用结果。只向 WebView 传递协议字段，保留部分失败，Hooks 生命周期由 Codex 管理。

- `compress_history` 原生命令转发无参数 `rollout/compress` 并校验对象回执；复用 Codex 的历史维护锁与压缩调度，不实现第二套文件压缩器。
- 历史搜索与 Web 后端保持相同兼容行为：精确接口返回 `-32601` 时分页匹配可见消息，复用官方 inclusive 页锚点定位，续查游标绑定任务和查询；其他错误正常传播。回归覆盖三十条命中后的同页续查、循环游标和 UTF-16 范围，见 [全局搜索](../../../../desktop/docs/global-search.md)。

- 用户界面的目标启动、编辑、暂停、恢复和清除必须发送 `origin: "user"`；自动生命周期不得冒充用户指令。升级时验证回合前的设置提交顺序，以及隔离 `CODEX_HOME` 的目标指令落盘，在根目录执行：`CODEXLY_REAL_RUNTIME_TEST=1 pnpm exec vitest run packages/provider-codex/src/goals-runtime.test.ts`。
- Codex API Key 模型发现已稳定并默认开启；启动参数不强制覆盖此开关，缺省配置不因发现功能而重复写入。模型默认值及推理档位取自命中的 API 或 CLI 目录，保留自定义档位；不增加逐模型请求。

- 项目 Git 读取仅检查当前根目录的 `.git`（目录或 worktree gitfile），缺失时返回 `repositoryMode: "none"`，不扫描子目录、不执行 Git 命令、不回溯父仓库；拒绝通过 `repository` 参数选择子仓库。元数据 Watch 同样不得发现子目录仓库；回归覆盖含子仓库的普通目录、父仓库下的普通目录以及正常 worktree。

- 原生 Git 远端动作复用 `push_project_commits` IPC 与 shared schema，保留已有推送兼容入口。`git_remote` 执行检查/发布/获取/仅快进拉取/功能分支创建；新 UI 先展示目的地，网络动作绑定 HEAD 与分支，工作文件新增不阻塞推送。不提供 resolve/continue/abort，IPC 不接受冲突路径；保留只读检测和提交/推送保护，分叉与未完成操作交由外部工具处理。部分暂存文件生成上下文只采用暂存版本。回归使用 `git_workflow_tests` 的本地临时远端，不推送用户真实仓库。

- Git inspect 是只读恢复入口，项目根仓库检查通过后允许旧快照读取当前 HEAD/远端状态；push/publish/fetch 仍校验请求绑定的 HEAD 和分支，工作区写操作仍严格校验快照。回归覆盖旧快照的检查与保留工作区编辑的推送。

- Git 历史与远端操作共用推送目标解析，空覆盖值按未配置回退；一次读取配置并批量比较固定 HEAD 的 SHA/祖先关系，分页与合并提交不得按序号推断未推送状态。只比较已获取的本地远端引用，不额外访问网络；未知目标/引用省略 `unpushed`，推送成功后清除标记。回归见 `git_workflow_tests.rs` 的 Git 历史分页与推送目标测试。

- `read_task` 的 `summary: true` 仅调用回合摘要接口，内部过程入口放入对应 `AgentTurn.processCursor`，不得混入顶部历史游标；展开过程才读取对应回合的 Item 页。旧格式使用原回合页延迟读取，校验任务归属，测试见 `conversation_pagination_tests.rs`。

- 目录和任务元数据由应用本地仓储独占管理；Project 必须恰好一个根目录。上游列表仅用于一次性事务导入；执行适配器翻译应用任务 ID 与 provider/sessionId，禁止用引擎列表覆盖本地管理状态。两端共享 SQL 契约和单选规则，变更须覆盖离线管理、迁移回滚与身份隔离测试。详见[本地目录与任务](../../../../docs/local-catalog.md)。
- 本地目录仓储按数据库路径复用活动连接，全局注册表只保存弱引用；最后一个使用者释放后必须关闭 SQLite，避免 Windows 文件占用及连接常驻。真实生命周期测试清理临时目录前，既要等待子进程退出，也要释放保留的 AppServerConnection，不能只 drop 进程句柄。回归覆盖并发使用者共享连接、释放后重开仍能读取持久化数据，以及释放连接后的排队图片目录清理。

- Codex 0.163.0 升级边界见 [升级评估](../../../../docs/codex-0.163.0-upgrade.md)。原生实验已读状态不覆盖应用本地目录元数据，两端握手主动关闭 `thread/readState/changed`；不额外查询或轮询已读状态。桌面启动不得再传递上游已退役的 `shell_zsh_fork` 开关。

- 桌面构建使用 `pnpm build:desktop-runtime` 内置目标平台的 Codex vendor 树、Claude CLI 与 Tauri sidecar 宿主。保留官方二进制签名，自建宿主由 Tauri 签名；运行时只读使用安装资源，禁止下载、解压或写入安装目录。依赖随应用更新，缺失或损坏直接报错；回归运行 `node --test tools/desktop-runtime-bundle.test.mjs` 和 Rust `runtime` 测试。详见[引擎分发规则](../../../../docs/agent-engines.md)。
- Tauri 平台及本地覆盖配置须保留共用的 `resources/runtime/` → `runtime/` 映射，不能用空资源数组覆盖；Windows NSIS 安装版与自动更新共用此资源清单。运行 `pnpm --dir desktop tauri:constraints:test` 检查覆盖配置。Windows 安装包须检查实际 NSIS/MSI 载荷，并从安装包还原的目录启动正式程序，通过原生 IPC 确认 Codex 就绪及 Claude 宿主可用；开发模式、构建目录资源检查或手工复制 runtime 的 EXE 验证不能代替最终安装包内容及安装后启动验证。

- 文件/Git 项目目录授权、相对文件预览和项目终端从 `LocalCatalog` 校验项目或任务归属，禁止先获取 Codex 连接。项目工作树仍须经 Git 登记校验，任务预览须校验 projectId。`workspace_project_root` 与 `preview_tests` 提供无需引擎的行为回归，`scripts/engine-independence.test.mjs` 进入原生约束门禁。公共设置传 Claude 范围时只访问应用偏好；Git 提交说明的 Claude 分支使用共享宿主 `commit.generate`，只有 Codex 分支才获取其连接。

- 全局搜索须按依赖向导启用的引擎集合筛选本地候选，再按任务持久 provider 身份检索正文；名称、排序与归档状态以应用目录为准。双引擎保留健康源命中并通过 unavailableEngines 报告失败源，游标绑定查询、类别、归档与引擎集合。Claude 复用共享摘要搜索和宿主，不启动 SDK 推理；文件搜索直接使用文件系统。详见[全局搜索契约](../../../../docs/global-search.md)。

- Claude 的排队、列表、相邻移动、取消、立即发送及 steer 必须先按 LocalCatalog 中的任务 provider 路由到共享宿主，禁止先取 Codex 连接。历史队列附件由宿主复验并导出，原始上传仍经过路径/大小授权。自动续发读取 task.settings 仅访问本地任务偏好；缺省值在宿主中补齐，不在 catalog worker 中反向调用 Claude。

- worktree 创建不生成任务；普通首次 `submit_prompt` 可传 `workspacePath`，`start_task_for_engine` 统一校验项目/worktree 归属并持久化所选引擎与 cwd，首次发送才启动执行会话。已有任务禁止覆盖目录。终端创建可传经过相同归属校验的 `rootPath`，支持尚无 taskId 的 worktree 草稿。新检出统一位于主项目 `.worktree/`；验证 Rust `prompt_submission` / `worktree` / `terminal` 测试、桌面提交与终端运行时测试。

- 应用业务数据统一位于用户主目录 `~/.codexly`，Web 与桌面共用 `state.sqlite3` 及 Claude 历史目录；禁止从 `CODEX_HOME` 或 Tauri 系统应用目录派生新的业务存储。迁移必须用 SQLite 一致快照、禁止覆盖发布及事务完成标记，保留旧源并覆盖 WAL、并发启动、删除不复活、Windows 扩展路径和项目 ID 关联文件复制。详见[本地目录与任务](../../../../docs/local-catalog.md)，验证 `app-storage-migration.test.ts`、Rust `app_data` / `local_catalog` 测试。
