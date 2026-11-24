# 性能基线

本文用于复测文件搜索、源码打开、Runtime IPC、React commit 与前端 Chunk 体积。

## 运行基准

运行 Release 优化构建的 Rust 文件系统基准（首次编译较慢）：

```bash
pnpm performance:rust
```

运行 Chromium 源码打开基准：

```bash
pnpm performance:browser
```

构建并运行当前平台的 release 原生 WebView 基准：

```bash
pnpm performance:webview:build
pnpm performance:webview
```

构建后检查初始加载和异步 Chunk 预算：

```bash
pnpm build
pnpm performance:budget
```

`pnpm check:web` 已包含 Chunk 预算，`pnpm check:rust` 已包含 Rust 性能基线。CI 对每个
PR 运行 Chromium 基准；原生 WebView release 基准在每周定时任务、手动运行和 Release
门禁中覆盖 WebView2、WKWebView 与 WebKitGTK。

## 采样口径

| 指标 | 口径 |
|---|---|
| 文件搜索冷启动 | 每次清空 5 秒索引缓存后，在 5,000 文件工作区搜索 |
| 文件搜索热启动 | 复用内存索引搜索 |
| 取消延迟 | 发出 `cancel` 到搜索任务结束 |
| 源码读取 | Rust 完整读取 256 KiB 或 2 MiB 文件的所有 256 KiB 分页 |
| 源码打开 | Chromium 调用生产 `CodeBlock`，记录调用到首个 React commit |
| DOM 节点数 | 源码 commit 完成并经过两帧后的基准根节点后代数 |
| 最长主线程任务 | 源码打开期间 Long Task API 返回的最大 `duration` |
| React 渲染 | React Profiler 的 `actualDuration` P50、P95 |
| Delta 到 commit | Rust 写入 `receivedAtUnixMs` 到根 React Profiler commit 的 P95 |
| 启动到首次可交互 | 原生测试放行应用启动到首个 Provider 模式按钮完成渲染的耗时 |
| 原生 commit/render | Runtime delta 分发到文本 commit，并进入下一 WebView 渲染帧的 P50、P95 |
| IPC | Rust Runtime 的已收事件、已发布事件、events/s、合并率和队列高水位 |
| Chunk | 生产构建的原始字节数；初始依赖图总量与所有非初始 JS 单 Chunk 最大值 |
| 场景加载量 | 从 Vite manifest 入口递归收集静态依赖并去重后的生产资源原始字节数 |

## 采集实时链路

以 `?performance-profile=1` 启动主窗口后，在 WebView DevTools 执行：

```js
window.__CODEAGENT_PERFORMANCE__?.snapshot()
```

返回 React `actualDuration`、Rust Delta 到 React commit、前端 IPC 接收速率、接收缓存高水位和 Long Task 分布。Rust IPC 的合并率与有界队列高水位通过 `TauriRuntimeClient.getPerformanceMetrics()` 读取。Profiler 默认在开发环境启用；生产环境必须显式添加查询参数，避免常驻测量开销。

## 文件搜索资源边界

- 单目录索引最多 16 MiB，缓存总计最多 32 MiB、8 个目录；预算计算包含索引项结构与字符串容量，不代表 RSS 上限。
- 最多两个并发搜索 worker、32 个在途会话；同目录并发查询复用已构建索引。
- 超出单目录索引预算后释放文件表，继续遍历并保留排序最靠前的 50 个匹配结果，不截断可搜索范围。
- 取消、替换查询和 Future 销毁均撤销会话；已启动 worker 协作检查取消信号，其并发租约保持到真实执行结束。
- 缓存有效期 5 秒，查询时清理过期项；空闲不运行清理定时器，保留量始终受总预算约束。

## Release 复测

`pnpm performance:rust` 现在显式使用 `--release --lib` 和 `--test-threads=1`，与 Debug 功能测试分离，并避免多个基准相互竞争 CPU 与磁盘。
除 5,000 文件场景外，增加 50,000 文件、8 个并发查询、5 轮持续搜索场景，输出客户端延迟、索引保留字节及 Unix Rust 测试进程 RSS 前后值。
RSS 为采样值而非峰值，也不包含 WebView、Codex 或真实模型任务；桌面端到端与长期运行仍使用原生 WebView 基准验证。

## Git 状态刷新

Web 可见 worktree 连续两次轮询返回相同快照后，轮询间隔从 10 秒延长到 30 秒。活动任务及主动刷新仍走短周期。桌面首页读取当前状态和变更指纹后复用匹配快照的行数统计。续页缓存最多保留 4 个 worktree，共享 32 MiB 清单预算，60 秒到期。提交时重新校验快照。

### 场景与口径

在 macOS arm64（Apple M1 Pro、Git 2.56.1、Node 24.19.0）上，对比基线 `8918f97f` 和当前实现。每组预热后采样 25 次，P95 取升序第 24 项。Web 测服务端只读状态读取。桌面测 Rust Release 首页刷新，交替场景测两个已打开 worktree 的续页。

| 场景 | 夹具 |
|---|---|
| 大索引 | 50,000 个跟踪文件，其中 1,500 个修改 |
| 大量未跟踪文件 | 12,000 个未跟踪的 4,000 字节文本文件，分布在 12 个目录 |
| 两个 worktree 交替 | 同一 50,000 条索引仓库的两个 checkout，各有 1,500 个修改，每次切换根目录 |

读取量使用 Git stdout 的字节数和索引逻辑读取量。索引逻辑读取量用 Git Trace2 的 `do_read_index` 次数乘对应索引大小，涵盖映射读取的索引。实际磁盘设备读取量取决于 OS 缓存和文件系统。桌面首次读取未跟踪文件时，为内容指纹和行数统计读取 48 MB 文件正文。该场景的热样本复用文件指纹缓存。

| Web 场景 | Git 进程数 | stdout 读取量 | 索引逻辑读取量 | P95 |
|---|---:|---:|---:|---:|
| 大索引 | 4 → 1 | 3,895,046 → 210,073 B | 9,603,212 → 4,801,606 B | 117.41 → 117.33 ms |
| 大量未跟踪文件 | 4 → 1 | 360,046 → 348,073 B | 130 → 65 B | 34.69 → 32.06 ms |
| 两个 worktree 交替 | 4 → 1 | 3,895,047 → 210,074 B | 9,603,212 → 4,801,606 B | 183.66 → 176.96 ms |

两次初始探测结束后，静默可见 worktree 每分钟触发 2 次轮询，原先为 6 次。完整的未跟踪文件枚举仍由 Git 执行。

| 桌面场景 | Git 进程数 | stdout 读取量 | 索引逻辑读取量 | P95 |
|---|---:|---:|---:|---:|
| 大索引 | 4 → 3 | 256,629 → 210,129 B | 9,603,212 → 4,801,606 B | 321.62 → 126.78 ms |
| 大量未跟踪文件 | 4 → 3 | 348,126 → 348,126 B | 130 → 65 B | 209.87 → 155.78 ms |
| 两个 worktree 交替 | 4 → 0 | 256,630 → 0 B | 9,603,212 → 0 B | 324.12 → 0.015 ms |

桌面 stdout 读取量按 Trace2 记录的命令在同一夹具上重放计数。纯未跟踪场景省掉的 `git diff --numstat` 没有输出，但仍会读取索引。交替续页命中时直接返回已有快照页。首页仍会读取状态并校验当前文件指纹，内容变化后重算行数。

### 复测

从仓库根目录创建临时夹具。Git 索引 stat 缓存在制造变更前刷新，方便复测热路径。

```bash
export CODEXLY_GIT_BENCH_ROOT="$(mktemp -d)"
python3 - "$CODEXLY_GIT_BENCH_ROOT" <<'PY'
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1])

def git(repo, *args, data=None):
    return subprocess.run(
        ["git", "-C", str(repo), *args], input=data,
        check=True, stdout=subprocess.PIPE,
    ).stdout

def init(repo):
    repo.mkdir()
    git(repo, "init", "-b", "main")
    for key, value in (
        ("user.name", "Benchmark"), ("user.email", "bench@example.invalid"),
        ("core.fsmonitor", "false"), ("core.untrackedCache", "false"),
        ("core.autocrlf", "false"),
    ):
        git(repo, "config", key, value)
    git(repo, "commit", "--allow-empty", "-m", "base")

index = root / "index"
linked = root / "linked"
untracked = root / "untracked"
init(index)
paths = [f"tracked/{i // 1000:02d}/item-{i:06d}.txt" for i in range(50_000)]
oid = git(index, "hash-object", "-w", "--stdin", data=b"base\n").decode().strip()
rows = "".join(f"100644 {oid}\t{path}\n" for path in paths).encode()
git(index, "update-index", "--index-info", data=rows)
git(index, "checkout-index", "-a")
git(index, "update-index", "--refresh")
git(index, "commit", "-m", "large index")
git(index, "worktree", "add", "-b", "linked", str(linked))
for repo in (index, linked):
    for path in paths[:1500]:
        (repo / path).write_bytes(b"changed\nadditional line\n")

init(untracked)
for i in range(12_000):
    path = untracked / f"external/{i // 1000:02d}/new-{i:06d}.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"line\n" * 800)
PY

pnpm test:performance packages/server/src/performance.performance.test.ts \
  -t 'records Git status refresh'
cat "$CODEXLY_GIT_BENCH_ROOT/web-results.json"

GIT_TRACE2_EVENT="$CODEXLY_GIT_BENCH_ROOT/desktop-trace.jsonl" \
  cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib --release --locked \
    performance_baseline_git_status_refresh -- --ignored --nocapture --test-threads=1
```

复测旧实现时，在基线 checkout 中运行同一测试驱动。按场景剔除预热读取后，用 Trace2 的 `cmd_name` 和 `do_read_index` 统计命令和索引读取。
