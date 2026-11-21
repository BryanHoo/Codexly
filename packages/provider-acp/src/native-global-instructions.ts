import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { AgentEngine } from "@codexly/protocol";
import type { AgentInstructionsTargets } from "@codexly/protocol/application-preferences";
import type { AcpAgentCatalog } from "./agent-catalog.js";

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!missing(error)) throw error;
    const entry = await lstat(path).catch((cause: unknown) => {
      if (!missing(cause)) throw cause;
    });
    if (entry) throw error;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}

async function configuredContextFiles(directory: string, fallback: string): Promise<string[]> {
  if (!isAbsolute(directory)) return [];
  const settings = join(directory, "settings.json");
  try {
    const info = await stat(settings);
    if (!info.isFile() || info.size > 512 * 1024) return [];
    const parsed = JSON.parse(await readFile(settings, "utf8")) as {
      context?: { fileName?: unknown };
    } | null;
    const fileName = parsed?.context?.fileName;
    const names: unknown[] =
      fileName === undefined ? [fallback] : Array.isArray(fileName) ? fileName : [fileName];
    // 厂商的 context.fileName 可以更改默认文件；仅读取可确认的用户级文件名。
    if (
      names.length > 32 ||
      !names.every(
        (name): name is string =>
          typeof name === "string" &&
          name.endsWith(".md") &&
          !/[\\/\r\n]/u.test(name) &&
          !name.includes("\0"),
      )
    )
      return [];
    return names.map((name) => join(directory, name));
  } catch (error) {
    return missing(error) ? [join(directory, fallback)] : [];
  }
}

async function agentPaths(engine: AgentEngine, env: NodeJS.ProcessEnv): Promise<string[]> {
  const custom = env["CODEXLY_GLOBAL_INSTRUCTIONS_FILE"];
  if (custom) return isAbsolute(custom) ? [custom] : [];
  const home = homedir();
  const folder = (key: string, fallback: string) => {
    const directory = env[key];
    return (directory === "" ? undefined : directory) ?? join(home, fallback);
  };
  switch (engine) {
    case "codex": {
      const directory = folder("CODEX_HOME", ".codex");
      if (!isAbsolute(directory)) return [];
      const base = join(directory, "AGENTS.md");
      const override = join(directory, "AGENTS.override.md");
      // 清空覆盖文件会激活普通文件，两份现有规则都须纳入确认清单。
      try {
        await lstat(override);
        return [base, override];
      } catch (error) {
        if (!missing(error)) throw error;
        return [base];
      }
    }
    case "claude":
      return [join(folder("CLAUDE_CONFIG_DIR", ".claude"), "CLAUDE.md")];
    case "acp-gemini":
      return configuredContextFiles(join(folder("GEMINI_CLI_HOME", ""), ".gemini"), "GEMINI.md");
    case "acp-opencode":
    case "acp-opencode-v2":
      return [join(folder("XDG_CONFIG_HOME", ".config"), "opencode", "AGENTS.md")];
    case "acp-github-copilot-cli":
      return [join(folder("COPILOT_HOME", ".copilot"), "copilot-instructions.md")];
    case "acp-qwen-code":
      return configuredContextFiles(folder("QWEN_HOME", ".qwen"), "QWEN.md");
    default:
      return [];
  }
}

type FileTarget = AgentInstructionsTargets["files"][number] & { revision: string };

async function fileRevision(path: string): Promise<string> {
  try {
    const info = await stat(path, { bigint: true });
    if (!info.isFile()) throw new Error("全局指令目标必须是普通文件");
    return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join("/");
  } catch (error) {
    if (!missing(error)) throw error;
    return "";
  }
}

export async function nativeInstructionsPlan(
  catalog: AcpAgentCatalog,
  environment: NodeJS.ProcessEnv,
  previous: string | undefined,
): Promise<{ targets: AgentInstructionsTargets; files: FileTarget[] }> {
  const { agents } = await catalog.list(false);
  const files = new Map<string, FileTarget>();
  const unsupported: string[] = [];
  for (const agent of agents.filter(({ enabled, installed }) => enabled && installed)) {
    const command = await catalog.command(agent.engine);
    const paths = await agentPaths(agent.engine, { ...environment, ...command.env });
    if (!paths.length || paths.some((path) => !isAbsolute(path))) {
      unsupported.push(agent.name);
      continue;
    }
    for (const path of paths) {
      const canonical = await canonicalPath(path);
      const entry = files.get(canonical);
      if (entry) {
        if (!entry.agents.includes(agent.name)) entry.agents.push(agent.name);
      } else {
        const revision = await fileRevision(canonical);
        files.set(canonical, {
          agents: [agent.name],
          path: canonical,
          exists: !!revision,
          revision,
        });
      }
    }
  }
  const rows = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const row of rows) row.agents.sort();
  unsupported.sort();
  const version = createHash("sha256")
    .update(JSON.stringify([previous, rows, unsupported]))
    .digest("hex");
  return {
    files: rows,
    targets: { version, files: rows.map(({ revision: _revision, ...file }) => file), unsupported },
  };
}

export async function replaceNativeInstructions<T>(
  targets: FileTarget[],
  content: string,
  persist: () => Promise<T>,
): Promise<T> {
  const prepared: { target: FileTarget; directory: string; applied: boolean; written?: string }[] =
    [];
  let committed = false;
  try {
    // 先在目标所在磁盘准备新文件和回滚副本，全部就绪后才替换原文件。
    for (const target of targets) {
      await mkdir(dirname(target.path), { recursive: true, mode: 0o700 });
      if ((await canonicalPath(target.path)) !== target.path)
        throw new Error("全局指令文件位置已变化，请重新确认");
      const directory = await mkdtemp(join(dirname(target.path), ".codexly-instructions-"));
      prepared.push({ target, directory, applied: false });
      let mode = 0o600;
      if (target.exists) {
        mode = (await stat(target.path)).mode & 0o777;
        await copyFile(target.path, join(directory, "original"), constants.COPYFILE_EXCL);
      }
      const file = await open(join(directory, "new"), "wx", mode);
      try {
        await file.chmod(mode);
        await file.writeFile(content, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
    }
    for (const entry of prepared) {
      const { target, directory } = entry;
      if (
        (await canonicalPath(target.path)) !== target.path ||
        (await fileRevision(target.path)) !== target.revision
      )
        throw new Error("全局指令文件已变化，请重新确认");
      await rename(join(directory, "new"), target.path);
      entry.applied = true;
      entry.written = await fileRevision(target.path);
    }
    const saved = await persist();
    committed = true;
    return saved;
  } catch (error) {
    const failures: unknown[] = [];
    for (const entry of prepared.reverse()) {
      if (!entry.applied) continue;
      try {
        if ((await fileRevision(entry.target.path)) !== entry.written)
          throw new Error("全局指令文件已被其他程序修改", { cause: error });
        if (entry.target.exists) await rename(join(entry.directory, "original"), entry.target.path);
        else await rm(entry.target.path);
        entry.applied = false;
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    // 回滚冲突时在原文件旁保留副本，避免覆盖其他程序的后续编辑。
    if (failures.length)
      throw new AggregateError(failures, "同步失败，部分文件的备份保留在原目录", { cause: error });
    throw error;
  } finally {
    await Promise.allSettled(
      prepared
        .filter(({ applied }) => committed || !applied)
        .map(({ directory }) => rm(directory, { recursive: true, force: true })),
    );
  }
}
