# 桌面崩溃诊断

Windows、macOS、Ubuntu 共用脱敏 JSONL 日志和诊断 ZIP。Windows 额外记录宿主退出与 WebView2 故障。普通 Web / 移动浏览器继续使用浏览器和服务端诊断，不启动桌面观察进程。

## 自动留存

- `codeagent.log` 及轮转日志：常规 Rust、前端和 Codex 结构化事件。
- `codeagent-emergency.log` 与 `codeagent-emergency-previous.log`：每份最多 512 KiB，严重错误同步落盘；任务订阅、启动、退出关键节点同步写入操作系统，避免导航等待 fsync。独立文件不依赖常规 logger 的队列和 flush；panic hook 只写应急文件，避免重入 logger。锁繁忙时跳过，不能阻塞崩溃线程。
- Windows `codeagent-host-<session>.log`：同一可执行文件以内部观察模式启动一个无界面进程，取得宿主同步/查询句柄后阻塞等待退出，记录原始无符号退出码与十六进制值。保留最近 8 次启动的记录。它不加载应用窗口、不启动引擎、不做周期轮询、不上传数据；仍会占用一个进程的内存。

上列日志均自动进入现有诊断导出。常规日志最多约 30 MiB，应急日志最多 1 MiB，导出总日志上限 32 MiB。日志目录由 Tauri `app_log_dir` 决定：Windows 为 `%LOCALAPPDATA%/<应用标识>/logs`，macOS 为 `~/Library/Logs/<应用标识>`，Linux 为本地数据目录下的 `<应用标识>/logs`。

## 排查事件

| 事件                                                                      | 含义                                                                                     |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `previous_session_unclean`                                                | 上次运行标记未清除，携带 `previousSession`；可能是崩溃、强制结束或断电，不能单独判定原因 |
| `host_observer_attached`                                                  | Windows 外部观察进程已取得宿主句柄；没有此事件时不能假设观察器已就绪                     |
| `host_process_exited`                                                     | 宿主实际退出码；与该 session 的 `app_stopped` 对照判断是否正常关闭                       |
| `host_observer_failed` / `host_observer_start_failed`                     | 观察器未能工作，保留 OS 错误信息                                                         |
| `webview_process_failed`                                                  | WebView2 原生失败种类、可用时的原因与退出码；浏览器崩溃、渲染器崩溃或无响应均可能触发    |
| `rust_panic`                                                              | Rust panic 信息与最多 8192 字符的脱敏回溯，优先查看应急文件                              |
| `codex_stderr_unstructured`                                               | 非 JSON stderr 的脱敏、截断样本；每个汇总窗口限量，完整丢弃数量仍见 ingest summary       |
| `codex_process_exited`                                                    | Codex 实际退出码，Unix 信号及是否收到关闭请求；EOF 清理后的关闭请求不代表用户主动退出    |
| `task_subscription_retain_started` / `task_subscription_retain_completed` | 打开任务的关联身份与结果；开始无完成可帮助缩小退出前的执行范围                           |

`app_started` 包含应用、系统、架构与 WebView 版本。任务身份使用现有 session 脱敏规则，错误文本使用现有凭据和路径清理规则。日志不会逐 token 记录正文。非结构化错误样本也必须在分享前检查，通用文本脱敏无法识别所有业务敏感内容。

## Windows 验收

在隔离 Windows 测试机上，先确认观察器附着事件，再逐项测试并重启导出 ZIP：

1. 正常退出：存在 `app_stopped` 和宿主退出码 0。
2. 使用任务管理器结束主应用：观察进程应继续写入退出码，重启出现 `previous_session_unclean`。不要同时结束整个进程树，否则观察器也会被终止。
3. 结束应用对应的 WebView2 渲染进程：记录 `webview_process_failed`；不要结束其他应用的 WebView2。
4. 结束 Codex 子进程：出现其退出码，末尾 stderr 继续排空，运行时按原有策略恢复。
5. 快速切换任务及重载页面：每个 WebView 只有一个失败监听，窗口销毁释放监听。
6. 在专用测试构建触发 Rust panic、原生访问异常和栈溢出：验证应急文件或外部退出码；核对诊断导出包含这些记录。

macOS/Ubuntu 核对 panic、stderr、信号、正常关闭及 ZIP 导出。单元测试覆盖日志轮转、无析构退出后的持久化、脱敏/限量和导出；Windows API 的交叉编译不能代替上述真机故障注入。

## 需要调用栈时

退出码不是崩溃转储。Microsoft 的 WER LocalDumps 可由管理员为实际应用 exe 配置 `HKLM\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\<exe>` 下的 `DumpFolder`、`DumpCount`、`DumpType`，按官方说明采集转储后用匹配版本的符号和 WinDbg 分析。此功能不默认启用，应用不会自动修改系统注册表，也不会自动导出原始内存转储。

断电、内核崩溃、磁盘不可写、观察器也被终止、观察器附着前退出，以及系统直接结束整个作业时，不能保证有最终退出记录。Rust panic hook 也不能覆盖所有原生异常。Windows 在创建窗口前启动观察器；此阶段依赖 `LOCALAPPDATA`，实际 setup 阶段会再次尝试初始化。

## 官方依据

- [Tauri Logging](https://v2.tauri.app/plugin/logging/)：日志目标、级别和轮转。
- [WebView2 进程事件](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-related-events)：原生 ProcessFailed 与浏览器退出事件，不能由 JS 错误处理代替。
- [SetUnhandledExceptionFilter](https://learn.microsoft.com/en-us/windows/win32/api/errhandlingapi/nf-errhandlingapi-setunhandledexceptionfilter)：回调位于故障线程，栈损坏时自身也可能失效，因此用独立进程留存退出码。
- [WaitForSingleObject](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject)、[GetExitCodeProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getexitcodeprocess)：以进程句柄等待并读取真实退出状态。
- [WER LocalDumps](https://learn.microsoft.com/en-us/windows/win32/wer/collecting-user-mode-dumps)：管理员配置、容量控制与用户态转储。
