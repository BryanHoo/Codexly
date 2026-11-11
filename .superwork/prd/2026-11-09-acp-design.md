# ACP 全量迁移设计

## Goal

将 Codexly 的 Web（含移动浏览器）与 macOS、Windows、Ubuntu 桌面 agent 执行统一到 ACP。应用只消费 ACP；厂商协议、SDK、配置文件解析和原生历史解释由官方 ACP adapter 负责。历史任务可查看并继续，不丢失用户配置。

用户追加约束：运行新版本不能使旧版本因配置或共享数据变化而报错、无法运行。ACP 原始配置只写独立命名空间，旧配置导入只读复制；不把新控件类型 / 枚举写入旧设置字段，不破坏原任务绑定与旧历史，不以破坏性数据库升级换取迁移完成。先固定迁移前 v0.53.0 的实际读取契约及来源提交，验证旧读取端在新版写入后继续可用；更早版本和真实账号原生历史格式须分别验证，不能外推为任意历史版本保证。

草稿入口由应用 capabilities.runtime=acp 明确激活；已有任务在快照尚未返回时也遵循该标识，不临时加载旧引擎配置。配置、发送和恢复共用同步互斥，正文仍使用原输入框；sessionStorage 的 acp-draft:v1 独立记录原始配置、请求指纹和稳定创建身份，未知结果不自动重发。可选引擎记忆使用 acp-engine-draft:v1，旧 engine-draft:v1 只读导入。身份校验失败不能通过预览重试清空记录。HTTP / 原生预览及创建复用现有项目根和 Git 工作树授权，不能直接接受任意 cwd；临时工作区仍由应用分配。

草稿预览只证明没有创建应用任务、且关闭了临时 ACP 连接会话；不能把 session/close 当作删除官方历史的保证。空预览会话是否保留及真实认证会话的行为须独立验收，生产装配在快照、捕获、定时任务和认证消费者迁移完成后统一切换。协议依据为固定 ACP v1 的 [Session Setup](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/session-setup.mdx)。

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

## ACP 任务快照和首屏接管

任务快照以 runtime=acp 明确区分新协议分支，并禁止旧 settings；旧分支继续严格要求原设置。此字段属于 HTTP / 原生交付契约，不进入共享目录或旧配置。两端复用现有 Store、事件和历史分页，元数据保留运行时身份，迟到旧设置不能写回 ACP 快照。

新草稿首发后必须读取一次权威 ACP 快照，再把该次快照与 checkpoint 一起交接缓存。不能将稍晚的 checkpoint 配给较早的提交回合，否则可能丢失边界内输出或审批。读取失败保留原幂等身份供重试；旧提交记录与原生私有账本不新增交接快照字段。原生通用读取与能力的生产切换、捕获 / 调度及认证 UI 仍待完成，真实账号和旧 GUI 回退仍属于最终验收。

## 定时任务配置的回退兼容

旧 Web 计划保存为 SQLite JSON，旧桌面计划保存为带 schemaVersion 的文件，均严格依赖旧 turnOptions。ACP 原始选项单独保存在同一应用数据库的 acp_scheduled_configs 表，使用来源和原计划 ID 作为联合键，不向旧计划添加新字段或升级旧目录版本。两端共用 SQL，读写边界只允许有界字符串或布尔值，使用 expectedRevision 校验并发覆盖，限制记录数和总容量；损坏值不得回退为全局默认值。

Web 仅在 runtime=acp 时使用单独保存的配置执行已有计划，复用持久提交认领和附件恢复，ACP 分支不列旧模型、不写旧设置。已确认的运行先重放结果，再考虑当前配置和目录，收尾不能重新计算新计划的指纹或重新发送 prompt。未知结果禁止重发。

桌面在存在显式 desktop 配置时进入 ACP 启动链路，复用稳定创建身份和 native_acp_submissions。prepare 先保存原始指纹及未发送状态，现有 prompt.start 再原子占用发送；inspect 仅读取阶段元数据并核对任务归属，不替换指纹、清除占用或取回完整正文。完成阶段优先恢复任务 ID；未知结果在旧 JSON 投影为 failed 并停用计划，新版本通过私有阶段阻止自动及手工重复发送。旧 schemaVersion 和四种枚举保持，恢复仅查询相关中断 / 失败运行，不增加后台轮询。新 ACP 计划的独立保存与内容 / 规则编辑、删除关联和生产切换仍需接入，不能提前宣告完整调度已迁移。

已有计划的 ACP 配置由共享界面单独编辑，不挂载旧 Composer，也不改旧 turnOptions。首次配置必须明确选择智能体并确认，不能自动推断旧权限的 ACP 含义。预览使用项目授权目录，在调度状态锁之外调用 ACP；保存前后均核对项目、运行占用和配置修订。相同落盘值可直接确认，以恢复响应丢失后的提交；不同内容要求 CAS。打开弹窗重新读取最新修订，草稿不被后台读取重置；失败重试复用请求身份，关闭及引擎切换丢弃迟到预览。配置未确认或运行结果未知时禁止新运行，原任务入口继续可用。现阶段明确 ACP 模式下不提供旧新建入口；旧运行时保持原入口与表单，待新计划私有存储完成后替换。

删除配置回收采用与存储一致的提交边界：Web 从原快照中确认本次删除的 ID，在同一 SQLite 事务移除对应 web 配置；不能按全体“未出现在旧计划列表”的 ID 清扫。桌面先写私有清理意图（来源、ID、修订），再原子发布原格式 JSON，成功后事务清理配置和意图；失败不提前丢弃配置。恢复只处理有限意图，仍在计划列表的取消标记、已删除的按原修订清理，较新值保留。清理故障不回滚已成功删除的 JSON，保留意图等待重启或后续删除。旧 schemaVersion / user_version 及历史任务均保持。
