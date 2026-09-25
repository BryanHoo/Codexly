# 项目级集成终端开发计划

**Goal:** 在 CodeAgent 中实现按 `projectId` 隔离的本地交互终端，通过 `Cmd+J` 打开或隐藏，在中栏底部显示终端数量，并通过真实桌面测试证明数据有序、缓存有界、空闲低占用。
**Scope:** 仅桌面端；实现终端 UI、Rust PTY 管理、IPC、项目隔离、资源清理和性能验证。已收到实施指令，正在开发与验收。
**Acceptance:** 本文全部 Task 的 Proof 通过，真实 Release WebView 性能报告包含平台、硬件、基线和测量结果；不能用浏览器 mock 通过代替原生 PTY 验收。

计划日期：2026-09-07。状态：实施中；未完成全部 Proof，不代表发布就绪。

### 最新执行证据（2026-09-07）

- 已接入 Rust PTY、二进制 Channel、解析后 ACK、有界输入/输出、项目隔离、主窗口生命周期，以及懒加载 xterm、项目面板、数量和快捷键。
- `pnpm check:web` 最终复核通过：262 项单元测试、28 项约束、2 项性能检查及构建预算通过；首包 419267 B，工作台 1449884 B，最大异步块 501239 B，未放宽预算。
- `pnpm check:rust` 在最新 `main` 上复核通过：292 项库测试通过、5 项按设计忽略；协议集成测试 3 项、Windows 真实 PTY 测试 2 项、性能基线 2 项通过。100 次 PTY 创建/关闭的句柄检查改为独立测试子进程，避免并行测试干扰 FD 基线。
- `pnpm test:browser` 最终整套通过 52 个文件、174 项测试，包含面板 StrictMode/快捷键/四种桌面尺寸、真实 xterm 隐藏解析、WebGL fallback 和底栏分支/工作树懒加载回归。
- Release WKWebView 605.1.15：真实 PTY UI 粘贴、隐藏恢复不重复创建、可见终端布局与截图、退出码 7 和移除已退出标签通过。直接启动的二进制须用精确路径匹配后激活前台；不是修改 `document.hidden`。
- `artifacts/terminal/native-terminal.png` 已人工检查，终端、Composer、底栏无覆盖。用户授予辅助功能权限后，定向 `CGEvent.postToPid` 的真实系统按键输入已通过；嵌入式 WebDriver 的 textarea 模拟输入存在重复字符，不能代替系统按键验收。
- Release CPU/RSS 专项 `pnpm performance:terminal` 通过：无终端 CPU 0.283%，12 空闲会话三轮 CPU 0.217%–0.450%，周期终端 IPC 为 0；12 会话约 94.63ms 回收且 native 配额归零。采样末尾窗口隐藏，且未包含 WebContent/GPU RSS，不能用其证明完整可见渲染占用。报告见 `docs/project-terminal-performance.md`，原始数据见 `artifacts/terminal/release-native-measurements.json`。
- 已完成 200 次 UI 输入/标签切换和 200 次可信系统按键采样。历史 rAF 观测含额外一帧等待，已保存为 `*-raf.json`；通过 TDD 添加 onRender 事件时间戳后重新构建实测，UI 输入 P95 18ms、系统输入 P95 28ms、标签切换 P95 31ms，达到 30/50ms 目标。该口径不等同于显示器实际呈现时间，未下调预算。
- 原生关闭提示未设置父窗口的问题已由真实测试发现并修复为 `.parent(window)`；实际取消/确认、提示期间拒绝新建、取消后恢复创建、确认后清空会话再隐藏均通过。当前 Release 终端 UI 7 项测试通过，无跳过；原有工作台关键流程 7 项、原生二进制协议探针 1 项通过。
- Windows 11 26100 / WebView2 152 Debug 实机验证已通过：PowerShell 与 `cmd.exe` 均可通过 ConPTY 输入、回显和退出；原生二进制 Channel 返回 `ArrayBuffer` 并确认 97×31 resize；xterm UI 的输入回显、隐藏恢复、退出码 7、移除标签及可见布局均通过。为适配 ConPTY 启动时的 DSR 查询，原生探针现在回送 CPR，并将输出读取与子进程等待解耦且全部设置超时边界。Windows Release CPU/RSS、可信物理键盘、原生关闭提示、启动到 Job Object 归属之间的竞态及 ConPTY 阻塞 I/O 取消仍未验证或未解决；Linux 仍未实机验证。异常窗口销毁与重建、完整 Unicode 压力矩阵、完整 WebContent/GPU 内存归属仍未完成，因此 Task 2–7 保持 pending。

## 1. 执行约定

- 开始执行时重新读取 `AGENTS.md`、Superwork 恢复计划技能及任务涉及的项目规格；文件位置以当前代码为准，发现移动时先定位，不重建重复模块。
- 实施按 Task 顺序进行，行为变更使用 TDD；每完成一项记录实际验证命令与证据，再勾选该项唯一的 Task Status。
- 保留用户已有变更，不附带无关重构；不自行提交 Git、创建 PR 或发布。
- 使用项目的 `pnpm`；Python 命令使用 `python3`。使用相关 `tauri-v2`、Rust、React、pnpm 和测试技能前读取其说明。
- 每个开发代码文件不超过 500 行，按职责拆分；在流控、时序和清理关键位置加入准确的中文注释。
- 开发结束不为用户保留 dev server。测试可以启动自己管理的服务，结束后必须回收。
- 当前规格中仍出现的 HTTP/WebSocket 或旧 Codex 版本描述不能作为新增运行路径的依据；以实际 Tauri 本地实现和专门的版本契约为准。

## 2. 已核实的项目现状

| 位置 | 事实与接入要求 |
| --- | --- |
| `package.json`、`src-tauri/Cargo.toml` | React 19、Tauri 2、Rust 后端，使用 pnpm；尚未声明 xterm 或 portable-pty |
| `src/features/workbench/hooks/use-background-terminals.ts` | Agent 后台进程按 `projectId + taskId` 查询，存在 1.5 秒轮询；不是本计划的交互终端 |
| `src/features/workbench/components/workbench-shell-layout.tsx` | 中栏布局接入点；终端不能放到会随 Task 更换而重建的聊天子组件中 |
| `src/features/workbench/components/workbench-composer-view.tsx` | `footerVisible` 区域已有分支、根目录、待办和上下文入口 |
| `src/features/workbench/components/project-draft-controls.tsx` | 现有待办数量入口可作为紧凑外观参考 |
| `src/features/workbench/components/workbench-shell-runtime.tsx` | 已有项目根目录选择，创建终端应消费其 `rootId` |
| `src/platform/tauri/native-invoke.ts` | IPC 统一入口，保留专用 WebView 测试注入 |
| `src/platform/tauri/app-storage.ts` | 应用偏好通过 Rust 存储 actor 落盘，不能新增业务 localStorage 写入 |
| `src-tauri/src/application/app_lifecycle.rs` | 主窗口关闭先隐藏，30–60 秒后销毁 WebView，后台 Agent Runtime 继续运行 |
| `src-tauri/src/application/sidebar_commands.rs` | `remove_project` 是项目清理接入点；必须处理项目删除后其他清理失败的部分成功情况 |
| `src-tauri/build.rs`、`src-tauri/capabilities/` | 命令需要同时注册和授权，不能只增加 `generate_handler!` |

## 3. 固定产品行为

### 3.1 面板和快捷键

- 用户原描述中的“数量如果待办”按“数量像待办一样显示在中栏底部”执行。
- macOS 使用 `Cmd+J`，Windows/Linux 使用 `Ctrl+J`，仅应用内生效，不注册系统全局快捷键。
- 当前项目无终端时，首次打开才加载终端模块并创建一个 shell；已有会话时恢复当前选中的终端。
- 再按快捷键隐藏面板，保留 PTY、程序、历史和标签；重新展开后聚焦终端，收起后恢复之前仍有效的输入焦点。
- 快捷键不得传入 shell；忽略按键重复、输入法组合状态和额外修饰键。模态对话框打开时尊重其焦点范围。
- 中栏自上而下为现有内容区域、可调高度的终端区域、底部状态入口；采用固定分区，不能覆盖消息或输入框。
- 底部入口放在待办旁，使用 Lucide 终端图标与当前项目存活会话数量，包含 tooltip 与可访问名称；数量为 0 时仍可点击创建。
- 存活数量统计 `running`、`closing`；创建中的占位不计入，退出和失败不计入。不推断“正在执行命令”的数量。
- 标签提供选择、新建、结束、移除已退出标签；面板隐藏按钮与结束进程按钮必须语义不同。
- 初始高度建议 280px，最小 160px，上限由中栏剩余高度计算，保证主内容至少 240px；小高度窗口先钳制范围，不能出现最小值大于最大值。
- 同一项目的新建聊天、已有任务、待办编辑共享终端；全局看板、扩展、设置及没有真实项目的 `temporary` 页面不创建终端。
- 不同项目分别记忆展开状态、高度、当前标签；数量不能显示所有项目总数。
- 多标签首版不支持分屏、拖出独立窗口、SSH、tmux、远程终端、AI 自动输入或 shell integration。

### 3.2 工作目录与 shell

- 终端归属固定为 `projectId`，创建时记录 `rootId`；后端验证项目存在、根目录属于项目且目录有效。
- 前端不能传任意 `cwd`、可执行路径、shell 参数或环境变量；后端由 `rootId` 解析绝对路径。
- 更换项目根目录只影响以后创建的会话；已有 shell 的工作目录不跟随 UI 变化，不自动执行 `cd`。
- macOS/Linux 使用后端验证的用户默认交互 shell，缺失时采用明确的平台回退；Windows 优先可用的 PowerShell，最终回退 `cmd.exe`，通过 ConPTY 运行。
- 从 Finder/桌面启动也要有正确的 PATH 和交互环境；避免每次创建都运行多轮 shell 探测，不能通过拼接 shell 命令设置目录。
- 针对不同 shell 选择适用的交互或登录参数，不能给所有 shell 套用 `-l` 或 `-i`；验证 zsh、bash、PowerShell、cmd 的实际行为。
- Unix 使用与 xterm 能力一致的 TERM；Windows 编码与 ConPTY 特性按所选版本文档配置，不能盲目设置不适用的环境变量。
- `projectId` 隔离是会话归属隔离，不是文件系统沙箱；用户交互 shell 按当前用户权限运行。

### 3.3 生命周期与主窗口关闭

本节明确上一轮方案中的“主 WebView 销毁时结束用户终端”，避免产生延迟销毁时悄悄杀进程的实现。

| 动作 | 首版行为 |
| --- | --- |
| 隐藏终端面板、切换任务或项目 | 保留会话和终端解析状态，暂停不可见绘制 |
| 主窗口最小化或短暂隐藏 | 保留会话，停止绘制；背压限制消费不足时的积压 |
| 结束单个终端 | 后端终止该会话的受管进程，回收句柄和工作线程；保留有界退出视图直到用户移除 |
| shell 自然退出 | 排空可读尾部输出后报告退出；保留有界历史，不计入数量 |
| 用户关闭主窗口且存在存活终端 | 先提示会结束本地终端，可取消；确认后关闭这些终端，再进入现有隐藏/延迟销毁流程 |
| 用户关闭主窗口且没有存活终端 | 保持现有行为，无新增确认 |
| 项目删除成功 | 禁止再创建该项目终端，清理全部会话、UI 状态与偏好；失败路径不得恢复已删除项目的会话 |
| 应用真正退出 | 原生退出路径有界清理所有用户终端，不依赖 React cleanup |
| WebView 崩溃或意外销毁 | 原生层清理该 WebView generation 拥有的会话，重建后不假装恢复 shell |

- 主窗口关闭提示是本计划的首版设计默认值。后续用户明确要求后台保活时，应先修订本节和验收，不擅自增加后台 VT 模拟器。
- 关闭流程在 Rust 标记 owner 正在关闭，阻止确认与清理期间新建会话；取消关闭时撤销该状态。
- 刷新或重建后的新 generation 不得附着旧的终端解析状态；旧 Channel 失败或旧窗口清理不得误杀新 generation 的终端。
- 处理主窗口 `Destroyed`、用户确认关闭、显式应用退出三条原生路径；只有 `beforeunload` 或组件卸载处理不合格。
- 不修改后台 Agent 任务的关闭语义。未显式脱离管理的子进程必须回收；自行 daemonize/脱离进程组的程序不承诺通用追踪，平台限制要在测试结果中说明。

## 4. 技术架构和性能约束

```text
React 面板 / 项目元数据 Store
              |
TerminalRuntime（跨 Task 路由保留，按 projectId + terminalId 索引）
              |                      |
        xterm.write(bytes)       native terminal client
              ^                      |
              | raw Channel          | invoke / raw input / ACK
              |                      v
       Rust TerminalManager -> 每会话有界队列 -> portable-pty -> shell
```

- 新增 `@xterm/xterm`、`@xterm/addon-fit`、`@xterm/addon-webgl`、`portable-pty`，版本在实施时核对并锁定兼容组合；本计划不声称已经验证具体版本。
- 使用 xterm 处理 VT、ANSI、UTF-8、选择、IME 和交互程序；不要自行解析终端控制序列或用普通文本日志视图替代终端。
- 终端模块首次展开时动态加载，终端 CSS 随模块加载；不能在主入口静态引入插件导致首屏包膨胀。
- 输出直接进入 xterm，不经过 React state、Zustand 字符串、React Query、聊天 Runtime 或 Markdown 组件。
- Store 仅保存有界元数据；终端列表变化才更新计数，输出本身不能触发 React commit。
- 按会话保留 xterm 实例，只有当前可见实例启用 WebGL；隐藏后禁用绘制并释放 WebGL 插件资源，恢复时重新启用，失败回退 DOM。
- 保留 xterm 的解析状态，按字节顺序持续消费隐藏终端输出；不能丢弃任意 ANSI 字节、截断未解析流或把最近一段原始输出当完整恢复快照。
- WebView 被系统节流时可能无法持续消费；允许背压减慢输出生产者，不承诺隐藏状态下无限吞吐或零 CPU。
- 尺寸变化采用 `ResizeObserver` 与按帧合并，仅尺寸非零、面板可见、行列改变时执行 fit 和 PTY resize；拖动结束持久化高度。
- 注册表锁只用于查找/插入，阻塞读写、等待退出、Channel 发送不能持有全局锁。
- `portable-pty` 阻塞操作进入专门工作线程或正确隔离的 blocking worker；为长期阻塞任务定义最大线程数和解除阻塞方式，不能认为取消 async task 就能取消阻塞读取。
- 每个会话输入串行，读写互不等待对方持有同一把锁；创建、关闭、自然退出应有明确的单一状态迁移所有者。

### 4.1 初始资源预算

以下为实现初值与验收候选，必须通过真实平台压测调整并记录原因。

| 项目 | 初值 / 约束 |
| --- | --- |
| PTY 数据块 | 最大 16 KiB |
| 合并等待 | 第一块到达后最多 4ms；填满立即发送；空闲不启动周期计时器 |
| 输出高 / 低水位 | 未解析字节 256 KiB / 64 KiB |
| ACK 合并 | 累计解析 32 KiB 或解析后单次最长等待 8ms；没有待确认字节时不运行定时器 |
| 输入队列 | 每会话最多 64 KiB，单次 raw 输入不超过 16 KiB，按消费能力发送 |
| 前端粘贴 | 最大 1 MiB，超限明确拒绝；使用 xterm 粘贴语义保留 bracketed paste |
| 滚动历史 | 每会话 3,000 行；活动屏幕尺寸最多 500 列、200 行 |
| 会话配额 | 每项目最多 4 个存活会话，全局最多 12 个，创建中预留也占配额 |
| 已退出标签 | 计入额外保留上限：每项目 4 个、全局 12 个；只淘汰最旧已退出标签，不终止存活会话 |
| 输入/输出消息总量 | 所有暂存层分别有明确字节上限；不能只限制 xterm scrollback |
| 清理时限 | 温和结束后最多等待 2s，再执行平台强制清理；整体目标 3s，超时不报告清理成功 |

scrollback 行数不是 RSS 的精确字节上限。要同时约束尺寸、会话总数、字符组合等极端输入行为并测试所选 xterm 版本；存在库内部不可控增长时必须报告并修订预算，不能伪称严格内存上界。

### 4.2 背压与有序传输

1. Rust 记录累计发送字节 `sentOffset`，前端只在 `terminal.write` 的完成回调后推进 `parsedOffset`。
2. `outstanding = sentOffset - acknowledgedOffset`；发送额度不足时不继续读取 PTY，最多允许已经在途的一块计入明确的附加预算。
3. ACK 使用累计偏移，重复或陈旧 ACK 不增加额度；超出已发送范围、跨 generation 或跨项目的 ACK 拒绝。
4. 高水位暂停、低水位恢复使用条件通知，不轮询。不使用 `Channel.send()` 返回作为消费确认。
5. 不对每个字节执行 invoke，不对每块都暂停/恢复 PTY；ACK 合并也必须支持最后不足阈值的尾部数据，防止永久停流。
6. 终端输入及时发送；大段粘贴按有限队列串行传输。取消粘贴时丢弃尚未发送部分后再处理 `Ctrl+C`，不得重排已经接受的输入。
7. 子进程退出通知携带最终输出偏移；前端解析到该位置后标记输出完成，避免关闭状态先到导致尾部丢失。
8. 后代进程持有 slave 时 EOF 可能不随 shell 退出到达；退出排空采用有界等待并标记截断原因，不永久等待。
9. 所有等待都能被关闭通知打断；发送失败转入 owner/session 清理，禁止无限缓存或无限重试。

## 5. 跨层接口契约

类型定义放入 `src/protocol/project-terminal.ts` 和 `src-tauri/src/domain/project_terminal.rs`。终端属于应用本地能力，不修改 Codex 生成协议。

```typescript
type TerminalScope = { projectId: string; terminalId: string; generation: string };
type TerminalMetadata = TerminalScope & {
  rootId: string;
  title: string;
  state: "running" | "closing" | "exited" | "failed";
  cols: number;
  rows: number;
  exitCode: number | null;
};
```

`generation` 由后端绑定实际主 WebView 生命周期生成。调用者传回 generation 不等于获得授权，后端始终校验调用窗口和 owner。

| 命令 | 输入 / 输出 | 约束 |
| --- | --- | --- |
| `connect_project_terminals` | 控制 Channel -> `{ generation, sequence, terminals }` | 主 WebView 唯一管理连接；原子注册并返回有界全局元数据快照 |
| `create_project_terminal` | `{ projectId, rootId, requestId, generation, cols, rows, onOutput }` -> `TerminalMetadata` | 配额原子预留，requestId 幂等；前端先建立数据接收实例再 invoke |
| `write_project_terminal` | raw bytes + scope/input sequence headers -> void | 原始字节进入有限输入队列；响应表示接受，不表示 shell 已执行 |
| `resize_project_terminal` | scope + `{ cols, rows }` -> void | 校验范围，同尺寸不产生 OS 调用；同会话串行保证最后尺寸生效 |
| `ack_project_terminal` | scope + `{ parsedOffset }` -> void | 累计确认，按实际字节计算 |
| `close_project_terminal` | scope -> void | 幂等，实际清理结束后成功返回 |
| `remove_project_terminal` | scope -> void | 仅移除已退出或失败标签及有界元数据，不作为终止入口 |

- 控制 Channel 事件为 `{ sequence, type, data }`，覆盖创建、状态变更、退出、移除；数据含完整 scope，退出包含 `finalOffset`。
- 快照和控制事件由同一个串行所有者确定先后；客户端先注册 handler 并短暂有界暂存，再应用快照并只接续更高 sequence，避免初始化竞态。
- 每个终端一个输出 Channel，Rust 使用 `Channel<tauri::ipc::Response>` 发送原始二进制，JS 接收 `ArrayBuffer`；实施时验证该版本实际传输，不能退化为 JSON `number[]` 或 Base64。
- 输出帧头固定 16 字节：前 8 字节 `sequence`、后 8 字节 `endOffset`，均 little-endian u64，后接 PTY 原始 bytes；scope 绑定于创建请求和 Channel 闭包，不重复拷贝到每帧。
- JS 用 BigInt 读取头部；跨 JSON 的 sequence/offset 使用规范十进制字符串。每会话序号从 1 递增，偏移只累计 payload，验证连续性和长度。
- raw input headers 固定 `x-codeagent-project-id`、`x-codeagent-terminal-id`、`x-codeagent-generation`、`x-codeagent-input-sequence`。ID 使用 `encodeURIComponent` 编码并由 Rust 解码一次，限制长度并验证真实归属；不能把 headers 当可信数据。
- 同会话输入 sequence 单调，重复确认不得重复写入 shell；序号缺口返回具体错误，客户端不盲目重放可能部分写入的数据。
- 创建幂等缓存按 owner 限额并在 generation 结束释放。相同 requestId 不得重复启动 shell；重复请求绑定不同输出 Channel 时返回明确冲突，不能无声替换。
- 对控制快照允许合并可重建元数据，但输出流不能丢帧；输出缺口或非法帧使会话显式失败并清理，不能继续显示损坏屏幕。
- 错误码至少覆盖 `TERMINAL_PROJECT_NOT_FOUND`、`TERMINAL_ROOT_INVALID`、`TERMINAL_LIMIT_REACHED`、`TERMINAL_NOT_FOUND`、`TERMINAL_SCOPE_MISMATCH`、`TERMINAL_OWNER_CLOSING`、`TERMINAL_SPAWN_FAILED`、`TERMINAL_INPUT_TOO_LARGE`、`TERMINAL_STREAM_INVALID`、`TERMINAL_CLEANUP_FAILED`。
- 只授权 `main` 窗口的专用命令；不安装通用 shell 执行插件权限，不允许宠物、文件预览或其他窗口调用。
- 终端输出不进入应用日志或持久化；终端标题长度有界且作为纯文本处理，不默认接受 OSC 52 自动写剪贴板，不自动打开输出中的链接。
- 偏好通过 app-storage 保存布局；重启不保存或恢复 PID、PTY、原始输出及已失效 terminalId，不自动启动之前的 shell。

## 6. 开发任务

### Task 1: 固定依赖、协议和平台验证入口

**Files:**

- Modify: `package.json`、`pnpm-lock.yaml`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`
- Create: `src/protocol/project-terminal.ts`、`src-tauri/src/domain/project_terminal.rs` 及对应协议测试
- Modify: `src/protocol/index.ts`、Rust domain 模块声明

**Behavior:**

- 核对依赖官方版本、许可和兼容性，用最小验证确认 binary Channel、默认 shell、PTY resize 和退出路径。
- 固化第 5 节类型、frame 编解码、输入 headers、错误码和数值边界；只新增本地协议。
- 阅读现有性能预算和 supply-chain 检查，不能通过放宽规则掩盖依赖问题。

**Interfaces:** 第 5 节命令与数据结构是后续 Task 的共同契约；改变时同时更新本计划、前后端测试。

**Proof:** 精确序列化测试覆盖 camelCase、事件标签、u64 大数、跨块中文、帧长度和非法 headers；原生测试确认 JS 得到 `ArrayBuffer`。记录实际依赖版本。

**Stop Conditions:**

- binary Channel 在所选版本不能工作、平台 PTY 无法满足基本行为时，先修订架构并提供证据，不引入 Node sidecar 或 WebSocket 兜底。

- [x] **Task Status:** completed

**实施证据（2026-09-07，macOS）：** 固定 `@xterm/xterm 6.0.0`、`@xterm/addon-fit 0.11.0`、`@xterm/addon-webgl 0.19.0`、`portable-pty 0.9.0`，均为 MIT。`pnpm exec vitest run src/protocol/project-terminal.test.ts` 15 项通过；`cargo test --manifest-path src-tauri/Cargo.toml --test project_terminal_protocol --locked` 3 项通过；`cargo test --manifest-path src-tauri/Cargo.toml --test project_terminal_pty --locked` 默认 shell、bash、zsh 共 3 项通过。`pnpm test:webview:build` 后执行 `pnpm exec wdio run wdio.conf.ts --spec tests/webview/terminal-protocol.spec.ts`，真实 WKWebView 605.1.15 确認 `ArrayBuffer`、PTY 输入输出和 97×31 resize；专用探针仅在测试 feature 中注册且仅 main 测试 capability 授权。`pnpm typecheck`、定向 oxlint、`pnpm supply-chain:policy:test` 通过。Windows/PowerShell 与 Linux 尚未执行，不构成跨平台验收。

**Windows 补充证据（2026-09-07）：** 上述“Windows/PowerShell 尚未执行”仅描述当时的 macOS 验收轮次，现已被后续验证取代。Windows 11 / WebView2 152 Debug 实机确认 PowerShell、`cmd.exe`、二进制 Channel、PTY 输入输出和 97×31 resize；Linux 仍未执行，不构成跨平台验收。

**依赖限制：** xterm 6.0.0 `BufferLine.addCodepointToCell` 对组合字符串直接追加，scrollback 不能形成严格 RSS 上界；Task 5/7 必须验证极端组合字符并记录处理策略。

### Task 2: 实现有界 PTY 会话与进程清理

**Files:**

- Create: `src-tauri/src/infrastructure/terminal/{mod,manager,session,shell,process_cleanup}.rs` 及拆分测试模块
- Modify: `src-tauri/src/infrastructure/mod.rs`、`src-tauri/src/application/state.rs`
- Reuse or extend: `src-tauri/native/windows-process-platform/`，仅在现有平台能力适用时扩展

**Behavior:**

- 创建每会话独立 PTY、reader、writer、child/kill handle；创建完成后释放父侧不需要的 slave 句柄。
- 原子预留项目/全局配额，创建失败完整回滚；项目注销和创建并发不能产生孤儿会话。
- 按平台处理进程组/Job Object 或等价受管树回收，验证交互 shell 的前台子作业也能结束。
- 自然退出、主动关闭、关闭失败形成确定的状态机；关闭幂等，句柄和线程在时限内释放。

**Proof:** Rust 单元测试使用 fake PTY 验证配额、失败回滚、项目隔离和竞态；真实 PTY 测试覆盖 shell 输出、输入、resize、前台子进程、EOF、重复 close。记录线程与句柄基线恢复结果。

**Stop Conditions:**

- 阻塞 reader/wait 无法退出或清理无法覆盖受管子作业时，本项不通过；不能只 kill shell PID 并宣称已清理。

- [ ] **Task Status:** pending

**Task 2 当前证据（2026-09-07）：** `cargo test --manifest-path src-tauri/Cargo.toml infrastructure::terminal --lib --locked` 的 10 项定向测试覆盖配额、回滚、项目删除与 spawn 竞态、跨项目拒绝、默认 shell 参数、主动关闭、自然退出和后台作业回收；`cargo test --manifest-path src-tauri/Cargo.toml terminal_handles_return --lib --locked -- --test-threads=1` 完成 100 次循环，文件描述符回到基线，耗时 1.81s。Unix I/O 通过 PTY 就绪与 socketpair 关闭通知共同等待；child 使用单个阻塞等待线程和通知，无空闲轮询。Windows Job Object 已添加，但启动至 Job 绑定的竞态、ConPTY 阻塞解除仍未验证，Task 2 不标记完全完成。后续流控接入将继续补齐工作线程关闭验证。

### Task 3: 实现二进制流、输入排序和 ACK 背压

**Files:**

- Create: `src-tauri/src/infrastructure/terminal/{transport,flow_control,input_queue}.rs` 及测试
- Create: `src/platform/tauri/project-terminal-client.ts` 及测试
- Create: `src/features/terminal/terminal-stream.ts` 及测试

**Behavior:**

- 实现第 4.2、5 节传输契约，完整限制每个排队层，不忙轮询。
- handler 必须早于 create 注册；终端对象在原生返回前也可以接收启动输出，不因早到消息丢字。
- raw 输入有序、去重且有界，处理大粘贴、部分写失败、取消和 Ctrl+C。
- 正确协调最后输出、ACK、EOF、退出通知和关闭，释放 pending callback 与计时器。

**Proof:** 可控时钟/fake PTY 测试覆盖 1 字节碎片、16 KiB 块、慢消费者、尾部不足 ACK 阈值、重复/越界 ACK、断开、跨 generation、退出乱序；断言具体最大队列字节且全部正常路径字节一致。

**Stop Conditions:**

- 任一队列无界、ACK 丢失导致死锁或退出丢失尾部时不得进入 UI 整合；不能靠丢输出解决。

- [ ] **Task Status:** pending

**Task 3 当前证据（2026-09-07，继续实施）：** 前端协议、输入队列、输出解析和 native client 定向测试共 29 项通过，`pnpm typecheck` 与定向 oxlint 通过。Rust 终端模块 26 项串行测试通过，额外的 generation 重连隔离、输入/ACK/resize 归属测试分别通过。真实 PTY 连续输出 1 MiB，在 256 KiB 未确认字节处停读，确认后恢复且逐帧序号、偏移和全部字节一致；自然退出报告尾部偏移和真实退出码。Unix 首块后最多等待 4ms 合并，等待可取消。新增未确认帧数上限 1024、恢复阈值 256，限制单字节碎片的消息元数据。前端仅对明确拒绝的 `TERMINAL_INPUT_QUEUE_FULL` 保留序号、以单次 8ms 等待重试，最多 64 次，Ctrl+C 和 dispose 可取消等待。已补充控制队列 128 条上限、原子快照序号、关闭后释放配额及退出标签淘汰。Windows 合并/取消、bracketed paste 中途取消、完整 Tauri 生命周期和压力验收仍待完成，Task 3 保持 pending。

### Task 4: 接入 Tauri 命令、权限及主窗口生命周期

**Files:**

- Create: `src-tauri/src/application/terminal_commands.rs`、必要的 `terminal_lifecycle.rs` 及测试
- Modify: `src-tauri/src/lib.rs`、`src-tauri/build.rs`、实际主窗口权限文件和 `src-tauri/capabilities/default.json`
- Modify: `src-tauri/src/application/app_lifecycle.rs`、`sidebar_commands.rs`、应用退出装配位置
- Test: 扩展 `scripts/` 下现有 Tauri 约束测试

**Behavior:**

- 原生验证窗口、generation、项目、rootId 和 terminalId；连接建立元数据快照与控制 Channel。
- 实现主窗口关闭提示与取消、关闭期间拒绝创建，以及意外 Destroyed 的原生清理。
- 项目删除成功立即将项目终端标记不可用并启动清理，即使后续 settings 清理失败也不能漏掉 PTY。
- 应用退出使用有界 shutdown 编排，不在等待退出完成前直接结束 Tauri 进程；隐式最后窗口退出仍保留 Agent Runtime。
- 同步命令注册、权限和必要共享规格；终端专用授权是本次功能范围，不授予其他窗口通用 shell 能力。

**Proof:** ACL 测试拒绝非 main 窗口与伪造 scope；生命周期测试覆盖确认/取消关闭、主窗口重建 generation、项目删除部分成功、创建/关闭并发、显式退出和 Agent Runtime 保留。

**Stop Conditions:**

- 若现有原生退出路径无法有界等待清理，先修复该终端范围内的编排；不能把主窗口关闭改成静默杀终端或永久保留 WebView。

- [ ] **Task Status:** pending

### Task 5: 实现独立前端运行时和懒加载终端视图

**Files:**

- Create: `src/features/terminal/{terminal-runtime,terminal-store,terminal-preferences}.ts` 及测试
- Create: `src/features/terminal/components/{terminal-viewport,terminal-panel,terminal-tabs}.tsx`
- Modify: 应用根级装配位置，仅注册轻量生命周期与元数据连接

**Behavior:**

- 应用级 runtime 保留实例，组件挂载/卸载仅 attach/detach 视图；Task 路由更换不 dispose 会话。
- 纯元数据 Store 按项目订阅，输出不触发 UI 元数据通知；开发 StrictMode 不能重复 spawn。
- xterm、FitAddon、WebGL 按需加载；仅可见终端持有 WebGL 插件，context loss 回退 DOM 后仍可输入。
- 隐藏实例继续有序解析且不绘制；恢复 fit/refresh/focus 正确，不能通过序列化原始尾部重建屏幕。
- 处理 IME、选择、复制、粘贴、bracketed paste；复制默认只针对选择内容，Ctrl+C 无选择时发送中断。
- 已退出标签保留上限，淘汰时 dispose xterm 和所有监听器；app-storage 只保存布局偏好。

**Proof:** 浏览器组件测试覆盖多个项目、任务切换、StrictMode、隐藏输出后恢复、WebGL fallback、IME、粘贴和退出标签淘汰；React Profiler 证明纯输出不使聊天区或元数据消费者 commit。

**Stop Conditions:**

- 所选 xterm 的隐藏绘制行为无法验证时，先实现并测试显式可见性控制，不能只设置 CSS 后声称零绘制。

- [ ] **Task Status:** pending

### Task 6: 接入中栏面板、数量和快捷键

**Files:**

- Modify: `src/features/workbench/components/workbench-shell-layout.tsx`、`workbench-composer-view.tsx` 及必要的 contracts
- Create: `src/features/terminal/components/terminal-status-trigger.tsx`、快捷键和垂直 resize hook
- Modify: 相关样式文件、`src/i18n/locales/` 中实际中英文资源
- Test: 新增 terminal panel 浏览器测试

**Behavior:**

- 按第 3.1 节完成布局、项目计数、标签操作、键盘焦点和快捷键。
- 入口消费轻量 store，不能仅为显示数量加载 xterm；没有终端时不预先启动进程。
- 首次创建失败保留可重试状态，不计入数量、不占配额；快速连按和点击必须合并创建请求。
- 不改变现有 Agent 后台终端入口；没有真实 projectId 的页面不把会话错误归到占位 ID。
- 工具按钮使用图标和 tooltip；长项目名/标题截断可查看完整文本，尺寸变化不能推挤或覆盖输入区。

**Proof:** 桌面 1280×800、1440×900、1920×1080 及窄/矮窗口截图和交互测试；验证按键在 shell 聚焦、Composer 聚焦、模态框、IME 下的行为，以及多项目数量和高度恢复。

**Stop Conditions:**

- 面板进入 Task key 导致切换任务重建 PTY，或底部入口造成现有 Composer 功能回归时不得标记完成。

- [ ] **Task Status:** pending

### Task 7: 真实平台端到端与性能验收

**Files:**

- Create: `benchmarks/terminal/` 场景、必要的 terminal benchmark spec/config
- Modify: `package.json` 中有需要的专用测试入口，不破坏现有 `benchmarks/playwright.config.ts` 默认 source-open 场景
- Extend: 项目现有 WebView 测试目录、Rust performance tests 和诊断指标模块
- Create: `docs/project-terminal-performance.md`，仅在实际执行基准后记录结果

**Behavior:**

- 指标只记录字节数、消息数、队列高水位、会话数、线程/句柄数、耗时；不记录命令、输出或环境变量。
- 分别测试未打开、1/12 个空闲终端、单个/多个高流量终端、隐藏输出、项目切换、关闭回收。
- 高频输出用受控限时 producer，测试结束自动清理；验证 Ctrl+C、聊天输入和面板切换响应。
- 对照同一机器、同一 Release 构建配置、同一 shell profile 的无终端基线，应用与 shell 子进程占用分开记录。
- 至少记录 macOS WKWebView、Windows WebView2、Linux WebKitGTK 的验证状态；某平台未运行必须明确标为未验证，不能写跨平台全部通过。

**Proof:** 执行下方完整验收矩阵与工程检查；保存原始样本摘要、分位数、RSS 曲线、截图和失败结论。所有临时 producer 与测试服务都退出。

**Stop Conditions:**

- 资源持续增长、终端串项目、输入乱序、清理残留或关键平台未验证时，不宣称发布就绪；缺少平台只记录阻塞并继续可完成的其他验证。

- [ ] **Task Status:** pending

## 7. 验收矩阵与最终检查

| 场景 | 方法 | 通过标准 |
| --- | --- | --- |
| 冷启动未使用终端 | Release 加载/进程/IPC 观测 | 无 PTY、无终端动态 chunk、无终端轮询 |
| 12 个空闲终端 | 预热后观察 60s，重复 3 次 | 无周期终端 IPC；应用进程 CPU 增量目标不超过 1 个百分点，报告平台计量口径 |
| 普通输入回显 | 自动输入并检测真实 WebView 首次绘制，至少 200 样本 | P95 目标 ≤30ms；不包含首启 shell，必须注明测量误差 |
| 已创建终端切换 | 至少 200 次项目/标签切换 | P95 目标 ≤50ms，画面正确且无重新 spawn |
| 持续输出 | 受控 producer 输出 60s，包括后台会话 | 所有队列符合计算预算，稳态内存无随总输出线性增长 |
| 输出中断与 UI 响应 | 压测时 Ctrl+C、Composer 输入 | Ctrl+C 可观察响应 P95 目标 ≤100ms，聊天输入无持续卡顿 |
| 大段输入 | 1 MiB 粘贴、超限粘贴、取消粘贴 | 正常字节一致，超限明确拒绝，队列不越界 |
| 屏幕状态 | 中文、emoji、组合字符、ANSI、vim/top | 跨块、隐藏和恢复后无乱码、错位或状态损坏 |
| 泄漏 | 100 次创建/关闭，周期性记录 | 受管进程全部退出、线程/句柄回基线；RSS 允许分配器保留但稳态不得持续爬升 |
| 主窗口生命周期 | 取消关闭、确认关闭、意外销毁、重建 | 无静默延迟杀进程、无孤儿 PTY、Agent Runtime 语义不变 |
| 项目隔离 | A/B 同时输出，伪造 ID/ACK，删除与创建并发 | 无跨项目输入/输出，越权拒绝，无删除后的新会话 |

性能目标不是已有测量结论。首次报告必须给出具体机器、OS、WebView、依赖版本、shell 配置和 CPU/RSS 测量范围；若目标未达成，记录瓶颈并优化，不能静默下调阈值。

工程检查：

```sh
pnpm check:web
pnpm check:rust
pnpm test:browser
pnpm test:webview
```

- `pnpm check:web`、`pnpm check:rust` 覆盖跨层检查；项目流程明确要求时再执行 `pnpm check`，避免无意义重复整套验证。
- 额外运行新建 terminal 专项基准和真实 Release WebView 场景，具体命令在 Task 7 实施时写回本计划。
- 检查新增单文件行数、lazy chunk、命令 ACL、锁文件与供应链规则；不提交性能采样中的敏感原始终端输出。
- 完成时说明实现范围、实测结果、未验证平台和必要限制；不保留开发服务，不自动提交或发布。

## 8. 官方文档与社区实现依据

以下来源用于上一轮选型，实施前应核对所选固定版本的实际 API；社区实现是参考，不作为无条件正确的模板。

- [Tauri Channels](https://v2.tauri.app/develop/calling-frontend/#channels)：高频有序 Rust 到前端流，避免终端数据使用全局 event 广播。
- [Tauri Channel API](https://docs.rs/tauri/latest/tauri/ipc/struct.Channel.html)：核对 `Channel` 与 `IpcResponse` 的原始响应支持。
- [Tauri calling Rust](https://v2.tauri.app/develop/calling-rust/)：raw request、headers 和命令调用边界。
- [xterm.js Flowcontrol](https://xtermjs.org/docs/guides/flowcontrol/)：`write` 是异步解析入队；使用完成回调、水位及批量 ACK。
- [xterm.js Terminal API](https://xtermjs.org/docs/api/terminal/classes/terminal/)：输入、write、键盘处理、resize、dispose 等接口。
- [xterm.js RenderService 源码](https://github.com/xtermjs/xterm.js/blob/master/src/browser/services/RenderService.ts)：验证不可见渲染暂停，实施时使用固定版本而非依赖 master 行为。
- [portable-pty](https://docs.rs/portable-pty/latest/portable_pty/)：跨平台 PTY 与 shell 生命周期基础。
- [VS Code GPU acceleration](https://code.visualstudio.com/docs/terminal/appearance#gpu-acceleration)：WebGL 优先及 DOM 自动回退的成熟产品实践。
- [VS Code terminal advanced](https://code.visualstudio.com/docs/terminal/advanced)：快捷键与 shell 的分工、进程重连和进程重新启动的区别。
- [tauri-plugin-pty 社区源码](https://github.com/Tnze/tauri-plugin-pty/blob/main/src/lib.rs)：参考 portable-pty 接入；已看到未实现 flow control 参数以及异步入口内阻塞读写，不能原样套用。

## 9. 后续 AI 的启动指令

> 按 `.superwork/plans/project-terminal.md` 实施项目级集成终端。先核对当前代码与 Task 状态，从第一项未完成任务开始；使用项目规定的 TDD 和检查流程，逐项记录证据。遵守本文项目隔离、二进制流、背压、窗口关闭和资源预算契约，不扩展后台持久会话、远程终端或 AI 自动输入。完成所有可验证任务后报告结果与未验证平台，不自动提交，不保留 dev server。
