import { execFile } from "node:child_process";
import { access, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  type AutostartConfig,
  type AutostartPaths,
  type AutostartPlatform,
  writePrivateFile,
} from "./config.js";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type Execute = (command: string, args: readonly string[]) => Promise<CommandResult>;
const execFileAsync = promisify(execFile);
export const execute: Execute = async (command, args) => {
  try {
    const result = await execFileAsync(command, [...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 512 * 1024,
    });
    return { code: 0, ...result };
  } catch (error) {
    const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string };
    if (typeof failure.code !== "number") throw error;
    return {
      code: failure.code,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
    };
  }
};

function xml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}
function checkedText(text: string): string {
  if (text.split("").some((character) => character.charCodeAt(0) < 32))
    throw new Error("启动路径不能包含控制字符");
  return text;
}
function args(config: AutostartConfig, path: string): string[] {
  return [config.node, config.cli, "autostart", "run", "--config", path].map(checkedText);
}

export function renderLaunchAgent(config: AutostartConfig, path: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>io.codexly.web</string>
<key>ProgramArguments</key><array>${args(config, path)
    .map((arg) => `<string>${xml(arg)}</string>`)
    .join("")}</array>
<key>WorkingDirectory</key><string>${xml(checkedText(config.home))}</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>30</integer>
<key>ExitTimeOut</key><integer>20</integer>
<key>LimitLoadToSessionType</key><string>Aqua</string>
<key>ProcessType</key><string>Background</string>
</dict></plist>\n`;
}
function systemdQuote(text: string): string {
  // systemd 同时解释 specifier 与环境变量；即使参数加引号也需要转义 % 和 $。
  return `"${checkedText(text)
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/%/gu, "%%")
    .replace(/\$/gu, () => "$$")}"`;
}
export function renderSystemdUnit(config: AutostartConfig, path: string): string {
  const target = config.linuxTarget ?? "default.target";
  return `[Unit]
Description=Codexly Web (user login)
StartLimitIntervalSec=300
StartLimitBurst=5
${target === "graphical-session.target" ? "PartOf=graphical-session.target\n" : ""}
[Service]
Type=exec
ExecStart=${args(config, path)
    .map((arg) => systemdQuote(arg))
    .join(" ")}
WorkingDirectory=${checkedText(config.home).replace(/\\/gu, "\\\\").replace(/%/gu, "%%").replace(/ /gu, "\\x20")}
Restart=on-failure
RestartSec=30
TimeoutStopSec=20
KillMode=control-group
UMask=0077

[Install]
WantedBy=${target}
`;
}
function windowsQuote(text: string): string {
  // 遵循 Windows argv 转义规则，不经过 cmd.exe。
  return `"${text.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, "$1$1")}"`;
}
function windowsLauncherPath(configPath: string): string {
  return join(dirname(configPath), "launch.js");
}
function renderWindowsLauncher(config: AutostartConfig, path: string): string {
  const command = JSON.stringify(args(config, path).map(windowsQuote).join(" "))
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
  // GUI 脚本宿主隐藏 Node 控制台，等待退出并把退出码交回计划任务。
  // Run 会展开环境变量；单次展开整个命令，保留路径里的字面量 %NAME%。
  return `var shell = new ActiveXObject("WScript.Shell");
var environment = shell.Environment("Process");
environment("CODEXLY_AUTOSTART_COMMAND") = ${command};
WScript.Quit(shell.Run("%CODEXLY_AUTOSTART_COMMAND%", 0, true));
`;
}
export function renderWindowsTask(config: AutostartConfig, path: string, sid: string): string {
  args(config, path);
  const host = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "wscript.exe");
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>Codexly Web — current user login</Description></RegistrationInfo>
<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml(sid)}</UserId></LogonTrigger></Triggers>
<Principals><Principal id="CurrentUser"><UserId>${xml(sid)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>false</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><Enabled>true</Enabled><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>7</Priority><RestartOnFailure><Interval>PT1M</Interval><Count>5</Count></RestartOnFailure></Settings>
<Actions Context="CurrentUser"><Exec><Command>${xml(host)}</Command><Arguments>//B //Nologo //E:JScript ${xml(windowsQuote(windowsLauncherPath(path)))}</Arguments><WorkingDirectory>${xml(config.home)}</WorkingDirectory></Exec></Actions>
</Task>\n`;
}

export function selectLinuxTarget(
  linger: boolean,
  graphical: boolean,
): NonNullable<AutostartConfig["linuxTarget"]> {
  if (!linger) return "default.target";
  if (graphical) return "graphical-session.target";
  throw new Error(
    "当前用户开启了 linger 且没有活动桌面会话，无法保证仅登录后启动；请在桌面登录后配置，或自行调整 linger 设置。",
  );
}
export interface PlatformAdapter {
  prepare: (config: AutostartConfig) => Promise<AutostartConfig>;
  install: (config: AutostartConfig) => Promise<void>;
  remove: () => Promise<void>;
  restart: () => Promise<void>;
  stop: () => Promise<void>;
  status: () => Promise<{ enabled: boolean; registered?: boolean; detail: string }>;
}

export function createPlatformAdapter(
  platform: AutostartPlatform,
  paths: AutostartPaths,
  options: { execute?: Execute; uid?: number } = {},
): PlatformAdapter {
  const run = options.execute ?? execute;
  const uid = options.uid ?? process.getuid?.();
  const domain = `gui/${String(uid)}`;
  const label = `${domain}/io.codexly.web`;
  let sid: string | undefined;
  async function checked(command: string, argv: readonly string[]): Promise<string> {
    const result = await run(command, argv);
    if (result.code !== 0)
      throw new Error(
        `系统服务命令失败 (${command}): ${result.stderr || result.stdout || String(result.code)}`,
      );
    return result.stdout;
  }
  async function userSid(): Promise<string> {
    if (!sid) {
      const script = "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value";
      sid = (
        await checked("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ])
      ).trim();
      if (!/^S-1-[\d-]+$/u.test(sid)) throw new Error("无法确定当前 Windows 用户 SID");
    }
    return sid;
  }
  async function taskName(): Promise<string> {
    return `Codexly Web ${await userSid()}`;
  }
  async function windowsState(): Promise<{
    registered: boolean;
    enabled: boolean;
    state: number;
    lastResult: number;
  }> {
    // COM 返回结构化数字状态，避免解析受系统语言影响的 schtasks 文本输出。
    const script = `$ErrorActionPreference='Stop'; $s=New-Object -ComObject 'Schedule.Service'; $s.Connect(); try { $t=$s.GetFolder('\\').GetTask('${await taskName()}'); @{registered=$true;enabled=[bool]$t.Enabled;state=[int]$t.State;lastResult=[long]$t.LastTaskResult} | ConvertTo-Json -Compress } catch { $e=$_.Exception; while ($null -ne $e.InnerException) { $e=$e.InnerException }; if ($e.HResult -eq -2147024894 -or $e.HResult -eq -2147216625) { '{"registered":false,"enabled":false,"state":0,"lastResult":0}' } else { throw } }`;
    const value: unknown = JSON.parse(
      await checked("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ]),
    );
    if (
      !value ||
      typeof value !== "object" ||
      !("registered" in value) ||
      typeof value.registered !== "boolean" ||
      !("enabled" in value) ||
      typeof value.enabled !== "boolean" ||
      !("state" in value) ||
      typeof value.state !== "number" ||
      !("lastResult" in value) ||
      typeof value.lastResult !== "number"
    )
      throw new Error("无法读取 Windows 计划任务状态");
    return {
      registered: value.registered,
      enabled: value.enabled,
      state: value.state,
      lastResult: value.lastResult,
    };
  }
  async function exists(): Promise<boolean> {
    try {
      await access(paths.registration);
      return true;
    } catch {
      return false;
    }
  }
  const adapter: PlatformAdapter = {
    async prepare(config) {
      if (platform === "linux") {
        await checked("systemctl", ["--user", "show-environment"]);
        const linger = (
          await checked("loginctl", ["show-user", String(uid), "--property=Linger", "--value"])
        ).trim();
        if (linger !== "yes" && linger !== "no") throw new Error("无法确定用户 linger 状态");
        const graphical = await run("systemctl", [
          "--user",
          "is-active",
          "graphical-session.target",
        ]);
        return {
          ...config,
          linuxTarget: selectLinuxTarget(linger === "yes", graphical.code === 0),
        };
      }
      if (platform === "darwin") await checked("launchctl", ["print", domain]);
      if (platform === "win32") {
        // 根目录先去掉继承 ACL，仅授予当前用户；随后创建的凭据和状态文件继承此权限。
        await checked("icacls.exe", [
          paths.root,
          "/inheritance:r",
          "/grant:r",
          `*${await userSid()}:(OI)(CI)F`,
        ]);
      }
      return config;
    },
    async install(config) {
      if (platform === "darwin") {
        await writePrivateFile(paths.registration, renderLaunchAgent(config, paths.config));
        await checked("launchctl", ["enable", label]);
      } else if (platform === "linux") {
        // disable 只移除旧 target 的链接，不停止当前实例；新配置在 restart 或下次登录应用。
        if (await exists())
          await checked("systemctl", ["--user", "disable", "codexly-web.service"]);
        await writePrivateFile(paths.registration, renderSystemdUnit(config, paths.config));
        await checked("systemctl", ["--user", "daemon-reload"]);
        await checked("systemctl", ["--user", "enable", "codexly-web.service"]);
      } else {
        await writePrivateFile(
          windowsLauncherPath(paths.config),
          Buffer.from(`\uFEFF${renderWindowsLauncher(config, paths.config)}`, "utf16le"),
        );
        await writePrivateFile(
          paths.registration,
          // schtasks reads task files as UTF-16; the BOM also preserves non-ASCII paths.
          Buffer.from(
            `\uFEFF${renderWindowsTask(config, paths.config, await userSid())}`,
            "utf16le",
          ),
        );
        await checked("schtasks.exe", [
          "/Create",
          "/TN",
          await taskName(),
          "/XML",
          paths.registration,
          "/F",
        ]);
      }
    },
    async stop() {
      if (platform === "darwin") {
        if ((await run("launchctl", ["print", label])).code === 0) {
          await checked("launchctl", ["bootout", label]);
          // bootout 返回时旧任务可能仍在异步卸载；此时立即 bootstrap 会报 I/O 错误。
          // 只在显式管理操作中短暂轮询，确认服务已移除后再删除登记或重新加载。
          const deadline = Date.now() + 25_000;
          while ((await run("launchctl", ["print", label])).code === 0) {
            if (Date.now() >= deadline)
              throw new Error("launchd 未在 25 秒内完成卸载，请稍后重试自启动命令");
            await delay(100);
          }
        }
      } else if (platform === "linux") {
        if (await exists()) {
          const state = await checked("systemctl", [
            "--user",
            "show",
            "codexly-web.service",
            "--property=ActiveState",
            "--value",
          ]);
          if (state.trim() !== "inactive")
            await checked("systemctl", ["--user", "stop", "codexly-web.service"]);
        }
      } else {
        // CLI 先通过认证的本地控制通道请求优雅退出，/End 仅负责收尾系统任务。
        const state = await windowsState();
        if (state.registered && [2, 4].includes(state.state))
          await checked("schtasks.exe", ["/End", "/TN", await taskName()]);
      }
    },
    async restart() {
      if (platform === "darwin") {
        await adapter.stop();
        await checked("launchctl", ["bootstrap", domain, paths.registration]);
      } else if (platform === "linux") {
        await checked("systemctl", ["--user", "reset-failed", "codexly-web.service"]);
        await checked("systemctl", ["--user", "restart", "codexly-web.service"]);
      } else {
        await adapter.stop();
        await checked("schtasks.exe", ["/Run", "/TN", await taskName()]);
      }
    },
    async remove() {
      await adapter.stop();
      if (platform === "linux" && (await exists()))
        await checked("systemctl", ["--user", "disable", "codexly-web.service"]);
      if (platform === "win32" && (await windowsState()).registered)
        await checked("schtasks.exe", ["/Delete", "/TN", await taskName(), "/F"]);
      if (platform === "win32") await rm(windowsLauncherPath(paths.config), { force: true });
      await rm(paths.registration, { force: true });
      if (platform === "linux") await checked("systemctl", ["--user", "daemon-reload"]);
    },
    async status() {
      if (platform === "darwin") {
        const registered = await exists();
        const result = await run("launchctl", ["print-disabled", domain]);
        if (result.code !== 0) throw new Error(`无法查询 launchd: ${result.stderr}`);
        return {
          enabled: registered && !/"io\.codexly\.web"\s*=>\s*true/u.test(result.stdout),
          detail: paths.registration,
        };
      }
      if (platform === "linux") {
        const result = await run("systemctl", ["--user", "is-enabled", "codexly-web.service"]);
        if (result.stderr.includes("Failed to connect")) throw new Error(result.stderr);
        return {
          enabled: result.code === 0 && result.stdout.trim() === "enabled",
          detail: result.stdout.trim() || result.stderr.trim(),
        };
      }
      const name = await taskName();
      const state = await windowsState();
      return {
        enabled: state.registered && state.enabled,
        registered: state.registered,
        detail: state.registered
          ? `${name} (state=${String(state.state)}, lastResult=${String(state.lastResult)})`
          : "未注册",
      };
    },
  };
  return adapter;
}
