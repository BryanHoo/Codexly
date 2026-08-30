# 共享质量规范

## Purpose

Capture contract and verification standards for this project.

## 规则

- 协议变更同时更新 TypeBox schema、类型导出、序列化/解码逻辑和消费者测试。
- 升级固定 Codex 版本时，同步更新版本常量、catalog/lockfile 和真实 App Server Schema 基线；对新增通知与联合类型逐项映射或显式 opt-out，不使用旧协议兼容回退。
- `StartAgentTurnResponse` 必须包含启动前捕获的 `EventCheckpoint`，确保首轮乐观 Snapshot 与后续事件回放之间无缺口。
- 保持依赖方向：`protocol` 独立；`core` 仅依赖 `protocol`；`client` 不依赖服务端运行时。
- 使用 `pnpm run lint:architecture` 检查循环依赖、越层导入和包边界。
- 不保留废弃契约的兼容分支；按新契约更新全部仓库内消费者并删除旧逻辑。
- `AgentMcpServer.tools` 传递稳定排序且不重复的可用工具名；消费者通过数组长度派生数量，不额外维护 `toolCount`。
- `AgentGlobalSettings.pet` 使用严格联合契约：关闭时允许 `selectedPetId` 为空，开启时必须提供非空 `selectedPetId`。
- 宠物资产以 SHA-256 内容标识寻址；下载和自定义资产加载必须校验路径边界、文件类型、尺寸和清单结构。
