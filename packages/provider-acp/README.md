# 共享 ACP Provider

Web 与桌面共用官方 SDK 2.8.0 的 ACP v1 实现，握手固定为 `protocolVersion: 1`，不使用 v2 预览入口。基础传输及通用内容使用稳定 `@agentclientprotocol/sdk` 入口；供应商设置、布尔配置、无回放恢复及关闭等可选功能通过 v1 `@agentclientprotocol/sdk/unstable` 类型入口接入，只有 Agent 明确声明后才调用。SDK 包版本与线上协议版本分别管理，不需要为使用 v1 降级 SDK。Web 和桌面都从 ACP Agent 目录按需安装适配器。

Web CLI 通过 `AcpApplicationRuntime` 装配运行时，桌面通过 `acp-host` 和 Tauri IPC 使用同一套实现。Agent 负责会话执行和回放，Codexly 管理项目、任务身份和本地历史投影。

历史恢复使用 ACP v1 的 `session/load` 会话回放，以成功响应作为回放边界。Agent 确认会话被其他客户端占用时，两端进入只读状态并分页展示已提交的 ACP 历史。占用期间只能查看此前同步的内容。释放后重新打开任务可同步历史。 [ACP v1 会话规范](https://agentclientprotocol.com/protocol/v1/session-setup)

实现依据：[v1 初始化](https://agentclientprotocol.com/protocol/v1/initialization)、[v1 回合](https://agentclientprotocol.com/protocol/v1/prompt-turn)、[v1 会话恢复](https://agentclientprotocol.com/protocol/v1/session-setup)和[官方 TypeScript 客户端示例](https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/examples/client.ts)。保持流式背压和能力协商，不自动重试已经提交的 prompt；v1 不提供 v2 后台清单或单项取消。

子会话由父会话的 `subagent_update` 登记。共享宿主随后按原生会话身份分发更新和用户交互，两端在对应主聊天内展开子会话记录。后台子会话可在父 prompt 返回后继续工作，已收到的记录随后台段提交到本地历史。审批使用原始选项，并按同一请求通道回传。 [ACP v1 子会话](https://agentclientprotocol.com/protocol/v1/subagents)

## 接口

- `AcpRuntime`：按项目装配两个共享 Provider，仅实际执行时启动目标 agent；可注入桌面独立程序的启动方式。项目释放等待终态提交并清理进程，已关闭的旧引用拒绝新建任务。辅助生成复用工作区连接且有并发限制；新连接先恢复保存的供应商路由，再创建或加载会话。
- `AcpTaskTitles`：仅为新建且无历史的空名称任务生成一次标题，收到 agent 输出或成功终态后才后台执行，主回合不等待辅助生成。双端读取私有应用偏好，Native 缺记录时从可信应用目录只读旧公共偏好；不调用旧 `generation.title`。目录私有表及触发器限制跨宿主领取，手动更名、归档和删除使在途结果失效，关闭取消并等待回收。只发送最多 1024 个 Unicode 字符的首发正文或附件名，不发送完整附件；已有历史不回填，失败或崩溃后的已领取作业不自动重试。
- `AcpApplicationRuntime`：实现现有 Core 全局运行时端口，向交付层提供 ACP 模型目录、精确默认配置映射、按应用偏好选择引擎的辅助生成及标题生成。仅显式字段可以映射为 ACP 设置；未映射的授权/沙盒枚举拒绝保存。旧账号、插件、技能等专用接口明确拒绝。
- `AcpHost`：桌面共享宿主的 stdio 传输与白名单分发；反向目录请求交给原生仓储，作用域保留应用项目和任务身份。使用 UTF-8 解码器处理拆分字符，入站帧 8 MiB、活动请求 32 项、目录回调 64 项；stdout 流控复用 Core HostOutput。Rust 负责资源准备、进程守卫及原生任务归属校验；桌面客户端已提供认证、默认设置、供应商、历史快照、发送、会话配置、审批、中断及队列接口。附件输入经原生上传授权器和本任务历史引用校验后发送，不接受任意本机路径。
- `AcpQueue`：复用 Core 持久队列和文件仓储，支持列表、入队、编辑、排序、相邻移动、删除及完成后续发。附件引用与编辑状态跨宿主重启恢复；明确未提交时释放占用，响应未知时保留持久标记且不重发。执行使用 agent 已确认的会话配置，不读取旧厂商设置，不转成 steer；下一条在上一回合历史落盘后开始。
- `initializeAcpAgentProxy` / `network-proxy`：两个编译 agent 在导入官方 CLI 前消费应用启动快照，统一 HTTP、SOCKS、继承出口及 fetch；不重新读取项目配置或随 token 初始化。EOF 释放连接池与环回转接，关闭可重复；Bun 兼容 Agent 无 destroy 时仍清理自有转接。
- `AcpAgentService` / `AcpSettingsStore`：提供 ACP 认证、原始 configOptions 和新会话默认值。设置只使用公布值，模型切换后重新校验思考档位；失效默认值保留修正入口。旧记录及未知字段私有保存，不进入公开响应；用户后续选择不会被重复导入覆盖。认证取消回收独立服务连接，设置会话关闭失败不提交新值。文件以 0600 临时文件、同步和原子替换保存，跨宿主写入以独占文件拒绝并发；崩溃残留锁恢复仍待完善。
- `AcpProviderRouting`：仅调用协商后的 `providers/list`、`providers/set` 和 `providers/disable`，不自行查询厂商模型或解析原生配置。校验 agent 公布的 ID/协议，保留完整请求头至私有设置；公开状态只含非敏感路由字段。禁用状态在新连接恢复；保存后提示重启，避免中断运行中的会话。这组可选 API 尚未稳定，需随 SDK 升级独立回归。
- `AcpRuntime.importCatalog(engine)` / `importAcpCatalog`：通过 ACP `session/list` 分页发现原生会话，保留已有应用任务 ID、名称、时间、项目、置顶和归档状态。新发现任务使用引擎隔离的确定性 ID，只按唯一且精确匹配的工作目录关联项目；重试不覆盖管理元数据。目录发现不加载正文、不创建会话，循环游标、任务预算和取消会明确报错；部分成功可从头安全重试。目录当前最多 10 万项、1 万页，已有绑定会一次读入有界映射。Codex 在无认证时会拒绝目录发现，应在该引擎认证就绪后调用，不能将认证错误当作空目录。
- `AcpPermissions`：保留原始授权选项并绑定项目/任务/回合/条目；精确回传 optionId；旧按钮仅兼容单次允许/拒绝，撤销和关闭清理等待。
- `AcpHistory`：逐回合写入 JSONL，以原子指针公开已提交字节；每页最多 20 回合、最多读取 4 MiB。失败重放保留旧版本，游标绑定任务及版本。旧版本清理、崩溃残留写锁恢复尚待生命周期接入。
- `AcpAgentProvider`：两种引擎共用文本回合、新会话绑定、旧会话恢复、流式事件及终态持久化；关闭等待历史提交。已提供临时辅助会话、模型配置发现、会话选项设置与本地任务管理。
- `AcpConnection`：使用官方 SDK 连接消息流，拒绝同会话重叠 prompt；旧会话加载失败直接返回错误，不创建替代会话。握手有超时，prompt 不自动重试。异步投影形成背压，恢复等待 `session/load` 响应，回合等待 `session/prompt` 返回原始 `stopReason`，两者都等待此前投影处理完成。v1 不发送 v2 幂等字段或伪造消息接受回执；本地提交记录继续保护结果未知的发送。缺少消息 ID 时按连续角色段分配局部身份，重放依靠顺序及完整指纹恢复已有身份。
- `AcpProcess`：以独立参数启动配置好的 ACP 可执行程序，使用 stdio；关闭时清理进程树。macOS 已验证，Windows/Linux 需要对应平台验证。
- `AcpEventProjection`：消费 v1 `tool_call` / `tool_call_update` 和 `plan`，Diff 使用 `path`、`oldText`、`newText`，空新正文保持修改语义，不推断删除；将 ACP 更新映射到应用事件；只更新目标条目，显式快照和终态时才复制回合。配置和命令由后续 Provider 消费。
- `bindAcpTask`：保留应用 ID、原引擎和不透明的 session ID；没有历史恢复能力时显式失败。
- `migrateAcpSettings`：保留完整旧配置，只映射 agent 已公布的精确选项。未映射配置可在后续发现能力后重新处理；不推断权限等价关系。本地记录可能含敏感配置，不得进入诊断日志或模型上下文。

## 验证

```sh
pnpm exec vitest run packages/provider-acp/src
pnpm exec tsc -b packages/provider-acp --pretty false
CODEXLY_REAL_RUNTIME_TEST=1 pnpm exec vitest run packages/provider-acp/src/official-agents.test.ts
CODEXLY_REGISTRY_RELEASE_TEST=1 pnpm exec vitest run packages/provider-acp/src/agent-installer.test.ts packages/provider-acp/src/registry-release.test.ts
```

真实 adapter 测试在隔离目录握手并读取供应商列表，验证 Claude 空历史列表与 Codex 未认证的目录拒绝；不创建会话、不调用模型，不能证明实际账号、历史续聊或端到端交互可用。

目录发布测试从内置快照安装官方固定版本，分别验证 npm 和当前平台二进制的真实安装与握手；Ubuntu 额外下载并安装 Junie、Antigravity 的 Linux ZIP。三平台 CI 显式开启 `CODEXLY_REGISTRY_RELEASE_TEST=1`，日常单测只执行离线分发格式和版本一致性校验。更新官方快照时必须同步开发依赖；ZIP 解包不依赖系统 tar 或 unzip，tar 系列仍使用系统 tar，覆盖 Registry 规范中的 ZIP、tar.gz、tgz、tar.bz2、tbz2 及原始二进制。

HTTP 契约：`/v1/acp/agents/:engine`、`/authenticate`、`/defaults`、`/providers` 及 `/v1/projects/:projectId/tasks/:taskId/acp/config`。写入沿用配对认证和幂等键；原始布尔值不经过类型强制转换。桌面通过共享宿主调用同一 Core 服务端口。

当前存储与恢复约束见[领域工程规范](../../.superwork/spec/core/shared/index.md#acp-生产存储与恢复)和[桌面后端工程规范](../../.superwork/spec/desktop/backend/index.md#acp-分发与-macos-支持)。

## 独立宿主与桌面资源

- `pnpm test:acp-host` 编译独立宿主，验证 ACP 传输、目录回调、附件、队列恢复与代理。
- `pnpm build:desktop-runtime` 按 Tauri 目标生成 `acp-host` sidecar 和运行时资源，供桌面开发与发布使用。安装资源包含宿主清单和许可证，Agent 通过应用目录按需安装。
- `node --test tools/desktop-runtime-bundle.test.mjs` 验证当前平台的真实产物。构建器在发布资源前核对路径、架构、宿主协议和文件摘要。

`CODEXLY_ACP_TARGET` 可指定 Tauri 目标三元组。构建使用 pnpm 安装的 Bun，编译后的宿主可独立执行。Tauri 启动宿主时传入可信的应用数据目录，供宿主读取升级用的旧设置。手动验证官方 adapter 握手的命令见上节。

POSIX 原生进程守卫为宿主注入私有 Unix 生命周期连接，独立 agent 模式加载官方 CLI 前必须连接成功；原生回收宿主或进程硬退出时，连接断开，agent 强制回收自己的进程组。通道不传业务数据、不轮询，原生最多持有 64 项连接，断开的项目及时释放容量；连接本身不阻止已完成的 agent 自然退出。Windows 继续使用原生 Job Object。生命周期环境由原生层管理，不是用户配置。

桌面 `createAcpTask(projectId, engine, { idempotencyKey })` 只创建应用目录任务，不启动 agent。调用方必须为同一创建意图保留幂等键；普通聊天使用受控工作区并绑定稳定应用 ID。已绑定工作区在目录写入失败时保留，按同一键重试恢复；未绑定的失败目录仅清理本次分配，既有同名目录不会被接管。遗留绑定目录回收和任务删除的工作区生命周期仍待完整接入。

任务附件存储已提取到 Core，旧 Claude 保留兼容导出与原磁盘布局。ACP 用户消息保存稳定附件引用，可在进程重启后读取正文；桌面 `startAcpPrompt` 使用完整应用附件元数据，经原生校验后转为标准 ACP 内容块。历史预览通过 `buildNativeTaskAttachmentUrl(..., "acp")` 显式选择 ACP 归属校验，旧预览继续兼容旧路径。共享宿主内嵌附件 Worker，编译产物已验证真实读取；设置 / 聊天 UI 的最终装配和旧历史附件迁移仍待完成。

## 应用旧设置的只读导入

`AcpSettingsStore` 可注入 `AcpLegacySettingsSource`，由 `AcpRuntime`、`AcpApplicationRuntime` 和桌面共享宿主传递。尚未导入且未明确配置 ACP 默认值时，首次读取采集旧快照；同一进程的并发读取合并，持锁重查最新记录，失败不写入空快照。已有 legacy 快照或用户明确保存的 ACP 配置优先，重启不会重读并覆盖，旧来源后来损坏也不阻断已配置用户。设置服务在冷启动 agent 前完成该校验，失败不启动 agent。

Native 实际启动传入应用数据目录后，`readAcpLegacyApplicationSettings` 只读 `agent-settings.json` 的 v1 global 遗留智能体字段及 `engines/claude/preferences.json`。公共界面偏好继续由原存储消费，不当作智能体配置；未知字段和原始 false 留在 ACP 私有 legacy。来源策略区分 migrate / preserve：Codex 应用文件的旧副本仅归档，不能覆盖官方 agent 当前配置，也不作为待迁移默认值显示；Claude 应用 preferences 中的现行偏好才按公布选项精确迁移。源文件单次读取沿用 512 KiB 预算，增长、损坏、未知版本及无效 UTF-8 明确失败；原文件逐字节保留。单个配置文件过大时不会静默跳过或写入空的成功标记。

模型、权限、认证与供应商原生文件由官方 agent 使用，此入口不解析 TOML、不读取或复制厂商原生凭据，也不写原生配置。旧值仅在 agent 公布精确可用选项后应用，公开默认值不包含 legacy 原记录。CLI 与桌面宿主分别从受信任的应用目录注入旧设置来源。
