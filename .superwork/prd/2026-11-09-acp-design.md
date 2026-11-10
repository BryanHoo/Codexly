# ACP 全量迁移设计

## Goal

将 Codexly 的 Web（含移动浏览器）与 macOS、Windows、Ubuntu 桌面 agent 执行统一到 ACP。应用只消费 ACP；厂商协议、SDK、配置文件解析和原生历史解释由官方 ACP adapter 负责。历史任务可查看并继续，不丢失用户配置。

## Suggested Spec Reads

- `.superwork/spec/guides/index.md`
- `.superwork/spec/guides/code-reuse-thinking-guide.md`
- `.superwork/spec/guides/cross-layer-thinking-guide.md`
- `.superwork/spec/guides/cross-platform-thinking-guide.md`
- `.superwork/spec/core/shared/index.md`
- `.superwork/spec/protocol/shared/index.md`
- `.superwork/spec/frontend-core/shared/index.md`
- `.superwork/spec/ui/shared/index.md`
- `.superwork/spec/server/backend/index.md`
- `.superwork/spec/desktop/backend/index.md`
- `.superwork/spec/desktop/frontend/index.md`

用户要求替代原有规范中直接访问 Codex RPC、Claude SDK 的执行及配置边界；原有存储身份、权限、性能和双端一致性约束继续适用。

## Existing context

现有 Web 通过 Core AgentProvider 使用两个专用 Provider；桌面 Codex 使用 Rust 直接连接 App Server，Claude 使用共享 TypeScript stdio 宿主。任务目录共享于 ~/.codexly，应用任务 ID 与原生 session ID 已分离。不得用 ACP session ID 覆盖应用 ID。初始工作区无未提交更改，无其他并行任务。

## Official references

2026-11-09 核对官方 ACP 文档、TypeScript SDK 示例和 npm 元数据：

- https://agentclientprotocol.com/llms.txt
- https://agentclientprotocol.com/protocol/initialization
- https://agentclientprotocol.com/protocol/session-setup
- https://agentclientprotocol.com/protocol/session-config-options
- https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/examples/client.ts
- https://github.com/agentclientprotocol/codex-acp
- https://github.com/agentclientprotocol/claude-agent-acp

固定正式版本：@agentclientprotocol/sdk 2.4.0、@agentclientprotocol/codex-acp 2.6.0、@agentclientprotocol/claude-agent-acp 0.101.0。核心聊天使用稳定 ACP v1，拒绝依赖 draft v2。供应商地址与请求头配置使用官方 v1 可选草案 providers/list、providers/set、providers/disable，必须经 agentCapabilities.providers 协商；这组接口尚未稳定，固定版本并保持独立回归。SDK 按随包 MIGRATION_STABLE_UNSTABLE.md 的要求统一使用 /unstable 入口启用 v1 可选能力，不能混用两种入口。Codex adapter 自行携带兼容 Codex；应用不再直接依赖 Codex SDK。

2026-11-09 补充核对：https://agentclientprotocol.com/rfds/custom-llm-endpoint 、https://github.com/agentclientprotocol/registry/blob/main/agent.schema.json 、https://github.com/agentclientprotocol/claude-agent-acp/blob/main/docs/model-configuration.md 。通用供应商能力在 SDK 的稳定入口中会被过滤，不能自行给旧字段加类型断言假装完成协商。请求头只保存在私有本地设置，公开列表只转发 agent 的非敏感路由状态；每个新 agent 连接在创建会话前恢复保存的配置，失败不回退旧厂商接口。

## Recommended approach

1. 两端各写 ACP 客户端：原生运行简单，但重复协议与事件实现，放弃。
2. 旧 Provider 外套 ACP：改动少，但保留厂商适配和双重配置，违反目标，放弃。
3. 共享 TypeScript ACP 客户端与 Provider：Web 直接装配，桌面通过独立宿主与 Tauri IPC 使用同一实现，采用。

## Responsibilities and interfaces

- 新 `packages/provider-acp`：官方 SDK stdio 连接、能力协商、会话生命周期、配置、权限请求及更新投影。用显式 command/args/env 启动官方 adapter，不拼 shell 命令，不运行动态 npx 安装。
- Core 保留应用任务、队列、目录和业务规则；ACP session binding 记录任务原引擎及原生会话 ID。应用不会把连接中断重试成第二次 prompt。
- Protocol 暴露引擎无关 ACP 设置与能力快照；配置选择项、命令、模型、推理及权限来自 agent 返回数据。未知类型忽略，agent 默认值继续生效。
- 新会话 session/new，旧会话 session/load 重放历史；只有明确支持时使用 session/resume。load 失败保持原任务，不静默 new。本地历史读取不得破坏旧文件。
- 运行时只协商实际实现的客户端能力。未实现的文件和终端能力不宣称支持，让 agent 自行执行。权限请求通过 UI 明确选择 ACP optionId；退出和取消清理待处理请求。
- 每个 session 同时只接受一个 prompt；流式更新直接增量进入应用事件链路，结束后才提交终态历史；不逐 token 写 SQLite 或重建全历史。
- 桌面 sidecar 使用共享实现；Rust 只管理进程、IPC、存储和平台能力，不解释厂商协议。Web 和桌面共用配置 UI 与输入框选择器。

## Migration and errors

迁移必须幂等、保留旧配置副本及未知字段；仅在 agent 公布对应 option 时应用明确等价值，不猜测权限含义。敏感环境不写日志。历史原始数据保持原位置，ACP adapter 复用原生历史目录；绑定与用户管理元数据保持稳定。断线、认证失败、加载失败与不支持能力分别反馈，禁止伪造成功或通过新建会话掩盖历史缺失。

## Verification strategy

每个代码切片使用 Superwork TDD，真实 SDK agent/client 内存传输验证握手、事件、权限、取消、恢复及并发；子进程测试验证 stdio 与退出清理。迁移测试覆盖重复运行、未知配置、旧 session ID 和失败保留。之后验证 Core Provider、HTTP、桌面宿主、双端配置/输入框浏览器测试。运行根测试、类型、架构、格式、构建、性能预算与桌面检查，实际记录未通过项。测试替身不等于真实账号端到端验证。

## Non-goals

不重写 Git、文件编辑器、主题或通知系统；不替 ACP 实现厂商 RPC，不迁移模型供应商账号，不自动上传历史。

## Success criteria

生产执行链路只有 ACP；移除专用 Provider 与直接 SDK 依赖。双端支持配置、文本/附件输入、流式消息、工具、计划、审批、取消和历史续聊。旧任务及设置迁移可重跑、不丢数据；验证记录完整，无未披露失败。

## Self-review

已核对任务身份、双端执行链路、稳定协议版本、动态配置与失败保护；未把协议草案当作稳定 API。实现期间按安装包实际声明校验方法签名，发现差异先修订计划。
