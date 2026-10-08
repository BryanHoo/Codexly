# 桌面原生层

`desktop/src-tauri/src/lib.rs` 注册 Tauri 命令与应用状态；`application/` 处理 IPC 与用例，`domain/` 放领域规则，`infrastructure/` 放持久化、Codex 和系统集成。

- 新命令核对前端调用及输入输出类型，沿现有 `application/*_commands.rs` 和 `tauri::generate_handler!` 注册路径扩展。
- worktree 创建只登记 Git 工作树，不新增 Project；启动任务同时保留 `projectId` 并将 `cwd`、`runtimeWorkspaceRoots` 指向工作树。任务列表与快照返回 `workspacePath`，文件、Git 和终端访问必须校验工作树归属。
- 数据存储、定时任务、诊断日志等修改检查相邻 Rust 测试；持续遵守 `desktop/AGENTS.md` 的性能约束。
- 在 `desktop/` 执行 `pnpm check:rust`；完整门槛为 `pnpm check`。环境要求见 `desktop/docs/development.md`。

- 模型目录以当前 Codex App Server 为权威来源；刷新失败直接传播错误，空目录保持为空，不从旧进程或持久化快照恢复已失效模型。保留有界 TTL 缓存及并发请求合并，不增加轮询；回归覆盖空目录、刷新失败与缓存复用。

- 插件同步按 App Server 连接合并在途请求，弱引用避免连接与共享 Future 循环持有；请求完成、失败或取消后不复用结果。只向 WebView 传递协议字段，保留部分失败，Hooks 生命周期由 Codex 管理。

- `compress_history` 原生命令转发无参数 `rollout/compress` 并校验对象回执；复用 Codex 的历史维护锁与压缩调度，不实现第二套文件压缩器。

- 用户界面的目标启动、编辑、暂停、恢复和清除必须发送 `origin: "user"`；自动生命周期不得冒充用户指令。升级时验证回合前的设置提交顺序，以及隔离 `CODEX_HOME` 的目标指令落盘，在根目录执行：`CODEXLY_REAL_RUNTIME_TEST=1 pnpm exec vitest run packages/provider-codex/src/goals-runtime.test.ts`。
- Codex API Key 模型发现已稳定并默认开启；启动参数不强制覆盖此开关，缺省配置不因发现功能而重复写入。模型默认值及推理档位由当前 `model/list` 提供，不增加逐模型请求。

- 项目 Git 读取仅检查当前根目录的 `.git`（目录或 worktree gitfile），缺失时返回 `repositoryMode: "none"`，不扫描子目录、不执行 Git 命令、不回溯父仓库；拒绝通过 `repository` 参数选择子仓库。元数据 Watch 同样不得发现子目录仓库；回归覆盖含子仓库的普通目录、父仓库下的普通目录以及正常 worktree。
