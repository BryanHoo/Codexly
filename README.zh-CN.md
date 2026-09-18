# Codexly

[English](README.md) | 简体中文

Codexly 是一个在浏览器中使用 Codex 的本地 AI 编程工作台。它按项目组织任务，实时展示 Codex 的执行过程，并提供文件、代码审查和 Git 工具；项目文件系统始终由运行端电脑提供。

## 主要功能

- 运行项目任务或临时任务，实时查看回复、命令和文件变更
- 使用持久化任务队列安排后续工作，并在执行前编辑排队消息和附件
- 使用任务看板跟踪进行中的工作、维护项目待办，并创建持久化的一次性或周期定时任务
- 从当前设备或部署主机添加文件与图片、使用 `@` 引用项目文件、回答 MCP 补充输入请求，并在任务执行期间发起或关闭异步问题
- 为每个任务选择模型、思考量、快速模式、审批方式和文件访问范围
- 在扩展中心统一管理已安装 Skills、官方 Plugins、MCP Servers，以及来自 ClawHub 的兼容第三方 Skills
- 组织有序的多根项目、归档项目或临时任务，并按需永久删除任务
- 全局搜索任务、历史消息和项目文件，并定位匹配消息或预览文件
- 查看、预览、重命名和删除项目文件，审查差异，管理分支与 worktree，并提交或推送变更
- 从 AI 回复处分叉任务，在新的 Git worktree 中继续工作
- 添加工作台宠物动画，用独立气泡区分任务活动，并支持自定义 PNG 或 WebP 精灵图清单
- 管理自定义工作台背景图片集合，或使用 Bing 每日壁纸，并自动适配前景色、浮层遮罩与背景模糊
- 从可信局域网中的其他设备访问工作台

## 环境要求

- Node.js >=22.14.0
- Chrome/Chromium 116+、Firefox 124+ 或 Safari 17.4+

Codexly 通过 `@openai/codex` 自带 Codex CLI `0.154.0`，无需单独安装。通过 `--codex-bin <path>` 或 `CODEXLY_CODEX_BIN` 指定的外部版本必须满足 `>=0.154.0,<0.155.0`。

## 快速开始

无需安装，直接运行最新版本：

```bash
npx --package @bryanhu/codexly@latest codexly start
```

Codexly 会自动打开浏览器。若未打开，请访问终端输出的地址；默认地址为 `http://127.0.0.1:3210`。使用期间需保持终端运行，按 `Ctrl+C` 停止。

同一数据目录只能运行一个 Codexly 实例，重复启动会被拒绝；进程退出或崩溃后自动释放锁。需要独立实例时使用不同的 `--codex-home <目录>`。

首次启动时，使用 ChatGPT 登录，或配置兼容 Responses API 和 `GET /models` 的 OpenAI-compatible 服务。

经常使用时可以全局安装：

```bash
npm install --global @bryanhu/codexly@latest --registry=https://registry.npmmirror.com --prefer-offline || npm install --global @bryanhu/codexly@latest --registry=https://registry.npmjs.org --prefer-offline
codexly
```

安装命令优先使用国内镜像，失败后回退官方源，并复用 npm 缓存。`||` 适用于 Bash、Zsh、cmd 和 PowerShell 7+；Windows PowerShell 5.1 请在第一条命令失败后单独执行 `||` 右侧的命令。

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

打开 `http://127.0.0.1:3210`，使用日志中的随机配对码。默认命名卷会持久化 Codex 登录数据和 Codexly SQLite 状态。在 Linux 和 macOS 上，Compose 默认把宿主根目录挂载到 `/workspace`，项目选择器可读取所有已挂载磁盘。设置 `CODEXLY_WORKSPACE` 后只暴露指定目录：

```bash
CODEXLY_WORKSPACE=/path/to/projects docker compose up --detach
```

Docker 只能访问 Docker Engine 已共享的宿主路径。Windows 需将 `CODEXLY_WORKSPACE` 设置为已共享盘符，例如 `C:/`；需要多个盘符时，在 Compose 中增加 bind mount，并在 `command` 中重复传入 `--workspace`。

| 变量                    | 用途                                                |
| ----------------------- | --------------------------------------------------- |
| `CODEXLY_VERSION`       | 指定 GHCR 镜像标签，默认 `latest`                   |
| `CODEXLY_PORT`          | 同时设置宿主与容器端口，默认 `3210`                 |
| `CODEXLY_WORKSPACE`     | 限制挂载到 `/workspace` 的宿主目录，默认 `/`        |
| `CODEXLY_CODEX_HOME`    | 绑定宿主 Codex Home，替代默认 `codexly-data` 命名卷 |
| `CODEXLY_LAN_PASSWORD`  | 设置固定强密码，替代日志中生成的随机配对码          |
| `CODEXLY_ALLOWED_HOSTS` | 设置逗号分隔的反向代理精确域名                      |
| `CODEXLY_SESSION_TTL`   | 设置固定会话期限，例如 `12h`                        |

镜像入口支持全部 CLI 参数，编排平台可按需覆盖 `command`。工作区、多磁盘、Codex Home、更新、备份和故障排查参见[完整 Docker Compose 部署指南](docs/docker-deployment.md)。开发仓库可运行 `pnpm docker:build && pnpm docker:test` 构建并冒烟测试本地镜像。

## 使用方式

不依赖项目时，直接选择“新建任务”。处理仓库时，先添加一个或多个运行端目录作为有序的项目根，再创建任务，并按需附加文件、图片、项目引用或 Skills 后提交需求。归档的任务可以从项目任务列表中恢复或永久删除。

任务控件用于设置模型、思考量、快速模式、审批方式和文件访问范围。通知偏好与项目最近一次完整设置会保存给后续任务。右侧检查器提供项目文件、来源、代码变更、Git 历史、审查和提交操作。即使从其他设备打开界面，项目目录和文件仍来自运行 Codexly 的电脑。

定时任务显示“结果未知”时会暂停后续运行，请先查看关联对话；确认后可删除该计划并重新创建。“已启动，正在收尾”会自动重试清理，无需再次运行。

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
| `--workspace <path>`        | 限制项目选择的绝对根目录；多个根目录可重复传入        |

密码含 Shell 特殊字符时请使用引号。局域网模式使用未加密 HTTP，只能用于可信网络，禁止直接暴露到互联网。重启 Codexly 会使密码和全部会话失效。

## 诊断与更新

启动、Codex 或本地数据检查失败时运行 `codexly doctor`。使用 `codexly --help` 查看当前命令和选项。

交互式启动和“设置 > 关于”会检查新版本。内置更新的版本查询、包下载和依赖安装优先使用国内镜像，失败后回退官方源；下载和安装复用用户的 npm 缓存。镜像同步期间可能稍晚显示新版本。全局安装也可以通过以下命令更新：

```bash
npm install --global @bryanhu/codexly@latest --registry=https://registry.npmmirror.com --prefer-offline || npm install --global @bryanhu/codexly@latest --registry=https://registry.npmjs.org --prefer-offline
```

如果 Linux 上的旧版本通过 `sudo npm install --global` 安装到系统目录，首次升级到支持提权更新的版本时需要手动执行一次上述命令并在前面加上 `sudo`。后续内置更新会在需要时请求 `sudo` 权限。

## 获取帮助

- [问题反馈](https://github.com/BryanHoo/Codexly/issues)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [版本记录](CHANGELOG.md)

## 许可证

[MIT](LICENSE)
