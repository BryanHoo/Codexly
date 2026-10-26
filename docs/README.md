# Codexly 文档

Codexly 支持 Codex 与 Claude，提供桌面应用、电脑 Web 和移动浏览器三种使用方式。移动端连接 Web 服务，项目与智能体运行在提供服务的电脑上。

[产品首页](../README.md) · [English README](../README.en.md) · [下载桌面版](https://github.com/BryanHoo/Codexly/releases)

## 安装与第一次使用

| 你想做什么                             | 中文                                            | English                                                    |
| -------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| 选择使用端、连接智能体并创建第一个任务 | [首次使用](getting-started.md)                  | [Getting started](getting-started.en.md)                   |
| 安装、更新或卸载桌面应用               | [桌面安装指南](../desktop/docs/installation.md) | [Desktop installation](../desktop/docs/installation.en.md) |
| 启动 Web、连接手机或配置局域网访问     | [Web 与移动端](web.md)                          | [Web and mobile](web.en.md)                                |
| 让 Web 服务在登录系统后启动            | [Web 登录自启动](web-autostart.zh-CN.md)        | [Web startup at login](web-autostart.md)                   |

## 日常使用

- [工作台使用](usage.md) · [Workspace guide](usage.en.md)：任务时间线、通知、常用提示词、队列、分屏、文件、扩展与定时任务。
- [用量统计](usage-statistics.md)：双引擎 Token 用量、年度热力图、统计口径与验证。
- [Git 操作](git-workflow.md)：差异审阅、提交、远端同步、分支与 worktree，含英文说明。
- [聊天与文件工作区](document-workspace.md)：中栏标签、聊天对照、移动视图与设计依据。
- [文本编辑](text-file-editing.md)：保存、文件限制与冲突处理。
- [全局搜索](global-search.md)：项目、任务、消息与文件搜索。
- [常见问题](faq.md)：本地数据、跨端使用、连接失败与更新。

## 智能体与数据参考

以下文档也包含实现细节，日常使用可先读首次使用与工作台指南。

- [智能体引擎与连接](agent-engines.md)：Codex / Claude 的配置来源、能力边界及扩展范围。
- [模型与思考强度](model-discovery.md)：模型目录、Claude 模型映射与能力来源。
- [模型上下文窗口](model-context-window.md)：两种引擎的窗口和自动压缩设置。
- [本地目录与任务](local-catalog.md)：同机共享数据、旧数据导入与配置目录。
- [会话加载与性能](conversation-performance.md)：历史与执行过程按需加载。
- [定时任务执行边界](scheduled-task-idempotency.md)：不确定结果与清理恢复。

## 问题排查

Web、移动浏览器和桌面均可在「设置 → 关于」导出诊断材料：Web 下载 JSON，桌面导出 ZIP。Web 服务默认不向终端持续输出运行日志，启动错误仍可在终端查看，按需运行 `codexly doctor`。先确认出错的使用端和智能体，再按[常见问题](faq.md)排查；[Web 诊断](web.md#排查问题)与[桌面诊断日志](../desktop/docs/diagnostics.md)提供进一步说明。

[问题反馈](https://github.com/BryanHoo/Codexly/issues) · [安全漏洞私密报告](../SECURITY.md) · [更新日志](../CHANGELOG.md)

## 开发与维护

- [贡献指南](../CONTRIBUTING.md)：源码开发、验证、文档维护与提交约定。
- [桌面源码开发](../desktop/docs/development.md) · [English](../desktop/docs/development.en.md)。
- [三端与双引擎能力参考](../desktop/docs/codexly-capability-matrix.md)。
- [桌面运行时分发](../desktop/docs/provider-runtime-management.md)。
- [Codex 0.164.0 升级评估](codex-0.164.0-upgrade.md)：官方源码差异、两端适配与验证边界。
- [联合发布](releasing.md)。

`codex-*-upgrade.md`、带日期的测试报告、架构调研及迁移记录保留当时的背景和验证结果，不作为当前安装或能力说明。当前行为以使用指南、能力参考与对应版本的更新日志为准。
