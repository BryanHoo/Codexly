# Feature Implementation Plan

**Goal:** 完善桌面突然退出、WebView2 与引擎故障的有界持久诊断。

**Suggested Spec Reads:**

- `.superwork/spec/desktop/backend/index.md` — 原生边界与平台验证。
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — Windows/macOS/Ubuntu 与低占用。

**Architecture:** 保持已有 JSONL 和诊断 ZIP，增加脱敏 stderr 样本、同步应急日志、独立 Windows 退出观察进程和 WebView2 失败监听。原生 unsafe 仅位于平台 crate。

**Tech Stack:** Rust、Tauri 2、WebView2、Windows Process API。

## Global Constraints

- 不记录提示词、凭据或正文；新增内容经过现有脱敏；有界磁盘与事件频率。
- 桌面主 crate forbid unsafe；Web 继续使用既有日志，不引入原生实现。
- 不修改发布版本或其他任务文件；平台专属行为必须区分编译检查与真机验证。

### Task 1: 留存故障和恢复上下文

**Files:**

- Modify: `desktop/src-tauri/src/infrastructure/diagnostics/mod.rs`
- Modify: `desktop/src-tauri/src/infrastructure/diagnostics/emergency.rs`
- Modify: `desktop/src-tauri/src/infrastructure/codex/stderr.rs`
- Modify: `desktop/src-tauri/src/infrastructure/codex/process.rs`
- Modify: `desktop/src-tauri/src/application/task_subscription_commands.rs`

**Interfaces:**

- Consumes: 现有 DiagnosticEvent / Tauri 生命周期。
- Produces: 兼容现有导出的脱敏 JSONL 事件。

**Behavior:**

- 记录脱敏非 JSON stderr、子进程退出状态、上次会话身份、任务订阅阶段；应急文件有界且独立落盘。

**Stop Conditions:**

- Windows API 或依赖版本不兼容时先解决编译，不声称真机通过。

- [ ] **Task Status:** completed

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml infrastructure::diagnostics --lib`

Expected: 定向诊断测试通过；另运行平台构建与全局检查。

### Task 2: 捕获 Windows 与 WebView2 突然退出

**Files:**

- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src-tauri/native/windows-process-platform/src/lib.rs`
- Modify: `desktop/src-tauri/native/windows-process-platform/src/diagnostics.rs`
- Modify: `desktop/src-tauri/native/windows-process-platform/Cargo.toml`
- Modify: `desktop/src-tauri/src/infrastructure/diagnostics/windows.rs`

**Interfaces:**

- Consumes: 现有 DiagnosticEvent / Tauri 生命周期。
- Produces: 兼容现有导出的脱敏 JSONL 事件。

**Behavior:**

- 独立观察宿主退出码，监听 WebView2 ProcessFailed；所有文件由既有 ZIP allowlist 导出。

**Stop Conditions:**

- Windows API 或依赖版本不兼容时先解决编译，不声称真机通过。

- [ ] **Task Status:** completed

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml infrastructure::diagnostics --lib`

Expected: 定向诊断测试通过；另运行平台构建与全局检查。

### Task 3: 验证并记录运维方法

**Files:**

- Modify: `docs/desktop-crash-diagnostics.md`

**Interfaces:**

- Consumes: 现有 DiagnosticEvent / Tauri 生命周期。
- Produces: 兼容现有导出的脱敏 JSONL 事件。

**Behavior:**

- 记录官方依据、能力边界、Windows 故障注入及 WER dump 操作。

**Stop Conditions:**

- Windows API 或依赖版本不兼容时先解决编译，不声称真机通过。

- [ ] **Task Status:** completed

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml infrastructure::diagnostics --lib`

Expected: 定向诊断测试通过；另运行平台构建与全局检查。

## 验证与交接

- RED：新增应急 journal 轮转测试在实现前因缺失 append 失败（/tmp/crash-red.log）；随后实现轮转并验证 GREEN。
- 主库全特性测试已执行；新增覆盖无析构进程退出后的落盘、崩溃文件导出、stderr 脱敏限量与子进程 exit 47 原值记录。
- Windows 原生平台 crate 的 x86_64-pc-windows-msvc check / Clippy 通过。完整桌面 Windows 交叉构建因本机缺少 MSVC SDK/C 头文件，在 aws-lc-sys 失败，尚无 Windows 真机注入证据。
- 13 项相关原生约束测试：12 通过，1 项 Windows 安装器真机测试按平台跳过。
- source-lines 检查有两项既有失败：tests/e2e/app-shell-settings-connection.spec.ts 504 行、tests/e2e/fixtures/app-shell-api-core.ts 501 行；本任务未修改这些文件。
- 简化审查 changed：抽取子进程退出观察函数，避免 Drop 先 abort stderr；WebView 监听按窗口替换与销毁，防止重载累积。
- 规范 update：desktop/backend 索引新增崩溃边界与验证要求，链接 docs/desktop-crash-diagnostics.md 官方依据和操作步骤。
- 未发布、未提交；保留本任务登记，直到 Windows 真机故障注入和既有检查门禁问题得到验证/处理。

### 最终证据（仓库根目录）

- `cargo test --manifest-path desktop/src-tauri/Cargo.toml --all-features --locked`：最终实现后 819 主测试通过、9 项既有忽略；两个平台集成套件各 3 项通过。见 /tmp/crash-final-verification.log。
- `cargo clippy --manifest-path desktop/src-tauri/Cargo.toml --all-targets --all-features --locked -- -D warnings`：最终 Rust 修改后通过。见 /tmp/crash-final-lint.log。
- Windows 原生 crate `cargo clippy --target x86_64-pc-windows-msvc --tests -- -D warnings` 通过；原生测试仅编译，尚未在 Windows 执行。以 /tmp 临时 probe crate 编译真实 diagnostics/windows.rs 与 Tauri 2.12.5，最终 `cargo clippy --target x86_64-pc-windows-msvc -- -D warnings` 通过，验证宿主接入与 COM 类型兼容；未替代整个 Windows 应用构建。
- Release `performance_baseline` 6 项通过（/tmp/crash-performance.log）。复用边界：编译开始后的变更仅涉及不被这六项工作区/Git/图片基线调用的 Windows 诊断、应急写盘策略及测试；六项实现和 fixture 未改，且基线不初始化应急日志，因此本次性能证据对该范围仍有效，不据此声称测量过 Windows 观察进程 RSS。
- `cargo fmt` 两个 crate 通过；`git diff --check` 和三份 Markdown 的 Prettier check 通过。
- 变更仅涉及 Rust 与说明文档，未修改 Web/桌面 TS、UI、协议或 ACL；未扩展执行浏览器交互套件。
- Windows 真机待运行文档中的正常关闭、强杀宿主/引擎、WebView2 失败及异常注入；此限制和两项既有 source-lines 失败继续保留在本任务公告中。
