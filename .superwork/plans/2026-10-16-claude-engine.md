# 双引擎实施方案

**Goal:** Web（含移动端）和桌面端可在新聊天选择 Codex 或 Claude，并在同一工作台恢复、执行和审批各自的会话。
**Scope:** 公共协议、应用会话路由、Claude 官方 Agent SDK 适配、原生宿主、配置、中栏能力与测试；保留 Codex App Server 现有执行链路。
**Acceptance:** 新聊天选择正确引擎；历史会话不可改引擎；并行会话、重启恢复、流式消息、工具审批、取消、错误与配置隔离有自动化证明；两端构建与现有回归通过。

## 调研与决策

- [Codex App Server](https://developers.openai.com/codex/app-server)：保留官方 thread/turn/approval 协议及现有原生 Rust 管理，不改为终端文本解析。
- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)：使用官方 TypeScript SDK；它运行与 Claude Code 相同的工具循环、权限与上下文管理。禁止官方 OAuth 登录，仅显式 API Key 和兼容端点。产品入口采用官方建议的 Claude Agent 标签。
- [流式输入](https://code.claude.com/docs/en/agent-sdk/streaming-input)、[审批](https://code.claude.com/docs/en/agent-sdk/user-input)、[会话](https://code.claude.com/docs/en/agent-sdk/sessions)：按会话维护输入、审批与取消生命周期；恢复绑定精确 session ID；完成以 result 为准，不能由 assistant 文本推断。
- [CloudCLI](https://github.com/siteboon/claudecodeui) 与 [Happy](https://github.com/slopus/happy) 是社区第一手多引擎集成参考：复用客户端交互而保留不同引擎的运行边界。只参考公开设计，不复制其代码或登录策略。
- 当前本地目录已以 provider + sessionId 区分执行身份，继续作为唯一任务管理源；不从上游重建目录，不复制完整引擎历史作为第二套执行上下文。
- 公共能力按真实语义收敛：创建、读取、执行、取消、事件、工具审批；Codex 沙盒、Guardian、目标、Review 等保留专属能力。Claude permissionMode 独立于 Codex sandboxMode，不能错误映射或展示不支持的控件。
- 官方 SDK 适配共用一个 TypeScript 包。Web 直接调用；桌面使用按需启动的 stdio 宿主，无 HTTP 端口，Codex 不经过宿主。宿主、SDK 与底层二进制固定版本；回合结束关闭执行进程、空闲适配器有界回收，流式有界，审批与终态及时交付。
- UI 复用编辑器、CompactSelector、附件、消息/工具卡片、按钮与主题。引擎选择属于独立草稿；首次创建后持久化并锁定。模型、权限、命令、工具以引擎能力驱动，分屏隔离。

### Task 1: 贯穿引擎身份并保护会话绑定

**Files:** `packages/protocol/src/`、`packages/core/src/`、两端 catalog 与协议测试。
**Behavior:** 新建请求允许 codex/claude；旧数据缺省 codex；快照保留身份；存储拒绝更换引擎、目录或已绑定 session。
**Proof:** 协议与真实 SQLite 测试；Rust local_catalog 回归。
**Stop Conditions:** 不能保持旧会话身份或迁移兼容时先修复本阶段。

- [x] **Task Status:** completed

### Task 2: 实现官方 Claude SDK 适配与能力契约

**Files:** `packages/provider-claude/`、公共能力与引擎配置协议。
**Behavior:** API Key 隔离、模型/命令发现、流式消息/工具、审批与提问、取消、会话恢复、错误终态；拒绝未支持的 Codex 专有操作。
**Proof:** SDK 边界注入测试、官方二进制握手与本地模拟 API 集成测试。
**Stop Conditions:** SDK 版本或身份/审批协议无法验证时不冒充可用能力。

- [x] **Task Status:** completed

### Task 3: 接通 Web 与桌面执行路由

**Files:** `packages/core/`、`packages/server/`、`src/`、`desktop/src-tauri/`、宿主打包脚本。
**Behavior:** 从仓储身份选择适配器，跨引擎 session 同名不串线；支持配置与重启；桌面复用官方 SDK 宿主并保留 Channel 背压。
**Proof:** HTTP 集成、Rust IPC/进程/ACL 测试、打包验证。
**Stop Conditions:** 不得用仅有前端选择器或未接通的 mock 代替执行支持。

- [x] **Task Status:** completed

### Task 4: 复用中栏并实现能力差异

**Files:** `packages/frontend-core/`、`packages/ui/`、两端 workbench 与 settings。
**Behavior:** 新草稿选择引擎、历史会话只读身份；模型/权限/命令/工具按引擎呈现；切换和分屏保留独立草稿；配置不暴露密钥。
**Proof:** 两端组件与交互测试，Chrome CDP 宽窄屏验收。
**Stop Conditions:** 不得新增第二套编辑器或在用户流程暴露 SDK/IPC 实现细节。

- [x] **Task Status:** completed

### Task 5: 完整验证与更新说明

**Files:** 本方案、相关架构与使用文档。
**Behavior:** 对各阶段记录真实测试结果、失败原因及平台限制，完成回归与构建。
**Proof:** `pnpm test`、`pnpm typecheck`、`pnpm lint:architecture`、`pnpm check`、桌面 `pnpm check:web` / `pnpm check:rust`；交互通过 Chrome CDP。
**Stop Conditions:** 外部服务或平台缺失导致不可执行时明确列出，不宣称通过。

- [x] **Task Status:** completed

## 实施结果与验证记录（2026-10-16）

- 实现路径及当前能力边界见[双引擎说明](../../docs/agent-engines.md)。Claude API 和全局配置统一放设置页；中栏没有配置弹窗。
- 复用审查结果：changed。两端共用引擎选择/能力状态、配置表单、多选提问控件及 Claude SDK 适配包；拆出 HTTP 引擎客户端和原生设置命令，保持 500 行规则。
- 协议、SQLite 不可变绑定、配置、执行/审批生命周期、字节游标历史与前端设置转换均有定向测试。原生提交引擎不匹配用先失败后通过的回归验证，避免先创建错误引擎任务。
- `pnpm check` 完整通过：依赖审计、Codex 0.163.0 协议校验、格式、lint、架构、测试、性能、构建、Web 包预算、实际 npm tarball 检查。最后的生命周期/能力修正另经全量 2715 项测试及定向测试验证。
- 桌面 `pnpm check:web` 通过：549 项测试、ACL/平台约束、现代和 Legacy 构建及包预算。Rust 全量 743 项单元测试通过，另有两组各 3 项终端集成；10 项基准测试默认忽略，其中 `performance:rust` 的 6 项基准另行执行通过。最终 Clippy 无警告。
- `pnpm test:claude-host`：实际独立宿主 + 官方 CLI + 本地模拟 Messages API，验证工具审批、写文件、配置保留、宿主重启、同一 sessionId 两轮执行及历史恢复；不使用真实密钥或模型额度。
- Intel Mac 交叉构建首次下载超时，重试后通过；`file` 确认宿主和 CLI 均为 x86_64。已恢复 arm64 本机产物并重新验证宿主。
- Chrome DevTools MCP/CDP 检查：设置保存/多行工具规则、密钥不回传、新聊天引擎切换、Claude 模型/权限控件、首轮流式结果、历史引擎锁定、页面刷新继续发送、390px 会话和设置页无横向溢出。
- 遵守项目浏览器要求，未另外启动 Playwright/WebKit 浏览器；CDP 交互证据不等同于全量跨浏览器 E2E。
- 未在 Windows/Ubuntu 实机运行安装包，也未做 macOS 发行签名/公证。Windows 解压与摘要校验逻辑有跨平台 Rust 单元测试，但不能代替 Windows 实机验收。此次未发布、未提交 Git。
