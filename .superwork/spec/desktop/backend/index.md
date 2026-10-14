# 桌面原生层

`desktop/src-tauri/src/lib.rs` 注册 Tauri 命令与应用状态；`application/` 处理 IPC 与用例，`domain/` 放领域规则，`infrastructure/` 放持久化、Codex 和系统集成。

- 线程订阅释放前检查是否还有排队消息；终态后的短暂 idle 不代表队列已结束。有剩余队列则返回 busy，保留 Core 自动续发能力；检查只取首项并跳过正文、附件和技能映射。

- 新命令核对前端调用及输入输出类型，沿现有 `application/*_commands.rs` 和 `tauri::generate_handler!` 注册路径扩展。
- worktree 创建只登记 Git 工作树，不新增 Project；启动任务同时保留 `projectId` 并将 `cwd`、`runtimeWorkspaceRoots` 指向工作树。任务列表与快照返回 `workspacePath`，文件、Git 和终端访问必须校验工作树归属。
- 数据存储、定时任务、诊断日志等修改检查相邻 Rust 测试；持续遵守 `desktop/AGENTS.md` 的性能约束。
- 任务标题与 Web 端共用 `packages/provider-codex/src/task-title-instructions.json`，编译时嵌入。仅共用 Git 提交模型，不能共用提交提示词；辅助会话关闭项目文档加载，并使用专用基础指令与开发者指令防止全局 `AGENTS.md` 将标题变为提交格式。回归执行 Rust `task_title` 测试。
- 在 `desktop/` 执行 `pnpm check:rust`；完整门槛为 `pnpm check`。环境要求见 `desktop/docs/development.md`。
- 本地测试打包使用 `pnpm tauri:local`，通过配置覆盖关闭 `bundle.createUpdaterArtifacts` 并跳过代码签名。`--no-sign` 本身不能关闭更新签名；正式配置继续保留更新公钥与签名产物要求。打包脚本回归须验证两者独立，操作说明见 [源码开发与构建](../../../../desktop/docs/development.md)。
- 登录自启动开关通过 `enable_autostart` 启用、官方插件禁用和回读；启用操作在后台线程执行，Windows 补齐注册表可执行路径的引号，保留插件处理系统启动项禁用状态的能力。新命令必须进入构建 ACL 清单且仅授权主窗口。实机回归 `tests/webview/windows-autostart.spec.ts` 使用真实 IPC 和注册表，支持 `CODEAGENT_WEBVIEW_APP_BINARY` 指向含空格及中文的测试路径，结束时精确恢复原启动项；系统启动动作不等同于已验证注销后重新登录。
- Linux 登录项遵循 Desktop Entry 的字符串、Exec 引号和 `%` 字段转义；AppImage 使用原始 AppImage 路径。GLib 在字段展开前检查可执行文件，含 `%` 的路径通过 `/usr/bin/env --` 执行，不能直接将 `%%` 路径作为程序名。原生回归 `tests/webview/linux-autostart.spec.ts` 默认接入 Linux WDIO，精确恢复原登录文件；Rust 回归使用真实 `desktop-file-validate` 和 `gio launch`，依赖 `desktop-file-utils`、`libglib2.0-bin`。登录项登记和启动器执行不能替代完整桌面注销、重新登录验收。

- 自定义模型目录按“自定义 API → 当前配置的官方 Codex CLI model/list → 同端点持久化缓存”顺序读取；每层失败、空目录或无可用模型时继续下一层，三层均无模型才返回不可用。只有非空成功目录可以更新缓存，重新连接不清除同端点成功快照；切换端点不得复用旧端点的凭据或模型。保留有界 TTL 缓存、请求合并及响应大小/超时限制，不增加轮询；API 成功不启动额外目录进程。两端用 `packages/provider-codex/src/custom-model-catalog-fixtures.json` 验证 OpenAI/Codex 格式、推理能力与输入模态，回归覆盖优先级、失败/空目录、身份隔离和缓存持久化。

- 插件同步按 App Server 连接合并在途请求，弱引用避免连接与共享 Future 循环持有；请求完成、失败或取消后不复用结果。只向 WebView 传递协议字段，保留部分失败，Hooks 生命周期由 Codex 管理。

- `compress_history` 原生命令转发无参数 `rollout/compress` 并校验对象回执；复用 Codex 的历史维护锁与压缩调度，不实现第二套文件压缩器。
- 历史搜索与 Web 后端保持相同兼容行为：精确接口返回 `-32601` 时分页匹配可见消息，复用官方 inclusive 页锚点定位，续查游标绑定任务和查询；其他错误正常传播。回归覆盖三十条命中后的同页续查、循环游标和 UTF-16 范围，见 [全局搜索](../../../../desktop/docs/global-search.md)。

- 用户界面的目标启动、编辑、暂停、恢复和清除必须发送 `origin: "user"`；自动生命周期不得冒充用户指令。升级时验证回合前的设置提交顺序，以及隔离 `CODEX_HOME` 的目标指令落盘，在根目录执行：`CODEXLY_REAL_RUNTIME_TEST=1 pnpm exec vitest run packages/provider-codex/src/goals-runtime.test.ts`。
- Codex API Key 模型发现已稳定并默认开启；启动参数不强制覆盖此开关，缺省配置不因发现功能而重复写入。模型默认值及推理档位取自命中的 API 或 CLI 目录，保留自定义档位；不增加逐模型请求。

- 项目 Git 读取仅检查当前根目录的 `.git`（目录或 worktree gitfile），缺失时返回 `repositoryMode: "none"`，不扫描子目录、不执行 Git 命令、不回溯父仓库；拒绝通过 `repository` 参数选择子仓库。元数据 Watch 同样不得发现子目录仓库；回归覆盖含子仓库的普通目录、父仓库下的普通目录以及正常 worktree。

- 原生 Git 远端动作复用 `push_project_commits` IPC 与 shared schema，保留已有推送兼容入口。`git_remote` 执行检查/发布/获取/仅快进拉取/功能分支创建；新 UI 先展示目的地，网络动作绑定 HEAD 与分支，工作文件新增不阻塞推送。不提供 resolve/continue/abort，IPC 不接受冲突路径；保留只读检测和提交/推送保护，分叉与未完成操作交由外部工具处理。部分暂存文件生成上下文只采用暂存版本。回归使用 `git_workflow_tests` 的本地临时远端，不推送用户真实仓库。

- Git inspect 是只读恢复入口，项目根仓库检查通过后允许旧快照读取当前 HEAD/远端状态；push/publish/fetch 仍校验请求绑定的 HEAD 和分支，工作区写操作仍严格校验快照。回归覆盖旧快照的检查与保留工作区编辑的推送。

- Git 历史与远端操作共用推送目标解析，空覆盖值按未配置回退；一次读取配置并批量比较固定 HEAD 的 SHA/祖先关系，分页与合并提交不得按序号推断未推送状态。只比较已获取的本地远端引用，不额外访问网络；未知目标/引用省略 `unpushed`，推送成功后清除标记。回归见 `git_workflow_tests.rs` 的 Git 历史分页与推送目标测试。
