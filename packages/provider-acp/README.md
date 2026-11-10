# ACP 共享接入基础

本包使用官方 `@agentclientprotocol/sdk/unstable` 的 ACP v1 入口：核心聊天采用稳定 v1，供应商设置仅在协商支持后调用官方可选草案 `providers/*`。SDK 和两个 adapter 固定版本；不使用 draft v2。Codex 与 Claude 的厂商协议由官方 ACP adapter 管理。

当前已实现连接握手、会话创建/加载、prompt、取消、权限转发、配置选项设置、子进程生命周期、任务身份与配置迁移纯逻辑，以及文本、思考、工具和计划的增量事件投影。

已提供共享 `AcpAgentProvider`、`AcpHistory` 分页投影、独立桌面宿主与原生桥接，尚未切换生产 CLI、桌面聊天、设置界面或输入框，不能将其视为已完成的迁移。已接入普通文件、图片和文本附件输入、审批后端、全局认证/默认设置服务及 HTTP/Client 契约；技能输入、审批 UI 和生产迁移事务仍待接入。尚未迁移真实用户数据。

## 接口

- `AcpRuntime`：按项目装配两个共享 Provider，仅实际执行时启动目标 agent；可注入桌面独立程序的启动方式。项目释放等待终态提交并清理进程，已关闭的旧引用拒绝新建任务。辅助生成复用工作区连接且有并发限制；新连接先恢复保存的供应商路由，再创建或加载会话。
- `AcpApplicationRuntime`：实现现有 Core 全局运行时端口，向交付层提供 ACP 模型目录、精确默认配置映射、按应用偏好选择引擎的辅助生成及标题生成。仅显式字段可以映射为 ACP 设置；未映射的授权/沙盒枚举拒绝保存。旧账号、插件、技能等专用接口明确拒绝，交付层和界面必须迁移到 ACP 服务，不能直接用它替换旧生产装配后宣称兼容完成。
- `AcpHost`：桌面共享宿主的 stdio 传输与白名单分发；反向目录请求交给原生仓储，作用域保留应用项目和任务身份。使用 UTF-8 解码器处理拆分字符，入站帧8MiB、活动请求32项、目录回调64项；stdout 流控与旧宿主共用 Core HostOutput。Rust 负责资源准备、进程守卫及原生任务归属校验；桌面客户端已提供认证、默认设置、供应商、历史快照、发送、会话配置、审批、中断及队列接口。附件输入经原生上传授权器和本任务历史引用校验后发送，不接受任意本机路径。生产资源和聊天消费者尚未切换，技能仍明确拒绝。
- `AcpQueue`：复用 Core 持久队列和文件仓储，支持列表、入队、编辑、排序、相邻移动、删除及完成后续发。附件引用与编辑状态跨宿主重启恢复；明确未提交时释放占用，响应未知时保留持久标记且不重发。执行使用 agent 已确认的会话配置，不读取旧厂商设置，不转成 steer；下一条在上一回合历史落盘后开始。Web 生产队列装配、旧记录迁移及完整删除生命周期仍待接管。
- `initializeAcpAgentProxy` / `network-proxy`：两个编译 agent 在导入官方 CLI 前消费应用启动快照，统一 HTTP、SOCKS、继承出口及 fetch；不重新读取项目配置或随 token 初始化。EOF 释放连接池与环回转接，关闭可重复；Bun 兼容 Agent 无 destroy 时仍清理自有转接。旧 Claude 代理模块只重导出此实现，生产旧导入随最终切换移除。
- `AcpAgentService` / `AcpSettingsStore`：提供 ACP 认证、原始 configOptions 和新会话默认值。设置只使用公布值，模型切换后重新校验思考档位；失效默认值保留修正入口。旧记录及未知字段私有保存，不进入公开响应；用户后续选择不会被重复导入覆盖。认证取消回收独立服务连接，设置会话关闭失败不提交新值。文件以 0600 临时文件、同步和原子替换保存，跨宿主写入以独占文件拒绝并发；崩溃残留锁恢复仍待完善。
- `AcpProviderRouting`：仅调用协商后的 `providers/list`、`providers/set` 和 `providers/disable`，不自行查询厂商模型或解析原生配置。校验 agent 公布的 ID/协议，保留完整请求头至私有设置；公开状态只含非敏感路由字段。禁用状态在新连接恢复；保存后提示重启，避免中断运行中的会话。这组 v1 草案 API 尚未稳定，需随 SDK 升级独立回归。
- `AcpRuntime.importCatalog(engine)` / `importAcpCatalog`：通过 ACP `session/list` 分页发现原生会话，保留已有应用任务 ID、名称、时间、项目、置顶和归档状态。新发现任务使用引擎隔离的确定性 ID，只按唯一且精确匹配的工作目录关联项目；重试不覆盖管理元数据。目录发现不加载正文、不创建会话，循环游标、任务预算和取消会明确报错；部分成功可从头安全重试。目录当前最多10万项、1万页，已有绑定会一次读入有界映射。Codex 在无认证时会拒绝目录发现，应在该引擎认证就绪后调用，不能将认证错误当作空目录。此入口尚未接入生产 CLI。
- `AcpPermissions`：保留原始授权选项并绑定项目/任务/回合/条目；精确回传 optionId；旧按钮仅兼容单次允许/拒绝，撤销和关闭清理等待。
- `AcpHistory`：逐回合写入 JSONL，以原子指针公开已提交字节；每页最多 20 回合、最多读取 4 MiB。失败重放保留旧版本，游标绑定任务及版本。旧版本清理、崩溃残留写锁恢复尚待生命周期接入。
- `AcpAgentProvider`：两种引擎共用文本回合、新会话绑定、旧会话恢复、流式事件及终态持久化；关闭等待历史提交。已提供临时辅助会话、模型配置发现、会话选项设置与本地任务管理；尚未满足生产运行时的完整能力契约。
- `AcpConnection`：使用官方 SDK 连接消息流，拒绝同会话重叠 prompt；旧会话加载失败直接返回错误，不创建替代会话。握手有超时，prompt 不自动重试。异步投影形成背压，加载和 prompt 返回前等待投影完成。
- `AcpProcess`：以独立参数启动配置好的 ACP 可执行程序，使用 stdio；关闭时清理进程树。macOS 已验证，Windows/Linux 需要对应平台验证。
- `AcpEventProjection`：将 ACP 更新映射到应用事件；只更新目标条目，显式快照和终态时才复制回合。配置和命令由后续 Provider 消费。
- `bindAcpTask` / `selectSessionOperation`：保留应用 ID、原引擎和不透明的 session ID；没有历史恢复能力时显式失败。
- `migrateAcpSettings`：保留完整旧配置，只映射 agent 已公布的精确选项。未映射配置可在后续发现能力后重新处理；不推断权限等价关系。本地记录可能含敏感配置，不得进入诊断日志或模型上下文。

## 验证

```sh
pnpm exec vitest run packages/provider-acp/src
pnpm exec tsc -b packages/provider-acp --pretty false
CODEXLY_REAL_RUNTIME_TEST=1 pnpm exec vitest run packages/provider-acp/src/official-agents.test.ts
```

真实 adapter 测试在隔离目录握手并读取供应商列表，验证 Claude 空历史列表与 Codex 未认证的目录拒绝；不创建会话、不调用模型，不能证明实际账号、历史续聊或端到端交互可用。

HTTP 契约：`/v1/acp/agents/:engine`、`/authenticate`、`/defaults`、`/providers` 及 `/v1/projects/:projectId/tasks/:taskId/acp/config`。写入沿用配对认证和幂等键；原始布尔值不经过类型强制转换。桌面将消费同一 Core 服务端口，不能绕行这些 HTTP 路由。

执行计划见 [ACP 迁移计划](../../.superwork/plans/2026-11-09-acp.md)，官方依据及目标架构见 [迁移设计](../../.superwork/prd/2026-11-09-acp-design.md)。

## 独立宿主开发验证

运行 `node tools/build-acp-host.mjs` 构建到 `.artifacts/acp/acp-host`（Windows 带 `.exe`），同时生成包含目标平台、架构、官方包版本与 SHA-256 的清单。`CODEXLY_ACP_TARGET` 可指定 Tauri 目标三元组；只有本机目标会执行版本探测。构建依赖 pnpm 已批准安装的 Bun，成品不需要 Node 或 Bun。

成品普通模式接收三个绝对路径参数：私有 ACP 数据目录、Codex 原生程序、Claude 原生程序。`--acp-agent codex` 和 `--acp-agent claude` 模式直接进入官方 ACP CLI，分别使用官方 `CODEX_PATH` 与 `CLAUDE_CODE_EXECUTABLE` 指定随包原生程序。

`CODEXLY_COMPILED_ACP_HOST=/absolute/acp-host node --test tools/acp-host.test.mjs` 验证真实独立程序目录回调与 EOF。为官方 adapter 测试额外设置 `CODEXLY_REAL_RUNTIME_TEST=1`、两个原生程序覆盖环境和 `CODEXLY_COMPILED_ACP_HOST`，即可让 `official-agents.test.ts` 改用编译后的两个 agent 模式；仍不发送模型请求。

## 完整运行包开发验证

`node tools/build-acp-runtime.mjs /absolute/new-directory` 构建共享宿主、两个原生程序、Codex 完整官方 vendor 子树和许可证。默认目标目录为 `.artifacts/acp-runtime/<platform>-<arch>`，指定目录必须尚不存在；构建在相邻暂存目录完成，校验成功才原子发布。此命令尚未替换生产 `build:desktop-runtime`，不会安装或更新用户运行时。

构建器从对应 adapter 实际依赖解析原生版本，按官方 `codex-package.json` 获取入口与辅助目录，不猜测旧目录结构。交叉目标下载使用锁文件 SHA-512 校验；当前仅实际验证 macOS arm64，Windows、Linux 和 macOS Legacy 尚待验证。

统一 `manifest.json` 包含平台、架构、宿主协议、原生版本、相对入口及完整文件摘要表。`verifyAcpRuntime` 在签名前流式核对全部字节，拒绝路径逃逸、异常符号链接、丢失辅助目录、错误目标或协议及摘要不一致。macOS 签名可能改变二进制字节，安装后须依赖安装签名和受控路径，不能将签名前摘要作为启动校验或每次重新扫描大文件。运行包不包含用户认证、原生配置或会话数据。

`node --test tools/acp-runtime-layout.test.mjs` 验证布局与摘要约束；编译宿主测试和官方 adapter 握手可以直接使用完整运行包里的宿主及原生路径。

POSIX 原生进程守卫为宿主注入私有 Unix 生命周期连接，独立 agent 模式加载官方 CLI 前必须连接成功；原生回收宿主或进程硬退出时，连接断开，agent 强制回收自己的进程组。通道不传业务数据、不轮询，原生最多持有64项连接，断开的项目及时释放容量；连接本身不阻止已完成的 agent 自然退出。Windows 继续使用原生 Job Object。生命周期环境由原生层管理，不是用户配置；统一宿主的生产启动和跨平台故障注入仍待验收。

桌面 `createAcpTask(projectId, engine, { idempotencyKey })` 只创建应用目录任务，不启动 agent。调用方必须为同一创建意图保留幂等键；普通聊天使用受控工作区并绑定稳定应用 ID。已绑定工作区在目录写入失败时保留，按同一键重试恢复；未绑定的失败目录仅清理本次分配，既有同名目录不会被接管。遗留绑定目录回收和任务删除的工作区生命周期仍待完整接入。

任务附件存储已提取到 Core，旧 Claude 保留兼容导出与原磁盘布局。ACP 用户消息保存稳定附件引用，可在进程重启后读取正文；桌面 `startAcpPrompt` 使用完整应用附件元数据，经原生校验后转为标准 ACP 内容块。历史预览通过 `buildNativeTaskAttachmentUrl(..., "acp")` 显式选择 ACP 归属校验，旧预览继续兼容旧路径。共享宿主内嵌附件 Worker，编译产物已验证真实读取；设置 / 聊天 UI 的最终装配和旧历史附件迁移仍待完成。
