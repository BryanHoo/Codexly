# `@codexly/provider-claude`

维护 Claude Agent SDK 的执行适配、原生配置、会话恢复、审批与提问、工具结果投影、分叉、压缩和可见历史摘要检索。

同一适配器用于 Web 服务与桌面独立 stdio 宿主；移动浏览器通过 Web 服务访问，不在设备上运行 SDK。桌面安装包内置宿主与目标平台运行时，macOS Legacy 不提供 Claude。

应用任务 ID 与 Claude session ID 分开管理，已有任务的 provider 绑定不可变。凭据与用户设置以 Claude 原生配置为准，不复制 Codex 的沙盒或模型能力，不要求仅使用 Claude 的用户配置 Codex。

本包实现 Core 端口，不依赖 Server、Client 或 Web UI。能力、配置来源及验证见[智能体引擎参考](../../docs/agent-engines.md)；宿主分发见[桌面运行时](../../desktop/docs/provider-runtime-management.md)。
