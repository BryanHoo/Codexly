# CLI 与启动

根目录 `src/cli.ts` 是 `codexly` 入口；`src/cli-command.ts` 处理命令，`src/cli-server-*` 处理服务启动与监听。服务实现属于 `packages/server/`。

- Web 允许同启动目录、同 Codex Home 的多个实例，端口冲突自动递增，不使用长驻实例锁。主运行时与按需模型目录子进程固定使用用户主目录；临时任务默认使用用户主目录，显式工作区使用首个根目录。启动目录不得隐式影响内部配置或任务范围，用 `cli-multi-instance.test.ts`、`cli-command-start.test.ts` 和端口回归验证。
- Web 启动先建立应用仓储、项目目录和 HTTP 服务；Codex 在实际业务 RPC 时才握手，模型目录不在启动时预加载。事件订阅、Claude 历史/对话、项目管理不得创建 Codex 进程或其项目 Git watch。并发首请求共用握手，启动失败允许重试；退出须等待在途握手与导入完成，先关闭进程再释放仓储。回归见 `cli-claude-start.test.ts`、`cli-lazy-codex-client.test.ts` 和 `cli-engine-runtime.test.ts`。
- 主运行时与按需模型目录子进程的初始化握手共用 SQLite 仓储的短期互斥，防止首次同时初始化空 Codex Home 时上游状态库建表竞争；握手后释放，不限制实例并行运行。
- 业务 RPC 适配器只能注入仓储和 Provider，不得替换 App Server 进程持有的原始连接；进程退出仍需关闭 JSONL 传输。目录迁移接线回归须覆盖启用本地仓储后的正常退出。

- 命令参数、环境变量、启动和退出行为同时检查同目录 `*.test.ts` 与 `README.md`、`README.zh-CN.md`。
- 变更打包入口时检查 `tsup.config.ts`、`tools/verify-package.mjs` 和 `pnpm package:check`。
- Node 与 Web 共用 `dist`，Node 构建必须清除旧哈希文件并保留 `web/**` 及其预压缩资源；生产 Node 产物启用压缩。发布回归覆盖保留 Web、删除旧 Chunk、Worker 启动和实际 tarball。
- 应用信息检查在服务端合并在途请求并缓存成功版本五分钟；更新摘要仅保存一个版本的有界内容，失败允许重试。安装前必须重新检查最新版本，不能使用展示缓存决定安装目标；使用 `src/app-update.test.ts` 验证并发、TTL、失败恢复与版本推进。
- 根目录运行 `pnpm test`、`pnpm typecheck`；提交前运行 `pnpm check`。

- Web 登录自启动由 `src/autostart/` 管理当前用户的单个原生服务：macOS LaunchAgent、Windows 交互式登录任务、Ubuntu systemd 用户服务。仅配置命令持有短期事务锁，不限制普通 Web 多实例。命令契约见[自启动指南](../../../../docs/web-autostart.zh-CN.md)。
- 普通启动支持 `--no-open`；托管启动强制关闭浏览器并跳过启动前联网更新检查，复用同一启动和资源清理流程。参数与 PATH 在登记时冻结，LAN 密码持久化且仅由 `credentials` 显式输出。状态以认证的本地控制通道与实际监听端口为准，不能把系统任务运行状态当作 Web 已就绪。
- 自启动只接受稳定的全局 npm 安装，禁止登记 npx 缓存路径；Node/CLI 路径变化由 `repair` 修复。Ubuntu 不开启 linger；已有 linger 时要求活动图形会话并绑定 `graphical-session.target`。Windows 不保存登录密码，取消任务执行时限和电池限制；禁用任务也必须能完整移除。
- 修改登录项时验证失败回滚、凭据脱敏、私有文件权限、日志上限和各平台参数转义；运行 `src/autostart/*.test.ts`、CLI 回归及 `pnpm package:check`。发布校验必须从实际构建产物运行后台失败恢复测试，使用隔离目录，禁止向验证机器注册持久登录项。
- Windows 计划任务 XML 使用带 BOM 的 UTF-16，声明必须与字节编码一致；不能将 UTF-8 文件直接交给 `schtasks /XML`。回归检查文件字节和中文/空格路径，实机验证使用真实计划任务及认证就绪通道。缺失 Codex 的 Windows 发布回归路径仍须以 `.exe` 结尾，才能验证文件缺失而非可执行类型校验。
- 私有配置和状态文件始终通过同目录临时文件原子替换；Windows 共享锁导致 `EPERM`、`EACCES` 或 `EBUSY` 时仅进行有界重试，不先删除旧文件。持续占用必须正常报错并清理临时文件；回归 `src/autostart/config-windows.test.ts` 使用真实 Windows 文件锁，覆盖短暂占用恢复和持续占用时旧状态保留。
- systemd 的 `WorkingDirectory` 是标量路径，不能套用 `ExecStart` 的 argv 引号；空格、反斜杠和 `%` 分别按 unit 字符串与 specifier 规则转义，`$` 保持字面值。Linux 文件回归使用真实 `systemd-analyze --user verify`。禁用服务前读取实际 `ActiveState`，未加载或配置损坏的 inactive unit 仍须允许清理；管理器查询失败正常报错。
