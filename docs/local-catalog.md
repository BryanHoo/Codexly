# 本地目录与任务

Codexly 是目录、任务及其管理状态的唯一数据源。Web 和桌面端均使用应用自己的 SQLite 仓储；AI 引擎负责执行回合与保存其对话上下文。

## 设计依据

[Codex App Server](https://learn.chatgpt.com/docs/app-server) 提供 thread/start、thread/resume、thread/fork 和分页历史接口。[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/sessions) 也通过独立 session ID 恢复会话。因此应用任务和引擎会话采用两种身份：应用 ID 用于路由、偏好、附件和事件；provider + sessionId 只用于执行适配器。

目录与任务元数据采用 SQLite，沿用项目已有的 Worker 与异步 I/O 边界。SQLite 的 [WAL](https://www.sqlite.org/wal.html) 支持读写并行；[外键约束](https://www.sqlite.org/foreignkeys.html) 与事务保证迁移、目录删除及任务归属的一致性。实现不复制引擎的整个 Thread JSON，不新增轮询同步。

## 数据与边界

| 数据                 | 权威位置                    | 规则                                                     |
| -------------------- | --------------------------- | -------------------------------------------------------- |
| 目录                 | managed_projects            | 一个应用 ID 对应一个规范化绝对路径，路径唯一             |
| 任务                 | managed_tasks               | 名称、目录归属、置顶、归档、更新时间和运行状态归应用管理 |
| 执行绑定             | 任务的 provider、session_id | 新任务独立生成 ID，首次执行才创建引擎会话                |
| 对话正文与执行上下文 | 对应引擎                    | 通过适配器按需读取、恢复和分叉                           |
| 导入标记             | managed_catalog_migration   | 与全部导入记录在同一事务提交                             |

Web 与桌面端在同一台电脑、同一系统用户下共用 `~/.codexly/state.sqlite3`，同时共用 `engines/claude` 历史投影目录。`CODEX_HOME` 和 `--codex-home` 仅决定 Codex 引擎的原生配置、会话位置及旧数据发现，不再决定应用数据位置。Codex、Claude 自身的配置与认证仍由官方引擎维护。

| 平台    | 应用数据目录             |
| ------- | ------------------------ |
| macOS   | `/Users/<用户>/.codexly` |
| Ubuntu  | `/home/<用户>/.codexly`  |
| Windows | `%USERPROFILE%\.codexly` |

Node 使用 [os.homedir()](https://nodejs.org/api/os.html#oshomedir)，桌面端使用 [Tauri homeDir](https://v2.tauri.app/reference/javascript/api/namespacepath/#homedir) 对应的原生接口，禁止拼接启动目录或通过系统应用数据目录创建第二份业务数据。引擎安装资源、操作系统登录服务登记、平台日志与可再生缓存仍遵循对应平台的专用目录。

两端共用 `packages/protocol/src/local-catalog-schema.json` 的表定义及 `app-storage-migration.json` 的导入 SQL。Web 数据库操作在 SQLite Worker 执行，桌面端在阻塞池执行；WAL、外键、5 秒 busy timeout 和短事务支持同机多进程访问，不增加后台同步轮询。切回窗口时，两端共用的恢复逻辑只使项目、任务、归档和置顶列表失效，后台不读取聊天正文。

## 应用目录升级

升级前退出旧版本的 Web 服务和桌面应用，再分别启动新版本。首次启动发现 `CODEX_HOME/codexly`、默认 `~/.codex/codexly` 和旧 Tauri 应用目录（macOS Application Support、Ubuntu XDG 数据目录、Windows Roaming AppData）。已经迁移的目录以目标数据库内的标记判断；不再反复导入旧记录。

- 若目标数据库尚不存在，使用 SQLite 的 [VACUUM INTO](https://www.sqlite.org/backup.html) 创建旧 Web 数据库的一致快照，包含 WAL 中已提交的数据。通过同目录临时文件和不覆盖目标的原子发布，避免并发启动替换已打开的数据库。
- 在共享事务内合并旧桌面目录与任务，并提交对应源目录的完成标记。保留目标目录中已有的管理状态；按规范化路径合并项目，同 provider/sessionId 的会话不重复创建。Windows 扩展路径前缀统一为普通路径；保留实际大小写与路径分隔符。
- 项目 ID 合并时复制对应附件、任务偏好及项目默认值到合并后的身份；已存在的目标文件优先。Claude 历史和其索引复制到共同的引擎目录。旧数据库、旧文件及已过时缓存保留在原位置，方便恢复；不复制活动 SQLite 的 db/wal/shm 文件组合。
- 文件复制或数据库约束失败时不标记该源完成，下次启动可重试。完成标记与导入记录在同一事务内；迁移后删除的任务不会在后续重启时复活。
- Web v34 通过数据库触发器维护旧设置、队列等业务表的外键投影。因此桌面端直接创建或删除目录时，Web 的关联写入仍有效。

这属于同机共享存储。远程浏览器使用 Web 服务所在电脑的数据，不在浏览器设备上建立第二份数据库。

公共 Project 暂时保留 `roots` 数组的传输形状，但输入、输出协议均要求恰好一项。两端选择器共用单选函数，选择新文件夹会替换旧选择。Git worktree 仍是任务的执行工作区，不增加项目根目录。

新目录的身份为独立生成的 `project-<UUID>`，任务外键、路由和设置关联均使用该 ID；路径唯一约束只负责防止同一文件夹重复注册。仓储保存磁盘真实路径并保留大小写和平台分隔符，不能保存仅用于比较的路径键。路径修复不得更换项目 ID。

Codex 适配边界负责翻译请求、响应、通知和审批请求中的任务引用。正文、工具文本和回合 ID 保持原值；不同 provider 的 session ID 不共享映射。适配器只为 Codex 任务执行请求，其他 provider 必须接入自己的执行适配器。

### 任务标题与首条消息预览

正式名称与首条输入预览独立保存。首次向未命名的 Codex 任务发送请求时，两端先持久化首个非空输入行（最多 1024 个 Unicode 字符），无正文时使用技能或附件名称。预览只写一次，后续消息不改写它，也不改变任务排序时间。列表、固定任务、详情和搜索按“正式名称 → 持久预览 → 新聊天”显示；预览不能冒充引擎协议的 `name`，因此自动标题成功后仍能替换预览，手动改名仍保持优先。

Web 与桌面共用 `local-catalog-schema.json` 中的 `previewSql`，通过独立的 `managed_task_previews` 表保存预览，删除任务时由外键一并清理。建表是幂等增量操作，兼容任一端先升级；不改变既有任务表的列顺序或管理字段。

旧版本遗留的空标题任务在打开本地仓储时恢复：仅针对已有 Codex 会话绑定、正式名称和持久预览都缺失的记录，以只读方式按 session ID 查询原生索引中的有界预览。基线索引为 `state_5.sqlite`，目录使用 `CODEX_SQLITE_HOME`、`CODEX_HOME` 或默认 `~/.codex`；源索引缺失、占用或不兼容时保留离线目录能力，下次打开重试。恢复不导入或复活任务，不读取完整会话、不调用模型、不更改正式名称、排序、置顶或归档状态。正常列表读取不轮询执行引擎。

## 首次迁移

1. 读取原目录、活动任务、归档任务以及既有 Web 项目记录。仅首次导入需要上游列表接口。
2. 对目录路径规范化、去重；多文件夹目录拆成多个单文件夹目录。首个目录保留旧 ID，其余使用确定性的路径派生 ID。
3. 任务按原目录范围中的最长匹配工作路径归属；worktree 等不匹配路径保留原主目录归属。原独立聊天继续保留独立作用域。
4. 保留旧任务 ID 作为应用 ID，同时登记原 session ID，避免破坏现有链接与任务附件。新任务开始使用独立应用 ID。
5. Web 在同一事务迁移任务偏好、队列和异步问题的作用域；拆分目录复制项目默认值。桌面端复制任务偏好和项目默认值，保留旧文件以便失败重试。
6. 记录与完成标记同时提交。分页错误、约束失败或文件复制失败不会标记完成；成功后重启不再从上游重建目录或覆盖本地名称。

原 Codex 数据不作为删除目标。删除应用目录只移除应用记录及相关状态，不删除用户磁盘文件夹；删除任务也不会删除原引擎的历史记录。应用独占的临时任务工作区继续按现有安全边界清理。旧 Codex 归档会话在真正恢复执行时才调用 unarchive，以满足官方运行时约束。

早期本地迁移若把 macOS/Linux 的路径比较键写成小写反斜杠路径，启动时会根据原 Codex 目录恢复正确路径，同时保留本地项目 ID、名称、任务和设置。修复只在检测到这种异常时读取原目录，正常启动不重新同步上游管理状态。

## 接入其他引擎

新的执行适配器使用同一 LocalCatalogStore 契约，设置自己的 provider 与 sessionId，并在执行边界处理身份和通知。目录、任务列表、名称、置顶、归档和数据库迁移逻辑不应重新实现为引擎 API。Claude 执行器不在本次变更范围内。

## 验证

- `packages/server/src/local-catalog*.test.ts`：持久化、稳定分页、目录唯一性、迁移拆分与回滚、身份映射，以及引擎离线时的 HTTP 管理全流程。
- `local-catalog-preview.test.ts`、`local-catalog-title-restart.test.ts` 与 Rust `local_catalog::preview_tests`：自动标题成功、失败和取消后的重启恢复，旧仓储升级补齐，以及正式名称、归档和排序保持。
- Rust `local_catalog` 测试：本地生命周期、创建空任务不发送 RPC、执行请求与通知身份转换。
- 单文件夹协议测试和共享选择器回归：拒绝多个根，不丢弃用户输入中的额外根后继续创建。
- 两端运行完整测试、类型检查、静态检查及构建；浏览器验证通过 chrome-devtools-mcp 连接运行中的 Chrome。
