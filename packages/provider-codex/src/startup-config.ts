import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RpcErrorPayload } from "./jsonl-rpc-client.js";

const execFileAsync = promisify(execFile);
const OUTPUT_LIMIT = 1_048_576;

export interface CodexStartupConfig {
  appServerVersion: string;
  configRequirements: {
    requirements: Record<string, unknown> | null;
    supportsIndependentSpeedModes?: boolean | null;
  };
}

interface ProbeOptions {
  cwd?: string | undefined;
  env: NodeJS.ProcessEnv;
  encoding: "utf8";
  timeout: number;
  maxBuffer: number;
  killSignal: "SIGKILL";
  windowsHide: boolean;
}

export interface ReadCodexStartupConfigOptions {
  appVersion?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  execute?: (
    binaryPath: string,
    args: string[],
    options: ProbeOptions,
  ) => Promise<{ stdout: string; exitCode: number }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 保留上游错误供诊断使用；显示白名单字段，避免把任意 stdout 当成配置错误。 */
export class CodexStartupConfigError extends Error {
  public constructor(public readonly error: RpcErrorPayload) {
    const data = isRecord(error.data) ? error.data : {};
    const reason = typeof data["reason"] === "string" ? ` [${data["reason"]}]` : "";
    let location = typeof data["filePath"] === "string" ? data["filePath"] : "";
    // 上游配置诊断已使用 1 起始行列，直接保留；无文件时不拼接孤立行列。
    if (location && Number.isInteger(data["line"]) && Number(data["line"]) >= 1) {
      location += `:${String(data["line"])}`;
      if (Number.isInteger(data["column"]) && Number(data["column"]) >= 1)
        location += `:${String(data["column"])}`;
    }
    const detail = typeof data["detail"] === "string" ? `: ${data["detail"]}` : "";
    const action = data["action"] === "relogin" ? "；请重新登录 Codex 后重试" : "";
    super(
      `Codex 配置预检失败${reason}: ${error.message}${location ? ` (${location})` : ""}${detail}${action}`,
    );
    this.name = "CodexStartupConfigError";
  }
}

async function executeProbe(binaryPath: string, args: string[], options: ProbeOptions) {
  try {
    const { stdout } = await execFileAsync(binaryPath, args, options);
    return { stdout, exitCode: 0 };
  } catch (error) {
    // Codex 在配置错误时先向 stdout 写 JSON，再以非零状态退出，必须保留该响应。
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "number" &&
      "stdout" in error &&
      typeof error.stdout === "string" &&
      !("signal" in error && error.signal)
    ) {
      return { stdout: error.stdout, exitCode: error.code };
    }
    throw error;
  }
}

/** 仅供手动 doctor 和启动失败诊断调用；不启动常驻服务，也不传入有副作用的注销参数。 */
export async function readCodexStartupConfig(
  binaryPath: string,
  options: ReadCodexStartupConfigOptions = {},
): Promise<CodexStartupConfig> {
  let output: { stdout: string; exitCode: number };
  try {
    output = await (options.execute ?? executeProbe)(
      binaryPath,
      [
        "app-server",
        "--enable",
        "plugins",
        "--print-startup-config",
        "--startup-client-info",
        JSON.stringify({
          name: "codexly",
          title: "Codexly",
          version: options.appVersion ?? "0.0.0",
        }),
      ],
      {
        cwd: options.cwd,
        env: { ...(options.env ?? process.env) },
        encoding: "utf8",
        timeout: options.timeoutMs ?? 10_000,
        maxBuffer: OUTPUT_LIMIT,
        killSignal: "SIGKILL",
        windowsHide: true,
      },
    );
  } catch (error) {
    throw new Error("Codex 配置预检执行失败（进程不可用、超时或输出超限）", { cause: error });
  }
  if (Buffer.byteLength(output.stdout, "utf8") > OUTPUT_LIMIT)
    throw new Error("Codex 配置预检输出超过 1 MiB");
  let value: unknown;
  try {
    value = JSON.parse(output.stdout);
  } catch {
    throw new Error("Codex 配置预检输出无效");
  }
  if (!isRecord(value)) throw new Error("Codex 配置预检输出无效");
  if ("error" in value) {
    const error = value["error"];
    if (
      "appServerVersion" in value ||
      "configRequirements" in value ||
      !isRecord(error) ||
      !Number.isInteger(error["code"]) ||
      typeof error["message"] !== "string"
    )
      throw new Error("Codex 配置预检输出无效");
    throw new CodexStartupConfigError(error as unknown as RpcErrorPayload);
  }
  if (output.exitCode !== 0) throw new Error(`Codex 配置预检进程退出 (${String(output.exitCode)})`);
  const requirements = value["configRequirements"];
  if (
    typeof value["appServerVersion"] !== "string" ||
    !value["appServerVersion"] ||
    !isRecord(requirements) ||
    !(requirements["requirements"] === null || isRecord(requirements["requirements"])) ||
    !(
      requirements["supportsIndependentSpeedModes"] === undefined ||
      requirements["supportsIndependentSpeedModes"] === null ||
      typeof requirements["supportsIndependentSpeedModes"] === "boolean"
    )
  )
    throw new Error("Codex 配置预检输出无效");
  return value as unknown as CodexStartupConfig;
}
