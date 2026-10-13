import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  applyStartEnvironmentDefaults,
  type ParsedCommandOptions,
} from "../cli-command-options.js";
import { parseSessionTtl, validateLanPassword } from "../lan-access.js";

export type AutostartPlatform = "darwin" | "linux" | "win32";
export interface AutostartConfig {
  version: 1;
  node: string;
  cli: string;
  home: string;
  environment: Record<string, string>;
  start: ParsedCommandOptions;
  linuxTarget?: "default.target" | "graphical-session.target";
}
export interface ConfigRuntime {
  node: string;
  cli: string;
  home: string;
  cwd: string;
  environment: NodeJS.ProcessEnv;
}
export interface AutostartPaths {
  root: string;
  config: string;
  state: string;
  log: string;
  registration: string;
}

export function getAutostartPaths(
  platform: string,
  home: string,
  env: NodeJS.ProcessEnv,
): AutostartPaths {
  const configHome =
    env["XDG_CONFIG_HOME"] && isAbsolute(env["XDG_CONFIG_HOME"])
      ? env["XDG_CONFIG_HOME"]
      : join(home, ".config");
  const root =
    platform === "darwin"
      ? join(home, "Library", "Application Support", "Codexly", "autostart")
      : platform === "linux"
        ? join(configHome, "codexly", "autostart")
        : platform === "win32"
          ? join(env["LOCALAPPDATA"] ?? join(home, "AppData", "Local"), "Codexly", "autostart")
          : undefined;
  if (!root) throw new Error(`当前系统不支持用户自启动: ${platform}`);
  return {
    root,
    config: join(root, "config.json"),
    state: join(root, "runtime.json"),
    log: join(root, "service.log"),
    registration:
      platform === "darwin"
        ? join(home, "Library", "LaunchAgents", "io.codexly.web.plist")
        : platform === "linux"
          ? join(configHome, "systemd", "user", "codexly-web.service")
          : join(root, "task.xml"),
  };
}

export function validateStartOptions(start: ParsedCommandOptions): void {
  if (start.lan !== true && (start.lanPassword !== undefined || start.sessionTtl !== undefined)) {
    throw new Error("--lan-password 和 --session-ttl 只能与 --lan 一起使用");
  }
  if (start.lanPassword !== undefined) validateLanPassword(start.lanPassword);
  if (start.sessionTtl !== undefined) parseSessionTtl(start.sessionTtl);
}

export function createConfig(
  options: ParsedCommandOptions,
  runtime: ConfigRuntime,
  previous?: AutostartConfig,
): AutostartConfig {
  const start = applyStartEnvironmentDefaults(options, runtime.environment);
  validateStartOptions(start);
  // 只冻结明确的启动参数与 PATH；终端里的 API Key 等秘密不应被整份复制到后台配置。
  start.noOpen = true;
  start.port ??= 3210;
  start.codexHome = resolve(
    runtime.cwd,
    start.codexHome ?? runtime.environment["CODEX_HOME"] ?? join(runtime.home, ".codex"),
  );
  if (start.codexBin) start.codexBin = resolve(runtime.cwd, start.codexBin);
  if (start.workspaceRoots)
    start.workspaceRoots = start.workspaceRoots.map((path) => resolve(runtime.cwd, path));
  if (start.lan) {
    // 添加固定前缀满足已有自定义密码校验，随机部分仍提供 192 bit 熵。
    start.lanPassword ??=
      previous?.start.lanPassword ?? `Aa1_${randomBytes(24).toString("base64url")}`;
  }
  return {
    version: 1,
    node: runtime.node,
    cli: runtime.cli,
    home: runtime.home,
    environment: runtime.environment["PATH"] ? { PATH: runtime.environment["PATH"] } : {},
    start,
  };
}

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error("自启动目录必须是实际目录");
  if (process.platform !== "win32") await chmod(path, 0o700);
}

export async function writePrivateFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    // 先完整写入同目录临时文件再替换，避免进程中断留下半份配置；秘密文件始终为 0600。
    await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await writePrivateFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
export function isMissing(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
export async function readConfig(path: string): Promise<AutostartConfig | undefined> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw new Error("无法读取自启动配置，请修复 config.json，或 disable 后移除该文件再 enable", {
      cause: error,
    });
  }
  try {
    const record = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value);
    const absolute = (value: unknown): value is string =>
      typeof value === "string" && isAbsolute(value);
    if (
      !record(raw) ||
      raw["version"] !== 1 ||
      ![raw["node"], raw["cli"], raw["home"]].every(absolute)
    )
      throw new Error("启动路径无效");
    const start = raw["start"];
    if (!record(start) || start["noOpen"] !== true || !absolute(start["codexHome"]))
      throw new Error("启动参数无效");
    const port = start["port"];
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("端口无效");
    if (start["lan"] !== undefined && typeof start["lan"] !== "boolean")
      throw new Error("模式无效");
    if (start["lan"] === true && typeof start["lanPassword"] !== "string")
      throw new Error("缺少 LAN 密码");
    if (start["lanPassword"] !== undefined && typeof start["lanPassword"] !== "string")
      throw new Error("LAN 密码无效");
    if (start["sessionTtl"] !== undefined && typeof start["sessionTtl"] !== "string")
      throw new Error("会话期限无效");
    if (start["codexBin"] !== undefined && !absolute(start["codexBin"]))
      throw new Error("Codex 路径无效");
    for (const key of ["workspaceRoots", "allowedHosts"]) {
      const entries = start[key];
      if (
        entries !== undefined &&
        (!Array.isArray(entries) ||
          !entries.every((entry: unknown) =>
            key === "workspaceRoots" ? absolute(entry) : typeof entry === "string",
          ))
      )
        throw new Error("列表参数无效");
    }
    const environment = raw["environment"];
    if (
      !record(environment) ||
      Object.entries(environment).some(
        ([key, entry]) => key !== "PATH" || typeof entry !== "string",
      )
    )
      throw new Error("环境配置无效");
    if (
      raw["linuxTarget"] !== undefined &&
      raw["linuxTarget"] !== "default.target" &&
      raw["linuxTarget"] !== "graphical-session.target"
    )
      throw new Error("登录目标无效");
    const value = raw as unknown as AutostartConfig;
    validateStartOptions(value.start);
    return value;
  } catch (error) {
    throw new Error(
      "自启动配置无效或版本不兼容，请修复 config.json，或 disable 后移除该文件再 enable",
      {
        cause: error,
      },
    );
  }
}
