# Codexly

[English](README.md) | 简体中文

Codexly 是一个在浏览器中使用 Codex 的本地 AI 编程工作台。它按项目组织任务，实时展示 Codex 的执行过程，并提供文件、代码审查和 Git 工具；项目文件系统始终由运行端电脑提供。

## 主要功能

- 运行项目任务或临时任务，实时查看回复、命令和文件变更
- 添加文件与图片、使用 `@` 引用项目文件，并回答已配置 MCP 服务的补充输入请求
- 为每个任务选择模型、思考量、快速模式、审批方式和文件访问范围
- 组织有序的多根项目、归档已完成任务，并按需永久删除任务
- 查看文件与差异、审查代码、管理分支与 worktree，并提交或推送变更
- 从 AI 回复处分叉任务，在新的 Git worktree 中继续工作
- 从可信局域网中的其他设备访问工作台

## 环境要求

- Node.js 22.13.0 或更高版本
- Chrome/Chromium 116+、Firefox 124+ 或 Safari 17.4+

Codexly 通过 `@openai/codex` 自带受支持的 Codex CLI，无需单独安装。仅在需要使用其他可执行文件时传入 `--codex-bin <path>` 或设置 `CODEXLY_CODEX_BIN`。

## 快速开始

无需安装，直接运行最新版本：

```bash
npx --package @bryanhu/codexly@latest codexly start
```

Codexly 会自动打开浏览器。若未打开，请访问终端输出的地址；默认地址为 `http://127.0.0.1:3210`。使用期间需保持终端运行，按 `Ctrl+C` 停止。

首次启动时，使用 ChatGPT 登录，或配置兼容 Responses API 和 `GET /models` 的 OpenAI-compatible 服务。

经常使用时可以全局安装：

```bash
npm install --global @bryanhu/codexly
codexly start
```

## 使用方式

不依赖项目时，直接选择“新建任务”。处理仓库时，先添加一个或多个运行端目录作为有序的项目根，再创建任务，并按需附加文件、图片、项目引用或 Skills 后提交需求。归档的任务可以从项目任务列表中恢复或永久删除。

任务控件用于设置模型、思考量、快速模式、审批方式和文件访问范围。通知偏好与项目最近一次完整设置会保存给后续任务。右侧检查器提供项目文件、来源、代码变更、Git 历史、审查和提交操作。即使从其他设备打开界面，项目目录和文件仍来自运行 Codexly 的电脑。

## 局域网访问

在可信局域网中启动：

```bash
codexly start --lan
```

终端会输出局域网地址和随机访问密码。常用选项如下：

| 选项                        | 用途                                                  |
| --------------------------- | ----------------------------------------------------- |
| `--port <port>`             | 指定起始端口；端口被占用时自动尝试后续端口            |
| `--lan-password <password>` | 设置 16 至 128 位密码，必须包含大小写字母、数字和符号 |
| `--allowed-host <domain>`   | 允许精确的反向代理域名；多个域名可重复传入            |
| `--session-ttl <duration>`  | 设置固定会话期限，如 `12h`；省略时持续到 Server 重启  |

密码含 Shell 特殊字符时请使用引号。局域网模式使用未加密 HTTP，只能用于可信网络，禁止直接暴露到互联网。重启 Codexly 会使密码和全部会话失效。

## 诊断与更新

启动、Codex 或本地数据检查失败时运行 `codexly doctor`。使用 `codexly --help` 查看当前命令和选项。

交互式启动和“设置 > 关于”会检查新版本。全局安装也可以通过以下命令更新：

```bash
npm install --global @bryanhu/codexly@latest
```

## 获取帮助

- [问题反馈](https://github.com/BryanHoo/Codexly/issues)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [版本记录](CHANGELOG.md)

## 许可证

[MIT](LICENSE)
