# 首次使用 Codexly

[文档导航](README.md) · [English](getting-started.en.md)

目标：选择使用端，连接 Codex 或 Claude，用本机项目完成第一个任务。

## 选择使用端

- **桌面应用**：从 [Releases](https://github.com/BryanHoo/Codexly/releases) 下载安装包，按[安装指南](../desktop/docs/installation.md)打开。运行时已内置，无需另装 Node.js、Bun 或 CLI；macOS Legacy 仅支持 Codex。
- **电脑浏览器**：安装 Node.js 24+，运行下方命令，打开终端显示的本机地址。
- **手机和平板**：在电脑上使用下方命令并加上 `--lan`，再用移动浏览器访问终端显示的局域网地址、输入密码。完整步骤见 [Web 与移动端](web.md)。

```bash
npx --package @bryanhu/codexly@latest codexly start
```

桌面端打开后直接进入工作台，在设置中配置连接；Web 首次使用时按初始化界面完成配置。已有受支持的本机配置会被识别。你可以只配置一个智能体，之后再添加另一个。

## 连接 Codex 或 Claude

### Codex

在 Codex 连接设置中选择 ChatGPT 登录，或填写兼容服务的地址与密钥。自定义服务需支持 OpenAI Responses API 和模型列表。保存后选择服务实际提供的模型，模型和思考档位随当前连接变化。

### Claude

可复用运行 Codexly 的电脑上已有的受支持 Claude Code 凭据，也可在 Claude 连接设置中填写服务地址与密钥。官方 API 地址为 `https://api.anthropic.com`；兼容服务需支持 Anthropic Messages API 和 `/v1/models`。点击连接或保存按钮才会保存密钥，单纯输入或失焦不会提交。

应用内不提供 Claude 账号登录。连接检测读取模型列表，不发送生成请求；检测成功不代表已经验证调用额度和全部模型权限。

模型选择使用 Haiku、Sonnet、Opus 档位。使用网关且实际模型 ID 不同时，在 Claude 智能体设置中配置模型映射；官方连接通常可以留空。只配置 Claude 也可使用聊天、公共设置、Git 提交说明生成与定时任务，无需配置 Codex。

### 配置在哪台设备上生效

桌面应用读取本机用户配置；电脑与移动浏览器操作 Web 服务所在电脑的配置，而非浏览器所在设备。Codex 默认使用 `~/.codex`，Claude 默认使用 `~/.claude`；指定 `CODEX_HOME` 或 `CLAUDE_CONFIG_DIR` 时使用对应目录。

密钥、模型权限与额度由所用服务管理。Codexly 不包含模型额度，项目中与任务相关的内容会按智能体行为发送给模型服务。

## 创建第一个任务

1. 在侧栏添加一个电脑上的文件夹作为项目。手机访问时选择的也是 Web 主机上的目录。
2. 打开项目并新建任务。两种引擎都可用时，在输入区选择 Codex 或 Claude；只有一种时自动使用该引擎。
3. 选择模型，按需要调整权限。不同引擎的权限语义不同，先使用需要确认的模式更便于检查操作。
4. 输入明确的目标，例如「解释这个项目的启动方式，并找出测试入口」，再发送。可以添加附件、用 `@` 引用项目文件、用 `$` 引用 Skills。
5. 查看输出与工具执行过程，处理出现的审批或问题。修改代码后，在变更面板审阅差异，再决定是否提交。

无需项目时，可从「新建任务」开始临时对话。已有任务的引擎固定；希望使用另一种引擎时请新建任务。

## 继续使用

- [工作台使用](usage.md)：补充指令、消息队列、分屏、文件与定时任务。
- [Git 操作](git-workflow.md)：分支、worktree、提交与推送。
- [常见问题](faq.md)：连接失败、数据共享与更新。
- [智能体技术参考](agent-engines.md)：原生配置、权限和扩展的详细边界。
