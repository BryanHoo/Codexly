# 更新日志

本文件记录 Codexly 的重要版本变化。版本号遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

## [0.1.0] - 2026-08-24

### 新增

- 添加 Codex 官方账号快速模式、细粒度审批策略和通知偏好，并让新任务继承项目最近一次完整设置。
- 支持有序的多根项目与根目录切换，接入 Codex 原生模糊文件搜索和 Git 元数据监听，按当前根精确刷新文件与仓库状态。
- 接入 Codex 持久化线程队列和 MCP 补充输入请求，支持跟进消息跨重启交付，并完善 Goal、异步 Hook、多 Agent 与模型切换状态同步。
- 添加项目归档任务管理，支持恢复、单项永久删除和批量清空全部归档任务。
- 支持直接添加经过验证的宿主绝对目录，并保留多根项目的目录树选择流程。

### 优化

- 确立 Codex `projectId` 为项目身份真相源，统一多根 Project Runtime、任务作用域和临时任务生命周期。
- 为任务历史添加游标分页与活动任务并发恢复，缓存 Codex 原生状态读取，并优化事件批次、JSONL 分片和长会话资源释放。
- 聚合连续工具与命令操作摘要，持久化临时任务分组状态，并整合中英文用户文档与维护者文档。
- 统一 Codexly 品牌标识、终端提示符和浏览器图标资产。

### 修复

- 修复文件搜索查询调度、Reviewer 与跨 Turn 历史分页，以及自定义 Provider 配置切换和登录失败回滚。
- 修复 Project Runtime 并发释放、任务退订、未物化任务归属、新增项目任务列表状态及多根目录选择控件。
- 修复未发布首版本的更新判断、历史 Turn 分页 Item 水合，以及超限 Git Diff 阻断状态读取的问题。

### 工程

- 升级内置 Codex 至 `0.149.0`，刷新真实 App Server Schema 基线，并对齐原生 Project 归属、异步消息投递和严格审核通知。
- 动态映射自定义 Provider 的模型思考量元数据，支持 `max`、`ultra` 和 Provider 自定义档位，并校验当前 Provider 运行时能力。
- 拆分全栈测试套件并限制 Vitest 并发，提升跨平台门禁稳定性；GitHub Release 改为严格提取对应版本的完整更新日志。
- 将最低 Node.js 版本调整为 `22.14.0`，同步 CLI、CI、发布环境和使用文档。

[Unreleased]: https://github.com/BryanHoo/Codexly/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/BryanHoo/Codexly/releases/tag/v0.1.0
