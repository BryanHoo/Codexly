# Codex 156 升级评估

## 版本与依据

- 评估日期：2026-09-23。
- 旧基线：`rust-v0.154.0`。
- 新基线：`rust-v0.156.0`，commit `fe74a774532af67b5a4a3dec03ce9469e17f89af`；本地 `/Users/bryanhu/Develop/person/codex` 已切换到该 tag，源码干净。
- 应用私有运行时仅接受 `codex-cli 0.156.0`，不扫描或回退全局 CLI。
- 官方依据：[App Server](https://developers.openai.com/codex/app-server/)、[更新日志](https://developers.openai.com/codex/changelog/)、[0.156.0 tag 源码](https://github.com/openai/codex/tree/rust-v0.156.0)。精确协议以 tag 源码和对应 CLI 生成结果为准。

## 协议结论

| 上游变化 | 项目处理 |
| --- | --- |
| `UserInput::Image` 新增 `fileId` 形式 | `fileId` 无法通过本地 asset protocol 读取，也没有对应下载接口；历史映射降级为 `[图片]`，不暴露远程 ID，不伪造本地附件。 |
| `thread/attachment/*` 与 `thread/attachment/updated` | 该 API 保存任意线程元数据，不是用户消息附件。当前产品不使用，在初始化中关闭通知，避免无效 JSONL 传输。 |
| `PluginDetail.onboardingSkill` | 合并进现有只读 Skills 列表并按名称去重，不增加 IPC 类型、前端分支或额外请求。 |
| `userVerification/*` 新增设备验证实现 | 源码仅对 `codex-tui` 与 `Codex Desktop` 启用。Codexly 桌面端保持真实客户端身份，继续把验证请求安全降级为不支持。 |
| `memory/status`、`rollout/compress`、`userVerification/cancel` | 现有记忆开关、线程压缩与请求取消流程不依赖这些新接口，不新增重复产品入口。 |
| `disabledPluginIds`、MCP UI、访问计划等新字段 | 响应采用宽松投影，未消费字段不进入 WebView；不增加热路径序列化负载。 |
| `thread/rollback` 删除 | 项目未调用该方法，无迁移代码。 |
| 无订阅线程卸载 | 0.156 tag 源码默认值仍为 60 秒；沿用服务端行为，不增加轮询或客户端定时器。 |

## 分发与性能

- 更新 Darwin arm64/x64、Linux arm64/x64、Windows arm64/x64 六个平台的官方 npm URL 与 SHA-512 integrity。
- 不升级 `package.json` 或 `Cargo.toml` 第三方库；本次依赖是固定 Codex 二进制分发和实验协议契约。
- 保留镜像优先、官方回退、流式下载/哈希、有界解压和原子安装；正常启动不联网查询新版本。
- Schema 仅用于离线契约验证，不进入前端包；0.154 快照由 0.156 快照替代，历史版本可从 Git 恢复。

## 验证边界

本机验证当前 macOS 架构的真实下载、完整性校验和 app-server 生命周期；其他平台执行留给现有跨平台 CI。生命周期冒烟不启动模型生成，也不证明设备验证、远程文件下载或 MCP App UI 已具备产品链路。
