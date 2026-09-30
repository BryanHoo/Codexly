# Codexly

[English](README.md) | 简体中文

Codexly 是本地 AI 编程工作台，提供桌面应用和 Web 版。它将编程任务、对话、项目文件与 Git 操作集中在一处。桌面版适合在本机持续工作；Web 版在本地运行，可通过浏览器从电脑或可信局域网中的移动设备访问。项目文件和 Codex 运行时始终留在运行 Codexly 的电脑上。

## 获取 Codexly

| 版本   | 适用场景                                           | 开始使用                                                                                                                                 |
| ------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 桌面版 | 原生工作台、集成终端、独立任务窗口、系统通知与托盘 | [下载 Windows、Ubuntu 或 macOS 安装包](https://github.com/BryanHoo/Codexly/releases)，按[桌面安装指南](desktop/docs/installation.md)安装 |
| Web 版 | 本机浏览器工作台，或从可信局域网内的其他设备访问   | 安装 Node.js 24+，按[Web 版启动步骤](#启动-web-版)运行                                                                                   |

桌面安装包支持 Windows 10/11 x64、Ubuntu 24.04+ x64、macOS 14.5+（Apple Silicon / Intel），并提供 macOS 12.4+ Intel 的 Legacy 版本。安装包尚无操作系统代码签名，下载后请先查看[安装与放行说明](desktop/docs/installation.md)。桌面版首次启动会自动安装并校验应用私有的 Codex 运行时。

## 主要功能

- 实时查看任务回复、命令、审批、推理摘要和文件变更，查看文件编辑耗时与完成汇总，并用持久化队列安排后续消息。
- 阅读流式 Markdown 回复并复制原始文本；缩放、拖动消息图片、项目图片与壁纸，或以原始尺寸查看。
- 为任务选择模型、思考量、快速模式、审批策略和文件访问范围。
- 新建项目及目录，跨项目搜索任务、历史消息和文件；检查变更、管理分支与 worktree，并选择文件提交或推送。
- 通过侧栏任务的项目标签识别任务来源。
- 管理 Skills、插件、MCP 服务、项目、归档任务、通知与定时工作。

**桌面版**提供原生项目终端、全局快捷键、独立任务窗口、托盘集成和应用私有 Codex 安装。支持 Windows、Ubuntu 和 macOS；完整功能与更新方式见[桌面版指南](desktop/README.md)。

**Web 版**在本机运行服务并由浏览器访问，支持手机等设备从可信局域网接入、Docker 部署、任务看板、Mermaid 图表和自定义工作台背景。Web 版通过 `@openai/codex` 自带 Codex CLI `0.159.2`；使用 `--codex-bin <path>` 或 `CODEXLY_CODEX_BIN` 指定外部版本时，版本必须满足 `>=0.159.2,<0.160.0`。

## 启动 Web 版

需要 Node.js >=24.0.0，以及 Chrome/Chromium 116+、Firefox 124+ 或 Safari 17.4+。

无需安装，直接运行最新版本：

```bash
npx --package @bryanhu/codexly@latest codexly start
```

Codexly 会自动打开浏览器。若未打开，请访问终端输出的地址；默认地址为 `http://127.0.0.1:3210`。使用期间需保持终端运行，按 `Ctrl+C` 停止。

运行 `codexly --version` 查看安装版本，或使用 `codexly <command> --help` 查看命令专属选项。

同一数据目录只能运行一个 Codexly 实例，重复启动会被拒绝；进程退出或崩溃后自动释放锁。需要独立实例时使用不同的 `--codex-home <目录>`。

首次启动时，使用 ChatGPT 登录，或配置兼容 Responses API 和 `GET /models` 的 OpenAI-compatible 服务。
自定义 Provider 会发现可用模型；模型未提供思考档位时可选择基础档位。

经常使用时可以全局安装：

```bash
npm install --global @bryanhu/codexly@latest --registry=https://registry.npmmirror.com || npm install --global @bryanhu/codexly@latest --registry=https://registry.npmjs.org
codexly
```

安装命令优先使用国内镜像，失败后回退官方源，复用 npm 缓存并重新校验过期的包元数据。`||` 适用于 Bash、Zsh、cmd 和 PowerShell 7+；Windows PowerShell 5.1 请在第一条命令失败后单独执行 `||` 右侧的命令。

## Docker 部署

下载用户版 Compose 配置并启动已发布镜像：

```bash
mkdir codexly && cd codexly
curl -fsSLO https://raw.githubusercontent.com/BryanHoo/Codexly/main/compose.yaml
curl -fsSLo .env.example https://raw.githubusercontent.com/BryanHoo/Codexly/main/.env.example
cp .env.example .env
docker compose pull
docker compose up --detach
docker compose logs --tail=50 codexly
```

打开 `http://127.0.0.1:3210`，使用日志中的随机配对码。默认命名卷会持久化 Codex 登录数据和 Codexly SQLite 状态。在 Linux 和 macOS 上，Compose 默认把宿主根目录挂载到 `/workspace`，项目选择器可读取所有已挂载磁盘。设置 `CODEXLY_WORKSPACE` 后只暴露指定目录，并在容器中保留其绝对路径：

```bash
CODEXLY_WORKSPACE=/path/to/projects docker compose up --detach
```

绑定宿主 `CODEXLY_CODEX_HOME` 时，应同时把 `CODEXLY_WORKSPACE` 设置为已有项目的公共父目录。Codex 保存的项目绝对路径随后可在宿主和容器中保持一致。

容器不会自动继承宿主 Git 身份。将 `CODEXLY_GIT_CONFIG` 设置为容器可见的全局 Git 配置文件；在 Linux 和 macOS 的同路径工作区中可直接填写宿主 `~/.gitconfig` 的绝对路径。使用 SSH 远程时，将 `CODEXLY_SSH_HOME` 设置为宿主 `~/.ssh` 的绝对路径。

Docker 只能访问 Docker Engine 已共享的宿主路径。Windows 需将 `CODEXLY_WORKSPACE` 设置为已共享盘符（例如 `C:/`），并设置 `CODEXLY_WORKSPACE_TARGET=/workspace`。Windows 与 Linux 容器的绝对路径格式不同，不能直接复用包含宿主项目记录的 Codex Home；需要多个盘符时，在 Compose 中增加 bind mount，并在 `command` 中重复传入 `--workspace`。

| 变量                       | 用途                                                |
| -------------------------- | --------------------------------------------------- |
| `CODEXLY_VERSION`          | 指定 GHCR 镜像标签，默认 `latest`                   |
| `CODEXLY_PORT`             | 同时设置宿主与容器端口，默认 `3210`                 |
| `CODEXLY_WORKSPACE`        | 限制工作区并在容器内保留相同绝对路径，默认 `/`      |
| `CODEXLY_WORKSPACE_TARGET` | 覆盖容器工作区路径，Windows 使用 `/workspace`       |
| `CODEXLY_GIT_CONFIG`       | 指定容器可见的全局 Git 配置文件                     |
| `CODEXLY_SSH_HOME`         | 只读挂载宿主 SSH 配置、私钥和 `known_hosts`         |
| `CODEXLY_CODEX_HOME`       | 绑定宿主 Codex Home，替代默认 `codexly-data` 命名卷 |
| `CODEXLY_LAN_PASSWORD`     | 设置固定强密码，替代日志中生成的随机配对码          |
| `CODEXLY_ALLOWED_HOSTS`    | 设置逗号分隔的反向代理精确域名                      |
| `CODEXLY_SESSION_TTL`      | 设置固定会话期限，例如 `12h`                        |

镜像入口支持全部 CLI 参数，编排平台可按需覆盖 `command`。工作区、多磁盘、Codex Home、更新、备份和故障排查参见[完整 Docker Compose 部署指南](docs/docker-deployment.md)。开发仓库可运行 `pnpm docker:build && pnpm docker:test` 构建并冒烟测试本地镜像。

## 使用 Web 版

不依赖项目时，直接选择“新建任务”。处理仓库时，先添加一个或多个运行端目录作为有序的项目根，再创建任务，并按需附加文件、图片、项目引用或 Skills 后提交需求。归档的任务可以从项目任务列表中恢复或永久删除。

任务控件用于设置模型、思考量、快速模式、审批方式和文件访问范围。通知偏好与项目最近一次完整设置会保存给后续任务。右侧检查器提供项目文件、来源、代码变更、Git 历史、审查和提交操作。即使从其他设备打开界面，项目目录和文件仍来自运行 Codexly 的电脑。

定时任务显示“结果未知”时会暂停后续运行，请先查看关联对话；确认后可删除该计划并重新创建。“已启动，正在收尾”会自动重试清理，无需再次运行。

## Web 局域网访问

在可信局域网中启动：

```bash
codexly start --lan
```

终端会输出局域网地址和随机访问密码。常用选项如下：

| 选项                        | 用途                                                 |
| --------------------------- | ---------------------------------------------------- |
| `--port <port>`             | 指定起始端口；端口被占用时自动尝试后续端口           |
| `--lan-password <password>` | 设置 16 至 128 位密码，必须包含大小写字母和数字      |
| `--allowed-host <domain>`   | 允许精确的反向代理域名；多个域名可重复传入           |
| `--session-ttl <duration>`  | 设置固定会话期限，如 `12h`；省略时持续到 Server 重启 |
| `--workspace <path>`        | 限制项目选择的绝对根目录；多个根目录可重复传入       |

密码含 Shell 特殊字符时请使用引号。局域网模式使用未加密 HTTP，只能用于可信网络，禁止直接暴露到互联网。重启 Codexly 会使密码和全部会话失效。

## Web 诊断与更新

启动、Codex 或本地数据检查失败时运行 `codexly doctor`。使用 `codexly --help` 查看完整命令，`codexly start --help` 或 `codexly doctor --help` 查看对应选项，`codexly --version` 查看版本。

交互式启动和“设置 > 关于”会检查新版本。内置更新的版本查询、包下载和依赖安装优先使用国内镜像，失败后回退官方源；下载和安装复用用户的 npm 缓存。镜像同步期间可能稍晚显示新版本。全局安装也可以通过以下命令更新：

```bash
npm install --global @bryanhu/codexly@latest --registry=https://registry.npmmirror.com || npm install --global @bryanhu/codexly@latest --registry=https://registry.npmjs.org
```

如果 Linux 上的旧版本通过 `sudo npm install --global` 安装到系统目录，首次升级到支持提权更新的版本时需要手动执行一次上述命令并在前面加上 `sudo`。后续内置更新会在需要时请求 `sudo` 权限。

## 获取帮助

- [问题反馈](https://github.com/BryanHoo/Codexly/issues)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [版本记录](CHANGELOG.md)
- [桌面版更新日志](desktop/CHANGELOG.md)

## 许可证

[MIT](LICENSE)
