# Web 与移动端使用指南

[文档导航](README.md) · [English](web.en.md) · [桌面安装](../desktop/docs/installation.md)

Web 服务运行在保存项目的电脑上，电脑、手机和平板通过浏览器访问。桌面应用独立运行；要让手机访问同机项目，请额外启动 Web 服务。

## 环境与启动

主机需要 Node.js >=24.0.0；浏览器要求 Chrome / Chromium 116+、Firefox 124+ 或 Safari 17.4+。手机只需兼容浏览器，无需 Node.js。Web 依赖随 npm 包安装，运行时配置在主机上读取。

无需全局安装即可试用：

```bash
npx --package @bryanhu/codexly@latest codexly start
```

默认打开 `http://127.0.0.1:3210`；端口占用时自动递增，以终端输出为准。保持终端运行，按 `Ctrl+C` 停止。首次使用按[连接指南](getting-started.md)配置 ACP 智能体。

日常使用建议全局安装：

```bash
npm install --global @bryanhu/codexly@latest
codexly
```

`codexly` 等同于 `codexly start`。不希望自动打开浏览器时运行 `codexly start --no-open`。

## 移动端与局域网访问

1. 在主机启动局域网模式；全局安装后使用 `codexly start --lan`，临时使用运行下方命令。
2. 将手机或平板连接同一可信局域网，在浏览器中打开终端显示的局域网地址。
3. 输入终端显示的访问密码。不要在手机上使用 `127.0.0.1`，它指向手机自身。
4. 选择主机上的项目，查看任务、发送消息、处理审批或打开文件和变更。

```bash
npx --package @bryanhu/codexly@latest codexly start --lan
```

`--lan` 监听网络接口且不自动打开主机浏览器。主机须保持开机、唤醒并运行服务；关闭服务或主机休眠后，手机无法继续操作。检查防火墙是否允许对应端口，访客 Wi-Fi 或客户端隔离可能阻止设备互访。

局域网使用未加密 HTTP，仅适用于可信网络，不要通过端口转发或公网代理直接公开。`--allowed-host` 只扩展 Host 白名单，不提供加密或额外认证。

默认生成随机密码；服务重启会使随机配对码和所有登录会话失效。显式设置的固定密码重启后仍可使用，但需重新登录。自启动服务会保存并复用自己的密码，见下文。

## 常用启动参数

以下命令在全局安装后可直接使用；临时安装时在 `npx --package @bryanhu/codexly@latest` 后使用同样参数。

| 参数                     | 用途                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `--port <端口>`          | 指定起始端口，占用时自动递增                                         |
| `--no-open`              | 不自动打开浏览器                                                     |
| `--lan`                  | 开启可信局域网访问                                                   |
| `--lan-password <密码>`  | 固定局域网密码，16–128 位，含大写、小写字母和数字；须与 `--lan` 合用 |
| `--session-ttl <时长>`   | 固定登录有效期，如 `12h`；省略则持续到服务重启；须与 `--lan` 合用    |
| `--workspace <绝对路径>` | 限制项目选择根目录，可重复指定                                       |
| `--allowed-host <域名>`  | 允许准确的代理域名，可重复指定                                       |

含 Shell 特殊字符的密码需要正确加引号。用 `codexly start --help` 查看完整帮助。

多个实例会跳过占用端口。临时任务使用用户主目录或首个显式指定的 `--workspace` 根目录。

## 登录后后台启动

需要稳定的全局 npm 安装，临时 `npx` 安装不能登记系统登录项。支持 macOS、Windows，以及提供 systemd 用户管理器的 Ubuntu。

```bash
codexly autostart enable
codexly autostart status
```

本机和 LAN 自启动都不自动打开浏览器。需要局域网后台运行并立即启动时：

```bash
codexly autostart enable --lan --now
codexly autostart credentials
```

`status` 查看实际地址与状态，`credentials` 显式显示保存的局域网密码。常用维护命令：

```bash
codexly autostart logs
codexly autostart restart
codexly autostart disable
codexly autostart repair --now
```

`enable` 更新同一个登录项；不加 `--now` 时，修改在重启或下次登录生效。更换 Node.js 或全局 npm 目录后使用 `repair --now`；卸载前先 `disable`。登录项不读取 Shell profile，终端临时设置的 API Key 和代理不会自动带入。完整说明见 [Web 登录自启动](web-autostart.zh-CN.md)。桌面应用使用「设置 → 通用 → 开机启动」，无需此 CLI。

## 更新与卸载

侧栏出现新版本时，点击版本号查看更新日志并安装；也可在「设置 → 关于」检查更新，手动检查会重新查询并优先使用官方源，失败时回退镜像；镜像同步可能有延迟。全局安装也可手动更新：

```bash
npm install --global @bryanhu/codexly@latest
```

若旧版曾通过 `sudo npm install --global` 安装到系统目录，可能需手动以同样权限升级一次；后续内置更新按需请求提权。更新前保存编辑中的文件，按界面提示重启或重新连接。

卸载全局 npm 包：

```bash
codexly autostart disable
npm uninstall --global @bryanhu/codexly
```

未配置自启动时可跳过第一行。卸载包不会自动删除项目或 `~/.codexly` 数据；该目录可能仍被桌面端使用，不要仅为卸载 Web 而删除。

## 排查问题

服务默认保持终端安静。电脑和手机浏览器在「设置 → 关于」可下载诊断 ZIP。`application.json` 包含应用和 Agent 版本、浏览器环境、近期异常及服务端诊断，清单标明 ACP 运行时。

应用日志保存在内存中，服务端重启或浏览器刷新后分别清空，建议出现问题后尽快导出。服务端最多保留 2 MiB / 2,000 条日志，浏览器最多保留 100 条异常。下载标识绑定当前配对会话，仅可领取一次，5 分钟后失效；过期或失败时重新导出。内容与排查方法见[诊断指南](../desktop/docs/diagnostics.md)。

查看启动终端错误，确认实际地址、端口、Node.js 版本和网络，再运行：

```bash
codexly --version
codexly doctor
codexly start --help
```

`doctor` 检查 Node.js、已启用的 ACP 智能体握手和 SQLite。[常见问题](faq.md)
