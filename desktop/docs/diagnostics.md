# 使用诊断日志排查问题

面向需要分析 Codexly 故障的维护者。日志保存在本机，默认记录关键流程、慢请求、警告和错误。

## 收集故障材料

1. 记录问题发生时间、执行的操作、是否能稳定复现，以及预期和实际结果。
2. 在「设置 → 关于」导出诊断 ZIP。运行时启动失败时也可以导出。
3. 查看 `manifest.json` 中的应用版本、Codex 版本、系统和架构，结合 `logs/` 下的 JSONL 日志和 `metrics/runtime.json` 中的队列指标分析。

应用日志单文件上限为 5 MiB，保留 5 个轮转文件；导出总量上限为 30 MiB。请尽早导出，轮转后的历史可能已被覆盖。日志不能保证在进程被强制终止或存储故障时完整落盘。

## 按关联字段还原过程

每条记录都有 `sessionId`、`timestamp`、`source`、`level` 和 `event`。先按 `sessionId` 区分应用启动会话，再看 `context`：

| 字段 | 用途 |
| --- | --- |
| `connectionSeq` | 区分同一次应用会话内的 Codex 连接；RPC、连接读写故障、Codex stderr 和任务事件使用同一编号 |
| `operationSeq` | 关联一次逻辑 RPC 的开始和结束；过载重试不改变此编号 |
| `requestSeq` | 最后一次 RPC 尝试的编号，包括编码或写入阶段失败的尝试；重试时递增，开始事件没有此字段 |
| `rpcMethod` | 定位协议操作，例如 `turn/start`、`thread/read` |
| `phase` | 判断故障发生在编码、写入排队、写入、刷新、等待响应、解码或重试退避阶段 |
| `elapsedMs` / `timeoutMs` | 对比实际耗时与整个请求的超时预算；耗时使用单调时钟计算 |
| `retryCount` | 实际发起的额外尝试次数，不包含仍在退避等待中的重试 |
| `projectId` / `taskId` / `turnId` | 同一应用会话内的脱敏标识，用于关联任务开始、完成和 Provider 错误；无法跨应用重启直接关联 |
| `eventSequence` | 已投影的任务事件序号，与该项目的事件流序号对应 |
| `restartGeneration` / `restartAttempt` | 关联运行时状态转换与重启计划，辨别连续启动失败 |
| `sourceFile` / `sourceLine` | Rust 警告、错误的记录位置；仅包含源文件名，不包含编译机器目录 |
| `cause1` … `cause4` | 启动等显式保留错误链的位置，补充顶层错误背后的系统原因 |

这些是本地诊断关联号，不是 W3C `TraceId`，也不构成跨 WebView、IPC 和外部服务的完整分布式追踪。

## 常见问题的排查顺序

### 发送后长时间没有响应

1. 查找 `codex_rpc_request_started`，确认 `rpcMethod`。
2. 用相同 `sessionId` 和 `operationSeq` 找到结束事件：
   - `codex_rpc_request_completed`：RPC 返回成功；`turn/start` 成功仅表示请求被接受。
   - `codex_rpc_request_recovered`：发生过载后重试成功，查看 `retryCount`。
   - `codex_rpc_request_slow`：成功返回但耗时至少 2000 ms；这是慢请求诊断，不能据此判定执行失败。
   - `codex_rpc_request_failed`：查看 `errorKind`、`rpcCode`、`phase` 和耗时。
   - `codex_rpc_request_cancelled`：调用方取消了关键请求，不等同于 Provider 错误。
3. 再检查同一连接和任务的 `agent_turn_started`、`agent_provider_error`、`agent_turn_completed`，确认回合是否真正执行完成。

超时的 `phase` 含义：

| `phase` | 检查方向 |
| --- | --- |
| `encode` | 请求编码或登记阶段 |
| `write_queue` | 其他请求是否长时间占用写入锁 |
| `write` / `flush` | 子进程是否停止读取、管道是否受阻；检查 `codex_connection_write_aborted` |
| `response` | 子进程是否已接收请求但迟迟未响应；检查同一 `connectionSeq` 的 stderr 和连接故障 |
| `decode` | 响应结构或返回类型是否异常；服务端返回的 RPC 错误也在此阶段处理 |
| `retry_backoff` | 过载退避是否耗尽总预算 |

关键请求只有开始而没有结束时，结合 `app_stopped`、`previous_session_unclean`、日志轮转和日志丢失汇总判断，不能直接认定请求仍在执行。普通快速读取不记录开始或成功结果。

### 任务失败或不停重连

- `agent_provider_error` 保留错误分类、可用的 HTTP 状态和 `willRetry`；自动重试记为警告，最终失败记为错误。
- `agent_turn_completed` 的 `status=failed` 记为错误并保留脱敏原因。正常完成、用户中断按事实记录，不伪装成系统错误。
- `codex_connection_read_failed` 给出 `reason`、`pendingRequests` 和 `frameBytes`。区分 `eof`、`io`、`frame_too_large`、`invalid_json`、`missing_params`、`image_frame_invalid` 和 `notification_budget_exceeded`。
- `codex_runtime_transition` 显示状态变化；`codex_runtime_restart_scheduled` 给出 `delayMs`、`uptimeMs` 和重启次数。Ready 状态记录把连接编号与重启代次关联起来。
- 启动失败先看顶层 `message`，再看 `cause1` 等字段中的底层原因，例如操作系统错误码。

### 怀疑日志遗漏

查找 `codex_log_ingest_summary`。`invalidLines`、`oversizedLines`、`droppedEvents` 和 `droppedErrors` 是本次汇总窗口的计数；`droppedErrors` 是 `droppedEvents` 的子集。首次丢失立即报告，持续异常每 5 秒汇总，EOF 时报告剩余计数。

stderr 队列上限为 512 条，满载时不会阻塞协议进程。出现 `droppedErrors > 0` 表示部分错误正文已丢失，应结合连接故障和任务终态分析，不能将“未看到错误正文”当作“没有错误”。

## 快速查看 ZIP 中的警告和错误

无需解压，可使用 Python 3 输出关键字段。将参数替换为实际 ZIP 路径：

```sh
python3 - codeagent-diagnostics.zip <<'PY'
import io
import json
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as archive:
    for name in sorted(archive.namelist()):
        if not name.startswith("logs/") or not name.endswith(".log"):
            continue
        with archive.open(name) as stream:
            for line in io.TextIOWrapper(stream, encoding="utf-8", errors="replace"):
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if event.get("level") not in ("warn", "error"):
                    continue
                print(json.dumps({key: event.get(key) for key in (
                    "timestamp", "sessionId", "event", "message", "context"
                )}, ensure_ascii=False))
PY
```

## 记录范围与设计依据

保留原有 JSONL、脱敏、文件轮转与本机导出机制，不引入采集服务器或遥测 SDK。Codex 底层 `INFO/DEBUG/TRACE`、普通快速读取、流式正文和命令输出不记录。警告和错误不做去重采样；stderr 队列过载会明确记录丢失数量。请求参数、完整响应、凭据和原始项目路径不进入新增诊断字段。

依据：

- [OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)：明确事件时间、来源、严重程度与关联上下文。
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)：记录交互标识、操作结果、失败原因，控制敏感信息和日志量，并验证日志链路故障。
- [Rust tracing](https://docs.rs/tracing/latest/tracing/)：异步执行中的事件需要操作上下文，单独的文本日志不足以还原因果关系。
- [Tauri log Builder](https://docs.rs/tauri-plugin-log/latest/tauri_plugin_log/struct.Builder.html)：使用目标过滤、日志级别和文件轮转管理本地日志。
