# Web startup at login

[Documentation](README.md) · [Web and mobile](web.en.md) · [简体中文](web-autostart.zh-CN.md)

For the desktop app, use **Settings → General → Launch at login**. This guide manages the Web server used by computer and mobile browsers; agents execute on its host.

The Web npm package provides `codexly autostart` to run Codexly after the current user logs in. Both local and LAN modes keep the browser closed. Managed startup skips the initial update check and interactive prompts and uses the installed version.

## Configure and manage

Install Node.js 24+ and a stable global npm package:

```bash
npm install --global @bryanhu/codexly@latest
codexly autostart enable
```

The default is loopback access, starting from port 3210, on the next login. To enable LAN access and start immediately:

```bash
codexly autostart enable --lan --port 3210 --now
codexly autostart status
codexly autostart credentials
```

`enable` accepts `--lan`, `--port`, `--lan-password`, `--session-ttl`, `--allowed-host`, `--codex-bin`, `--codex-home`, and `--workspace`. Paths are saved as absolute paths; hosts and workspaces can be repeated. `--now` replaces the running managed instance and waits up to 120 seconds for readiness to allow a cold Codex Home to initialize. After a timeout, use `status` and `logs` to inspect the service.

Each system user has one managed login entry. Repeating `enable` replaces startup settings with the supplied arguments and applicable `CODEXLY_*` environment defaults. An existing LAN password is reused when LAN remains enabled and no replacement password is supplied. Running `enable` without `--lan` switches back to local mode. Without `--now`, changes take effect on restart or the next login; `status` reports pending changes.

```bash
codexly autostart logs         # Last 64 KiB of the bounded service log
codexly autostart restart      # Restart and wait for readiness
codexly autostart disable      # Stop and unregister the managed service
codexly autostart repair --now # Refresh Node/CLI/PATH, preserve settings, restart
```

Occupied ports are skipped as in normal startup. Use the actual URLs reported by `status`, which recomputes current LAN addresses. The LAN listener can start before Wi-Fi acquires an address. Login startup does not wake a sleeping computer.

To suppress browser opening for a foreground session:

```bash
codexly start --no-open
```

## Credentials and environment

LAN startup generates and saves a strong random password once, then reuses it. Only `credentials` explicitly displays it; ordinary logs, status output, and native service definitions do not contain it. Custom passwords must contain 16–128 characters, including uppercase, lowercase, and numbers. Every restart invalidates previous LAN sessions, requiring authentication with the saved password again.

The configuration freezes the resolved Codex home, startup arguments, and PATH. It does not copy the entire terminal environment. Login startup does not source shell profiles. API keys and proxy variables present only in an interactive shell are not persisted; use Codex's persistent configuration or the operating system's user environment. An explicit `--codex-bin` remains a fixed path and must be reconfigured when that executable moves.

| System  | Private configuration directory                   | Native entry                                                         |
| ------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Codexly/autostart` | `~/Library/LaunchAgents/io.codexly.web.plist`                        |
| Windows | `%LOCALAPPDATA%\Codexly\autostart`                | `Codexly Web <current user SID>` scheduled task                      |
| Ubuntu  | `${XDG_CONFIG_HOME:-~/.config}/codexly/autostart` | `systemd/user/codexly-web.service` under the same configuration base |

The directory contains `config.json`, runtime state, and `service.log`. Unix private directories use 0700 and secret files use 0600; Windows restricts access through the current user's ACL. Logs retain the active file and one rotated file, each bounded to 1 MiB. An authenticated loopback control channel provides actual readiness and graceful shutdown. No polling supervisor process runs alongside the service.

`disable` preserves configuration, credentials, and logs. To remove all data, disable first and then delete the private configuration directory. Disable before uninstalling the npm package: npm removal does not reliably remove native login entries.

## Platform behavior and troubleshooting

### macOS

Uses a LaunchAgent in the current desktop user's domain. Configure it from an existing desktop login; an SSH connection without a graphical login domain is insufficient. launchd throttles restarts after failures; successful exits do not trigger failure restarts.

```bash
launchctl print gui/$(id -u)/io.codexly.web
plutil -lint ~/Library/LaunchAgents/io.codexly.web.plist
```

macOS may expose controls for background items. Run `enable` again if the item has been disabled. System policy errors are reported and registration attempts roll back where possible.

### Windows

Uses a current-user logon trigger, `InteractiveToken`, and least privilege. No Windows password is saved and no boot trigger is registered. The task removes the default execution time and battery restrictions, ignores duplicate starts, and retries failures up to five times at one-minute intervals.

The CLI uses built-in PowerShell, Task Scheduler, and `icacls`. Policies that prohibit user tasks produce an error without automatic elevation. Inspect the named task's history and last result in Task Scheduler; `status` also reports numeric task state and last result.

Browser suppression is guaranteed by the application. Windows determines how the task's console is presented; Task Scheduler's `Hidden` setting is not treated as a console-hiding guarantee.

### Ubuntu

Requires an accessible systemd user manager and `loginctl`. Normal configurations use `default.target`, supporting desktop and PAM-managed TTY/SSH logins. The CLI never enables linger.

With linger enabled, the user manager can start before login. Configuration therefore requires an active graphical session and uses `graphical-session.target`. A headless linger configuration is rejected. The desktop must actually manage that target. Run `repair` after changing linger settings to reassess the login target. Containers or WSL environments without a systemd user session are unsupported.

```bash
systemctl --user status codexly-web.service
journalctl --user -u codexly-web.service -n 50
loginctl show-user "$USER" --property=Linger
```

Failure restarts wait 30 seconds and are limited to five starts in five minutes. `autostart restart` resets a failed unit before restarting it.

### Updates and recovery

An npm update in the same global directory preserves the CLI entry path. After changing Node versions with nvm/fnm/Homebrew or moving the installation, run the new global `codexly autostart repair --now`. Temporary `npx` caches and project-local installations cannot register startup.

Start diagnostics with `status` and `logs`. Repair a malformed `config.json`, or disable, back up and remove the file, then enable again. Failed registration attempts restore the previous configuration and enabled entry; failed rollback reports both errors so the native service state can be inspected.

## References

- [Apple: Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [Microsoft: Task Scheduler security contexts](https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks)
- [Microsoft: Task settings and execution limits](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings)
- [systemd: Desktop environment integration](https://systemd.io/DESKTOP_ENVIRONMENTS/)
- [PM2: Refresh startup configuration after Node upgrades](https://pm2.keymetrics.io/docs/usage/startup/)
