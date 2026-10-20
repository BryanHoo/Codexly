# Web 登录自启动

[文档导航](README.md) · [Web 与移动端](web.md) · [English](web-autostart.md)

桌面应用请使用「设置 → 通用 → 开机启动」；本指南的后台 Web 服务可供电脑和移动浏览器访问，智能体运行于该服务所在主机。

此功能由 Web npm 包的 CLI 提供，用于当前用户登录系统后运行 Codexly。配置入口是 `codexly autostart`，本机和 LAN 模式均不打开浏览器。后台启动跳过启动前更新检查和终端询问，直接使用已安装版本。

## 配置与使用

需要 Node.js 24+ 和稳定的全局 npm 安装：

```bash
npm install --global @bryanhu/codexly@latest
codexly autostart enable
```

默认监听 `127.0.0.1`，起始端口为 3210，下次登录生效。配置 LAN 模式并立即启动：

```bash
codexly autostart enable --lan --port 3210 --now
codexly autostart status
codexly autostart credentials
```

`enable` 接受普通启动的 `--lan`、`--port`、`--lan-password`、`--session-ttl`、`--allowed-host`、`--codex-bin`、`--codex-home`、`--workspace`。目录参数会保存为绝对路径，`--allowed-host` 和 `--workspace` 可重复。`--now` 会停止旧托管实例并使用新配置启动，最多等待 120 秒检查就绪状态，以容纳首次 Codex Home 初始化；超时后可用 `status` 和 `logs` 继续检查。

每个系统用户管理一个登录项。再次执行 `enable` 会以本次参数及适用的 `CODEXLY_*` 环境默认值替换启动设置；只有已有的 LAN 密码会在仍启用 LAN 且未提供新密码时复用。例如 `enable --lan` 后执行 `enable` 会切换为本机模式。未指定 `--now` 时，已经运行的实例继续使用原配置；`status` 会提示存在未应用的修改。

```bash
codexly autostart logs         # 最近最多 64 KiB 的后台日志
codexly autostart restart      # 重启并等待就绪
codexly autostart disable      # 停止托管实例并移除登录项
codexly autostart repair --now # 保留启动设置，刷新 Node/CLI/PATH 并重启
```

端口占用沿用普通启动的自动递增规则，实际端口和当前局域网地址以 `status` 为准。LAN 服务无需等到 Wi-Fi 获得地址才监听。机器休眠时服务不能处理请求；登录启动不等于唤醒机器。

普通前台模式可以单独关闭浏览器自动打开：

```bash
codexly start --no-open
```

## 凭据与环境

LAN 自启动首次生成并保存高强度随机密码，之后重启复用。只有 `credentials` 显式输出密码；普通日志、状态输出和系统服务定义不会写入该密码。自定义密码仍要求 16–128 位并包含大写字母、小写字母和数字。服务重启会使所有旧 LAN 会话失效，需要重新输入固定密码。

配置中保存 `CODEX_HOME` 的解析结果、启动参数和启用时的 PATH，不会复制整个终端环境。登录启动不会读取 `.zshrc`、`.bashrc` 或 PowerShell profile。仅在交互 Shell 中设置的 API Key、代理等变量不会自动保存；需要使用 Codex 自身的持久化配置或操作系统的用户环境。指定 `--codex-bin` 时保存的是固定路径，需要随该可执行文件的迁移重新配置。

| 系统    | 私有配置目录                                      | 原生登录项                                        |
| ------- | ------------------------------------------------- | ------------------------------------------------- |
| macOS   | `~/Library/Application Support/Codexly/autostart` | `~/Library/LaunchAgents/io.codexly.web.plist`     |
| Windows | `%LOCALAPPDATA%\Codexly\autostart`                | `Codexly Web <当前用户 SID>` 计划任务             |
| Ubuntu  | `${XDG_CONFIG_HOME:-~/.config}/codexly/autostart` | 同一配置根下的 `systemd/user/codexly-web.service` |

目录中包含 `config.json`、运行状态与 `service.log`。Unix 私有目录为 0700、秘密文件为 0600；Windows 使用当前用户 ACL。日志保留当前文件和一个轮转文件，各最多 1 MiB。CLI 通过仅绑定回环地址、带随机令牌的本地控制通道查询真实就绪状态和请求优雅退出；日常运行无状态轮询管理进程。

`disable` 保留配置、凭据和日志，以便再次启用。需要彻底清理时，先 `disable`，再删除上述私有配置目录。卸载 npm 包之前也应先禁用；npm 卸载本身不会可靠清理系统登录项。

## 系统行为与排障

### macOS

使用当前桌面用户的 LaunchAgent。请在已登录的桌面会话中运行配置命令；仅通过 SSH 且没有图形登录域时无法登记。异常退出由 launchd 节流重启，正常停止不触发失败重启。

```bash
launchctl print gui/$(id -u)/io.codexly.web
plutil -lint ~/Library/LaunchAgents/io.codexly.web.plist
```

macOS 系统设置可能显示或允许禁用相关后台项目；被禁用后可再次 `enable`。系统策略拒绝时 CLI 会返回错误并尝试恢复原配置。

### Windows

计划任务仅在当前用户登录时触发，使用 `InteractiveToken` 和普通权限，不保存 Windows 密码，不配置开机触发器。任务取消默认执行时限与电池供电限制，重复登录不启动第二份实例，异常退出最多重试五次，间隔一分钟。

CLI 使用 Windows 自带的 PowerShell、Task Scheduler、Windows Script Host（JScript）和 `icacls`。企业策略禁止创建用户任务时命令会明确失败，不自动提升权限。需要更多系统诊断时，在任务计划程序中查看 `Codexly Web <SID>` 的历史和最后运行结果；`status` 也显示任务状态和结果数字。

登录后静默后台启动，不打开浏览器或可见的命令行窗口。计划任务通过图形脚本宿主以隐藏控制台方式启动 Node，等待其退出并回传退出码，保留异常重试能力。日志通过 `autostart logs` 查看，停止服务使用 `autostart disable`。已有登录项在更新后需要执行 `codexly autostart repair --now`，才能应用静默启动器。

### Ubuntu

需要可访问的 systemd 用户管理器和 `loginctl`。普通环境绑定 `default.target`，由用户登录启动，包括由 PAM 建立用户管理器的 TTY/SSH 登录。不会执行 `loginctl enable-linger`。

若已开启 linger，用户管理器可能在登录前启动。此时只允许在活动桌面会话中配置，并绑定 `graphical-session.target`；没有活动图形会话则报错。桌面环境必须实际管理该 target。之后改变 linger 设置时，请重新执行 `repair` 评估登录目标。此功能不支持无 systemd 用户会话的容器或 WSL 环境。

```bash
systemctl --user status codexly-web.service
journalctl --user -u codexly-web.service -n 50
loginctl show-user "$USER" --property=Linger
```

异常退出间隔 30 秒重试，五分钟内最多启动五次；达到上限后用 `autostart restart` 清除失败状态并重启。

### 更新与失败恢复

npm 包在原全局目录升级后继续使用同一 CLI 入口。切换 nvm/fnm/Homebrew 的 Node 版本或移动全局安装目录后，先确认新的全局 `codexly` 可运行，再执行 `autostart repair --now`。`npx`、临时缓存和项目内安装不能登记自启动。

启动失败首先运行 `status` 和 `logs`。配置损坏时应修复 `config.json`；也可以先 `disable`，备份并移除该文件后重新 `enable`。注册失败会尝试恢复之前的配置和已启用的登录项；回滚也失败时，会同时报告两项错误，需检查系统任务实际状态。

## 设计依据

- [Apple：Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [Microsoft：Task Scheduler 安全上下文](https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks)
- [Microsoft：任务设置与执行时限](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings)
- [systemd：桌面会话集成](https://systemd.io/DESKTOP_ENVIRONMENTS/)
- [PM2：Node 版本升级后更新启动配置](https://pm2.keymetrics.io/docs/usage/startup/)
