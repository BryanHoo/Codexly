# ACP 迁移本机验收记录

日期：2026-11-13。范围：当前工作区的 Web（含移动浏览器）与桌面 ACP 生产切换，以及移除 macOS Legacy。

## 实现结果

- CLI 和桌面生产客户端统一使用官方 ACP adapter 与共享 Runtime；冷目录、缓存历史和能力读取不启动模型。配置、任务、文本与附件输入、审批、中断、队列、搜索、临时生成和显式配置的定时任务均接通。
- 历史、设置及会话初始化使用 SQLite owner 比较协调写入；仅确认旧进程不存在后接管。领取回执未知或超时关闭宿主，不按锁龄抢占。初始化日志冻结首次配置，重启沿原会话恢复，完成后移除敏感快照。
- 原会话重放通过顺序与正文指纹保留回合、消息身份及已有附件；冷搜索只加载原会话，不发送问题。近期分页游标可继续读取，淘汰后的游标明确失效。
- 桌面运行时构建成功：Codex 0.166.0、Claude 2.1.318；共享 ACP 宿主为单份 Tauri sidecar，原厂程序保留完整布局及许可。原生加载拒绝缺失 sidecar 时回退未签名资源宿主。
- macOS 仅 Modern 14.5 / Safari 17.5，保留 Apple Silicon / Intel。Legacy 构建、兼容渲染、主题参数、安装配置、发布矩阵及独立更新渠道已移除。
- 修复全量验收中复现的虚拟文件树焦点竞态：目标行挂载后聚焦，两端共用实现，不扩大超时、挂载数量或性能预算。

旧 SDK 的直接依赖移至开发依赖，冻结的旧适配源码继续用于兼容回归及开发工具；生产执行装配和发布入口已切为 ACP。旧定时任务缺少明确 ACP 配置时保留定义并拒绝执行，不回退旧执行器。当前 ACP 的专属能力边界见[智能体说明](agent-engines.md)。

## 最终通过的验证

命令均在仓库根目录执行，退出码为 0；桌面命令通过 `--dir desktop` 定位。日志为本次会话本机文件，不作为跨平台实测证明。

| 验证范围            | 命令 / 结果                                                                                                                                   | 最终日志                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 根目录全检查        | `pnpm check` 完整通过；后续焦点修复再执行下列最终补验                                                                                         | `/tmp/acp-final-check2.log`                                                                                                                                       |
| 最终根测试          | `pnpm test`：790 文件、4427 项通过，8 文件 / 17 项按原条件跳过                                                                                | `/tmp/acp-final-root-tests4.log`                                                                                                                                  |
| 最终静态检查        | 类型、严格 lint、架构、格式、500 行约束通过；架构 2282 模块、7579 依赖                                                                        | `/tmp/acp-final-types8.log`、`/tmp/acp-final-lint8.log`、`/tmp/acp-final-architecture4.log`、`/tmp/acp-final-format3.log`、`/tmp/acp-final-lines.log`             |
| 桌面前端检查        | `pnpm --dir desktop check:web`：183 文件、834 项通过，Modern 构建和预算通过；新增浏览器回归的最终类型与 lint 另行通过                         | `/tmp/acp-final-native-web4.log`、`/tmp/acp-final-native-types9.log`、`/tmp/acp-final-native-lint9.log`                                                           |
| 最终组件浏览器套件  | `pnpm --dir desktop test:browser:ci`：Chromium / WebKit 共 346 实例、1510 项通过，无跳过                                                      | `/tmp/acp-final-browser5.log`                                                                                                                                     |
| 最终端到端套件      | `pnpm exec playwright test --workers=4`：Chromium / Firefox / WebKit 共 517 项通过，无跳过                                                    | `/tmp/acp-final-e2e5.log`                                                                                                                                         |
| 焦点压力回归        | 一万文件 End 键跳转，4 个并发浏览器、连续 5 次通过；桌面同场景双浏览器通过                                                                    | `/tmp/acp-final-focus-repeat.log`、`/tmp/acp-final-focus-browser5.log`                                                                                            |
| Rust 格式与 Clippy  | `rust:fmt:check`、全目标 / 全特性 Clippy `-D warnings` 通过                                                                                   | `/tmp/acp-final-rust.log`                                                                                                                                         |
| Rust 全套           | `cargo test --manifest-path desktop/src-tauri/Cargo.toml --all-features --locked -- --test-threads=4`：938 单元、6 进程集成通过，9 项默认忽略 | `/tmp/acp-final-rust-tests.log`                                                                                                                                   |
| Rust Release 基线   | `pnpm --dir desktop performance:rust`：6 项通过                                                                                               | `/tmp/acp-final-rust-performance.log`                                                                                                                             |
| 共享宿主            | `CODEXLY_COMPILED_ACP_HOST=<实际编译产物> pnpm test:acp-host`：12 项通过；Rust / SQLite / 编译宿主真实往返专项 1 项通过                       | `/tmp/acp-final-host.log`、`/tmp/acp-final-rust-host.log`                                                                                                         |
| 官方 adapter        | `CODEXLY_REAL_RUNTIME_TEST=1` 官方隔离握手 2 项通过                                                                                           | `/tmp/acp-final-official.log`                                                                                                                                     |
| 真实账号            | `CODEXLY_REAL_ACCOUNT_TEST=1` 两引擎真实首发、Runtime 重启、原 sessionId 续聊及首回合身份保持，共 2 项通过                                    | `/tmp/acp-final-real-account.log`                                                                                                                                 |
| 根性能              | `pnpm test:performance`：8 文件、16 项通过                                                                                                    | `/tmp/acp-final-performance4.log`                                                                                                                                 |
| 最终浏览器性能      | 长历史与 100 轮持续会话 2 项通过；100 轮后新消息点击至绘制 73.2 ms                                                                            | `/tmp/acp-final-browser-performance2.log`                                                                                                                         |
| 最终构建与 npm 产物 | `pnpm build`、`bundle:check`、`package:check` 通过；发布包 1007 文件                                                                          | `/tmp/acp-final-build4.log`、`/tmp/acp-final-bundle4.log`、`/tmp/acp-final-package4.log`                                                                          |
| 运行时布局          | 实际桌面运行时构建通过；完整性、单份 sidecar、官方程序版本与分发 9 项通过                                                                     | `/tmp/acp-final-runtime-build.log`、`/tmp/acp-final-runtime-proof.log`                                                                                            |
| 平台与发布约束      | 目标平台选择 1 项、桌面约束 68 项通过 / 2 项平台条件跳过；供应链 6 项、Modern 产物及缓存清理检查通过                                          | `/tmp/acp-final-targets.log`、`/tmp/acp-final-constraints4.log`、`/tmp/acp-final-ci-policy.log`、`/tmp/acp-final-macos-output2.log`、`/tmp/acp-final-cleanup.log` |

Web 初始包 353.02 KiB / 360 KiB，工作台就绪 492.51 KiB / 520 KiB；最大异步包 464.06 KiB / 640 KiB。桌面最大异步包 662084 字节，低于原 675000 字节门槛。未放宽包体、挂载数量、性能或源码行数预算。

## 失败处理与证据复用

- 初次全检查发现间接 HTTP 依赖安全公告，固定兼容修复版本后，生产依赖审计为无已知漏洞。
- 共享宿主设置测试补齐新锁端口；实际 SQLite 竞争、SIGKILL 后接管、活进程与权限不足保留、回执丢失清理及宿主关闭均有独立集成回归。
- CLI 的异步队列与落盘验证使用明确等待期限，替代 `waitFor` 默认 1 秒；它不是性能测量，性能门槛保持原值。
- Rust 首次并行压力测试发生超时；控制测试线程数后全套通过，未增加该测试的超时。
- 端到端旧协议夹具改为独立开发构建，不恢复旧生产发布入口。设置夹具使用 ACP 原始选项与完整响应；旧断言按当前配置、底栏和活动状态契约更新。初始分支已无通知中心面板，相应旧用例改验现存任务活动及跳转，系统提醒逻辑仍有原专项测试。
- 文件树焦点故障在并发验收中重复出现后修复；新增桌面回归加载真实 CSS，分别验证点击和键盘打开，并检查一万文件跳转与行数上限。
- 最终根全套、组件浏览器全套、端到端全套、类型及构建均覆盖最终生产代码。Rust、真实账号与共享宿主证据运行后，相关执行、存储与打包输入未再修改，因此复用；前端焦点与主题清理之后补跑受影响全套及构建。

## 验证边界

- 当前证据来自 macOS Apple Silicon。本次未在 Windows、Ubuntu、Intel Mac 或最低 macOS 14.5 真机上启动应用；目标选择和路径契约测试不能代替这些实测。
- 未执行 CI 密钥签名、公证、安装器安装 / 卸载、系统重启或已签名版本更新。发布前仍需执行对应平台门禁。
- 真实账号测试使用隔离的应用数据库与工作目录，限制为无工具问答。它证明官方 adapter 首发和原会话续聊，不代表所有模型、工具、供应商或旧版 GUI 均完成实测。
- 普通套件保留原环境条件跳过。官方 ACP 握手、真实账号及编译宿主已另行显式启用；Rust 的 6 个 Release 基线也已另跑。Bing 网络、旧 App Server 原厂生命周期及独立计划预览性能等原可选场景未冒充已通过。
