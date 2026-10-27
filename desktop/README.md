<p align="center"><img src="./public/brand/codexly-mark.svg" alt="Codexly" width="88" /></p>

<h1 align="center">Codexly 桌面版</h1>

<p align="center">支持 Codex 与 Claude 的本地 AI 编程工作台，适用于 macOS、Windows 和 Ubuntu。</p>

[产品首页](../README.md) · [下载桌面版](https://github.com/BryanHoo/Codexly/releases) · [English](README.en.md)

![Codexly 桌面工作台](../docs/images/codexly-preview.png)

## 开始使用

1. 下载对应系统和架构的安装包，按[安装指南](docs/installation.md)打开应用。
2. 在设置中配置 Codex、Claude 或两者；受支持的已有本机配置可直接复用。
3. 添加项目文件夹，新建任务并发送需求。

安装包已内置运行时，无需另装 Node.js、Bun 或 CLI。支持 Windows 10/11 x64、Ubuntu 24.04+ x64、macOS 14.5+（Apple Silicon / Intel），另有仅支持 Codex 的 macOS 12.4+ Intel Legacy 版。

Windows 便携版须完整解压 ZIP 并保留主程序、Claude 宿主和 `runtime` 目录；更新时替换完整目录。

## 桌面工作台

与 Web、移动端共用对话、审批、消息队列、项目文件、Git、扩展与定时任务等工作流；桌面版另提供项目原生终端、全局快捷键、独立任务窗口、系统通知与托盘，并可在「设置 → 通用」启用登录后启动。

在「设置 → 通用」切换「显示状态栏图标」，即时显示或隐藏系统托盘图标，重启后保留选择。隐藏图标不会退出应用，也不改变关闭窗口后最小化到托盘的行为。

最多四个任务分屏，各自保留草稿和消息队列，文件、Git 与终端跟随当前聚焦任务。连接与日常操作见[首次使用](../docs/getting-started.md)和[工作台指南](../docs/usage.md)。

侧栏支持项目／时间线视图与未读通知中心，进入任务自动标记对应通知为已读；文件标签支持拖动排序、固定、批量关闭，以及与聊天左右或上下对照。设置中可管理全局／项目常用提示词，用 `/` 或 `#` 按标题插入，并查看双引擎[用量统计](../docs/usage-statistics.md)；提示词仅保存在当前客户端。

通知标为已读或对应请求处理完毕后，自动撤销相应系统提醒；已读不代表审批已通过或问题已回答。

任务分屏快捷键统一为 `Alt+Shift+方向键`，可在「帮助 → 键盘快捷键」查看；故障时在「设置 → 关于」导出诊断 ZIP。

扩展中心按 Codex 或 Claude 管理本地 Skills、MCP 和官方插件，支持搜索、筛选及全局／项目范围选择。具体操作遵循各引擎能力，配置变更后新建会话以完整加载。

同机同一用户的桌面与 Web 共用 `~/.codexly` 项目、任务和历史。手机访问需另外启动 Web 局域网服务，桌面应用本身不提供此入口；详见 [Web 与移动端](../docs/web.md)。

## 文档与帮助

- [安装、更新与卸载](docs/installation.md)
- [统一使用文档](../docs/README.md)
- [常见问题](../docs/faq.md) · [诊断日志](docs/diagnostics.md)
- [源码开发与构建](docs/development.md) · [运行时分发](docs/provider-runtime-management.md)
- [三端与双引擎能力参考](docs/codexly-capability-matrix.md)
- [更新日志](../CHANGELOG.md) · [问题反馈](https://github.com/BryanHoo/Codexly/issues)

## 许可证

[MIT](LICENSE)
