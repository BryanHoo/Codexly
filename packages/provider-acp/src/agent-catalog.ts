import { findAgentExecutable, type AgentCommand } from "./agent-executable.js";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import {
  AcpAgentRegistrationSchema,
  isAgentEngine,
  type AcpAgentRegistration,
  type AcpAgentCatalogPage,
  type AgentEngine,
} from "@codexly/protocol";
import snapshot from "./registry-snapshot.json" with { type: "json" };
import type { AcpStorageLeases } from "./storage-lease.js";
import { installRegistryAgent, type RegistryAgent } from "./agent-installer.js";
interface Dependencies {
  find(name: string): Promise<string | undefined>;
  install(agent: RegistryAgent, directory: string, signal?: AbortSignal): Promise<AgentCommand>;
}
const aliases: Record<string, string[]> = {
  "codex-acp": ["codex"],
  "claude-acp": ["claude"],
  gemini: ["gemini"],
  cursor: ["cursor-agent"],
  "github-copilot-cli": ["copilot"],
  "qwen-code": ["qwen"],
  "mistral-vibe": ["vibe-acp"],
  "codebuddy-code": ["codebuddy"],
  "pi-acp": ["pi"],
  "factory-droid": ["droid"],
  "kimi-code": ["kimi-code"],
  "fast-agent": ["fast-agent-acp"],
  "grok-build": ["grok"],
  "antigravity-acp": ["agy_acp_server"],
};
const engineOf = (id: string): AgentEngine =>
  id === "codex-acp" ? "codex" : id === "claude-acp" ? "claude" : `acp-${id}`;
/** 每个 Agent 独立原子记录；持锁后重读，多个 Web/桌面宿主不能覆盖彼此配置。 */
export class AcpAgentCatalog {
  readonly #pending = new Map<AgentEngine, Promise<void>>();
  readonly #detected = new Set<AgentEngine>();
  readonly #errors = new Map<AgentEngine, string>();
  #discovery: Promise<void> | undefined;
  readonly #controller = new AbortController();
  readonly #dependencies: Dependencies;
  constructor(
    readonly directory: string,
    dependencies: Partial<Dependencies> = {},
    readonly leases?: AcpStorageLeases,
    environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.#dependencies = {
      find: (name) => findAgentExecutable(name, environment),
      install: (agent, path, signal) => installRegistryAgent(agent, path, environment, signal),
      ...dependencies,
    };
  }
  async #read(engine: AgentEngine): Promise<AcpAgentRegistration | undefined> {
    if (!isAgentEngine(engine)) throw new Error("ACP Agent 标识无效");
    try {
      const file = join(this.directory, `${engine}.json`);
      if ((await stat(file)).size > 512 * 1024) throw new Error("ACP Agent 配置超出预算");
      const value: unknown = JSON.parse(await readFile(file, "utf8"));
      if (!Value.Check(AcpAgentRegistrationSchema, value) || value.engine !== engine)
        throw new Error("ACP Agent 配置损坏");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
  async #write(
    engine: AgentEngine,
    change: (current: AcpAgentRegistration | undefined) => Promise<AcpAgentRegistration>,
  ): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lock = this.leases
      ? undefined
      : await open(join(this.directory, `${engine}.lock`), "wx", 0o600).catch(() => {
          throw new Error("ACP Agent 正由另一宿主配置，请重试");
        });
    const release = this.leases
      ? await this.leases.acquire(`agents:${join(this.directory, engine)}`)
      : async () => {
          await lock?.close();
          await rm(join(this.directory, `${engine}.lock`), { force: true });
        };
    const temporary = join(this.directory, `${engine}.${randomUUID()}.tmp`);
    try {
      const value = await change(await this.#read(engine));
      this.#controller.signal.throwIfAborted();
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(value));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, join(this.directory, `${engine}.json`));
    } finally {
      await rm(temporary, { force: true });
      await release();
    }
  }
  async #discover(): Promise<void> {
    // 本进程只扫描一次；安装串行执行，避免启动时同时下载几十个运行时。
    for (const entry of snapshot.agents) {
      this.#controller.signal.throwIfAborted();
      const engine = engineOf(entry.id);
      const names = aliases[entry.id] ?? [entry.id];
      let found: string | undefined;
      for (const name of names) {
        found = await this.#dependencies.find(name);
        if (found) break;
      }
      if (!found) continue;
      this.#detected.add(engine);
      if (await this.#read(engine)) continue; // 明确停用或自定义配置优先，不能被自动检测覆盖。
      try {
        if (
          entry.id === "codex-acp" ||
          entry.id === "claude-acp" ||
          entry.id === "pi-acp" ||
          /\.(cmd|bat)$/i.test(found)
        )
          await this.install(engine, found);
        else {
          const distribution = entry.distribution as RegistryAgent["distribution"];
          const binary = Object.values(distribution.binary ?? {})[0];
          const spec = distribution.npx ?? distribution.uvx ?? binary;
          await this.configure({
            engine,
            name: entry.name,
            command: found,
            args: spec?.args ?? [],
            env: spec?.env ?? {},
            enabled: true,
          });
        }
      } catch {
        this.#errors.set(engine, "自动配置失败，请手动安装或配置后重试");
      }
    }
  }
  async refresh(): Promise<AcpAgentCatalogPage> {
    await this.#discovery;
    this.#detected.clear();
    this.#discovery = this.#discover();
    return this.list();
  }
  async list(discover = true): Promise<AcpAgentCatalogPage> {
    if (discover) await (this.#discovery ??= this.#discover());
    const { readdir } = await import("node:fs/promises");
    let files: string[] = [];
    try {
      files = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const entries = new Map<AgentEngine, { name: string; description: string; version?: string }>(
      snapshot.agents.map((a) => [engineOf(a.id), a]),
    );
    for (const file of files)
      if (
        file.endsWith(".json") &&
        isAgentEngine(file.slice(0, -5)) &&
        !entries.has(file.slice(0, -5) as AgentEngine)
      )
        entries.set(file.slice(0, -5) as AgentEngine, { name: file.slice(0, -5), description: "" });
    return {
      agents: await Promise.all(
        [...entries].map(async ([engine, entry]) => {
          const record = await this.#read(engine);
          return {
            engine,
            name: record?.name ?? entry.name,
            description: entry.description,
            ...(entry.version ? { version: entry.version } : {}),
            installed: !!record,
            enabled: record?.enabled ?? false,
            detected: this.#detected.has(engine),
            environmentKeys: Object.keys(record?.env ?? {}),
            ...(record ? { command: record.command, args: record.args } : {}),
            ...(this.#errors.has(engine)
              ? { error: this.#errors.get(engine) ?? "自动配置失败" }
              : {}),
          };
        }),
      ),
    };
  }
  install(engine: AgentEngine, detectedExecutable?: string): Promise<void> {
    if (this.#controller.signal.aborted) return Promise.reject(new Error("ACP Agent 目录已关闭"));
    const existing = this.#pending.get(engine);
    if (existing) return existing;
    const entry = snapshot.agents.find((a) => engineOf(a.id) === engine) as
      RegistryAgent | undefined;
    if (!entry) return Promise.reject(new Error("Agent 不在官方目录，请配置本机 ACP 启动命令"));
    const pending = this.#write(engine, async (current) => {
      if (current) return { ...current, enabled: true };
      const command = await this.#dependencies.install(
        entry,
        join(this.directory, "runtimes", engine),
        this.#controller.signal,
      );
      return {
        engine,
        name: entry.name,
        ...command,
        ...(detectedExecutable && (engine === "codex" || engine === "claude")
          ? {
              env: {
                ...command.env,
                [engine === "codex" ? "CODEX_PATH" : "CLAUDE_CODE_EXECUTABLE"]: detectedExecutable,
              },
            }
          : {}),
        enabled: true,
      };
    })
      .then(() => {
        this.#errors.delete(engine);
      })
      .finally(() => {
        this.#pending.delete(engine);
      });
    this.#pending.set(engine, pending);
    return pending;
  }
  async configure(input: AcpAgentRegistration): Promise<void> {
    if (!Value.Check(AcpAgentRegistrationSchema, input)) throw new Error("ACP Agent 配置无效");
    await this.#write(input.engine, (current) =>
      Promise.resolve({
        ...input,
        ...(input.env === undefined && current?.env ? { env: current.env } : {}),
      }),
    );
    this.#errors.delete(input.engine);
  }
  async close(): Promise<void> {
    this.#controller.abort();
    await Promise.allSettled([this.#discovery, ...this.#pending.values()]);
  }
  async command(engine: AgentEngine): Promise<AgentCommand> {
    const record = await this.#read(engine);
    if (!record?.enabled) throw new Error("请先在 ACP 中安装并启用此 Agent");
    return {
      command: record.command,
      args: record.args,
      ...(record.env ? { env: record.env } : {}),
    };
  }
}
