import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { AcpConfigPreview, AcpConfigPreviewRequest } from "@codexly/protocol";
import type { AgentCommand } from "./agent-executable.js";
import type { AcpStoredSettings } from "./settings-store.js";
import { waitForAcpPreview } from "./config-preview.js";

const execute = promisify(execFile);

export async function readCodefreeModels(spec: AgentCommand, cwd: string, env: NodeJS.ProcessEnv) {
  // 仅原生入口支持 models 子命令。自定义启动器继续通过 ACP 提供模型。
  if (!/^codefree-o(?:\.exe)?$/i.test(basename(spec.command)) || spec.args.join(" ") !== "serve")
    return [];
  const { stdout } = await execute(spec.command, ["models"], {
    cwd,
    env: { ...env, ...spec.env },
    timeout: 5_000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  });
  // CLI 每行输出 provider/model。保留完整标识供 ACP 会话校验，忽略 banner 和诊断信息。
  const values = new Set(stdout.split(/\r?\n/).map((line) => line.trim()));
  return [...values].flatMap((value) => {
    const match = /^[\w.-]+\/([\w][\w./:@+-]{0,1023})$/.exec(value);
    const name = match?.[1];
    return name ? [{ value, name }] : [];
  });
}

export type ReadCodefreeModels = (cwd: string) => Promise<{ value: string; name: string }[]>;

export async function previewCodefreeModels(
  cwd: string,
  input: AcpConfigPreviewRequest,
  signal: AbortSignal | undefined,
  readModels: ReadCodefreeModels,
  cached: (
    load: (saved: AcpStoredSettings, revision?: string) => Promise<AcpConfigPreview>,
  ) => Promise<AcpConfigPreview>,
): Promise<AcpConfigPreview | "fallback" | undefined> {
  if (input.includeCommands || input.change || Object.keys(input.values).length) return;
  // 单个视图取消只会停止等待，共用的目录进程仍由自身的超时预算回收。
  const catalog = await waitForAcpPreview(
    cached(async (saved, revision) => {
      if (!revision) throw new Error("CodeFree O 尚未登录");
      const options = await readModels(cwd);
      if (!options.length) throw new Error("CodeFree O 原生模型目录为空");
      const currentValue =
        options.find(({ value }) => value === saved.values["model"])?.value ?? "";
      return {
        configOptions: [
          { id: "model", name: "模型", category: "model", type: "select", currentValue, options },
        ],
        values: currentValue ? { model: currentValue } : {},
      };
    }),
    signal,
  ).catch(() => undefined);
  signal?.throwIfAborted();
  return catalog ?? "fallback";
}
