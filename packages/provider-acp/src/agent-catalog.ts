import { findAgentExecutable, type AgentCommand } from "./agent-executable.js";
import { lstat, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  AcpAgentRegistrationSchema,
  isAgentEngine,
  type AcpAgentRegistration,
  type AcpAgentCatalogPage,
  type AcpAgentCatalogProgress,
  type AcpAgentInstallationStage,
  type AcpAgentOperation,
  type AgentEngine,
} from "@codexly/protocol";
import snapshot from "./registry-snapshot.json" with { type: "json" };
import type { AcpStorageLeases } from "./storage-lease.js";
import { installRegistryAgent, type RegistryAgent } from "./agent-installer.js";
import { findRegistryUpdate, isStableAgentVersion } from "./agent-registry-update.js";
interface Dependencies {
  find(name: string): Promise<string | undefined>;
  install(
    agent: RegistryAgent,
    directory: string,
    signal: AbortSignal,
    report: (progress: AcpAgentInstallationStage) => void,
  ): Promise<AgentCommand>;
}
const Installed = Type.Composite(
  [
    AcpAgentRegistrationSchema,
    Type.Object({
      managed: Type.Optional(
        Type.Object(
          {
            version: Type.String(),
            revision: Type.String({ pattern: "^revision-[0-9a-f-]{36}$" }),
          },
          { additionalProperties: false },
        ),
      ),
    }),
  ],
  { additionalProperties: false },
);
const RecordSchema = Type.Union([
  Installed,
  Type.Object(
    { engine: AcpAgentRegistrationSchema.properties.engine, removed: Type.Literal(true) },
    { additionalProperties: false },
  ),
]);
type Installation = Static<typeof Installed>;
type CatalogRecord = Static<typeof RecordSchema>;
const registered = (record: CatalogRecord | undefined): Installation | undefined =>
  record && !("removed" in record) ? record : undefined;
const registry = new Map(snapshot.agents.map((entry) => [engineOf(entry.id), entry]));
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
function engineOf(id: string): AgentEngine {
  return id === "codex-acp" ? "codex" : id === "claude-acp" ? "claude" : `acp-${id}`;
}
/** 每个 Agent 独立原子记录；持锁后重读，多个 Web/桌面宿主不能覆盖彼此配置。 */
export class AcpAgentCatalog {
  readonly #pending = new Map<AgentEngine, Promise<void>>();
  readonly #operations = new Map<AgentEngine, AcpAgentOperation>();
  readonly #detected = new Set<AgentEngine>();
  readonly #errors = new Map<AgentEngine, string>();
  #discovery: Promise<void> | undefined;
  #checked: number | undefined;
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
      install: (agent, path, signal, report) =>
        installRegistryAgent(agent, path, environment, signal, report),
      ...dependencies,
    };
  }
  progress(): AcpAgentCatalogProgress {
    return {
      ...(this.#checked === undefined
        ? {}
        : { discovery: { checked: this.#checked, total: registry.size } }),
      operations: [...this.#operations.values()],
    };
  }
  async #read(engine: AgentEngine): Promise<CatalogRecord | undefined> {
    if (!isAgentEngine(engine)) throw new Error("ACP Agent 标识无效");
    try {
      const file = join(this.directory, `${engine}.json`);
      if ((await stat(file)).size > 512 * 1024) throw new Error("ACP Agent 配置超出预算");
      const value: unknown = JSON.parse(await readFile(file, "utf8"));
      if (!Value.Check(RecordSchema, value) || value.engine !== engine)
        throw new Error("ACP Agent 配置损坏");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
  async #write(
    engine: AgentEngine,
    change: (
      current: CatalogRecord | undefined,
    ) => CatalogRecord | undefined | Promise<CatalogRecord | undefined>,
    rollback?: () => Promise<unknown>,
  ): Promise<void> {
    if (!isAgentEngine(engine)) throw new Error("ACP Agent 标识无效");
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
      if (!value) return;
      this.#controller.signal.throwIfAborted();
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(value));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, join(this.directory, `${engine}.json`));
    } catch (error) {
      await rollback?.();
      throw error;
    } finally {
      try {
        await rm(temporary, { force: true });
      } finally {
        await release();
      }
    }
  }
  #runtime(engine: AgentEngine): string {
    return join(this.directory, "runtimes", engine);
  }
  async #checkRuntimeParent(engine: AgentEngine): Promise<void> {
    // 安装和移除限定在应用目录；拒绝重定向运行时父目录的链接或 Windows junction。
    for (const path of [join(this.directory, "runtimes"), this.#runtime(engine)]) {
      const file = await lstat(path).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      if (file && !file.isDirectory()) throw new Error("Agent 私有运行时目录无效");
    }
  }
  #managed(record: Installation, entry: RegistryAgent): boolean {
    if (record.managed) return true;
    // 旧记录没有来源字段，只有应用目录内的入口或已知 uv 启动签名可作为托管安装更新。
    const path = entry.distribution.npx ? record.args[0] : record.command;
    if (path && isAbsolute(path)) {
      const child = relative(this.#runtime(record.engine), path);
      if (child && !isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
        return true;
    }
    const packageName = entry.distribution.uvx?.package.split(/@|==/, 1)[0];
    return (
      !!packageName &&
      /^uv(?:\.exe)?$/i.test(basename(record.command)) &&
      record.args[0] === "tool" &&
      record.args[1] === "run" &&
      record.args[2] === "--from" &&
      record.args[3]?.startsWith(`${packageName}==`) === true &&
      record.args[4] === "--"
    );
  }
  async #installedVersion(record: Installation, entry: RegistryAgent): Promise<string | undefined> {
    if (record.managed) return record.managed.version;
    // 旧版托管安装没有版本字段；优先读取已固定的包版本，避免迁移时重装同一版本。
    if (entry.distribution.uvx) {
      const version = record.args[3]?.split("==")[1];
      return isStableAgentVersion(version) ? version : undefined;
    }
    const npm = entry.distribution.npx;
    if (!npm) return undefined;
    const name = npm.package.slice(0, npm.package.lastIndexOf("@"));
    const file = join(this.#runtime(record.engine), "node_modules", name, "package.json");
    const version = await readFile(file, "utf8")
      .then((value) => (JSON.parse(value) as { version?: unknown }).version)
      .catch(() => undefined);
    return isStableAgentVersion(version) ? version : undefined;
  }
  async #discover(): Promise<void> {
    // 本进程只扫描一次；安装串行执行，避免启动时同时下载几十个运行时。
    this.#checked = 0;
    try {
      for (const [engine, entry] of registry) {
        this.#controller.signal.throwIfAborted();
        const names = aliases[entry.id] ?? [entry.id];
        let found: string | undefined;
        for (const name of names) {
          found = await this.#dependencies.find(name);
          if (found) break;
        }
        this.#checked += 1;
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
            await this.#install(engine, "automatic", found);
          else {
            const distribution = entry.distribution as RegistryAgent["distribution"];
            const binary = Object.values(distribution.binary ?? {})[0];
            const spec = distribution.npx ?? distribution.uvx ?? binary;
            await this.#operate(engine, entry.name, "automatic", async (report) => {
              report({ stage: "publishing" });
              await this.#write(engine, (current) =>
                current
                  ? undefined
                  : {
                      engine,
                      name: entry.name,
                      command: found,
                      args: spec?.args ?? [],
                      env: spec?.env ?? {},
                      enabled: true,
                    },
              );
            });
          }
        } catch {
          this.#errors.set(engine, "自动配置失败，请手动安装或配置后重试");
        }
      }
    } finally {
      this.#checked = undefined;
    }
  }
  async refresh(): Promise<AcpAgentCatalogPage> {
    const current = this.#discovery;
    // 同时到达的刷新合用一次扫描，进度计数不能被第二个扫描覆盖。
    await current?.catch(() => undefined);
    if (this.#discovery === current) {
      this.#detected.clear();
      this.#discovery = this.#discover();
    }
    return this.list();
  }
  async list(discover = true): Promise<AcpAgentCatalogPage> {
    if (discover) await (this.#discovery ??= this.#discover());
    let files: string[] = [];
    try {
      files = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const entries = new Map<AgentEngine, { name: string; description: string; version?: string }>(
      registry,
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
          const stored = await this.#read(engine);
          if (stored && "removed" in stored && !registry.has(engine)) return undefined;
          const record = registered(stored);
          const distribution = registry.get(engine);
          const canUpdate = record && distribution && this.#managed(record, distribution);
          const installedVersion = canUpdate
            ? await this.#installedVersion(record, distribution)
            : undefined;
          return {
            engine,
            name: record?.name ?? entry.name,
            description: entry.description,
            ...(entry.version ? { version: entry.version } : {}),
            ...(installedVersion ? { installedVersion } : {}),
            ...(canUpdate ? { canUpdate: true } : {}),
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
      ).then((rows) => rows.filter((row) => row !== undefined)),
    };
  }
  #operate(
    engine: AgentEngine,
    name: string,
    action: AcpAgentOperation["action"],
    work: (report: (progress: AcpAgentInstallationStage) => void) => Promise<void>,
  ): Promise<void> {
    if (this.#controller.signal.aborted) return Promise.reject(new Error("ACP Agent 目录已关闭"));
    const existing = this.#pending.get(engine);
    if (existing) {
      if (action === "automatic" || action === this.#operations.get(engine)?.action)
        return existing;
      return Promise.reject(new Error("Agent 正在执行其他操作，请稍后重试"));
    }
    const report = (progress: AcpAgentInstallationStage) => {
      this.#operations.set(engine, { engine, name, action, progress });
    };
    report({ stage: action === "remove" ? "removing" : "preparing" });
    const pending = work(report)
      .then(() => {
        this.#errors.delete(engine);
      })
      .finally(() => {
        this.#pending.delete(engine);
        this.#operations.delete(engine);
      });
    this.#pending.set(engine, pending);
    return pending;
  }
  install(engine: AgentEngine): Promise<void> {
    return this.#install(engine, "install");
  }
  update(engine: AgentEngine): Promise<void> {
    return this.#install(engine, "update");
  }
  #install(
    engine: AgentEngine,
    action: "automatic" | "install" | "update",
    detectedExecutable?: string,
  ): Promise<void> {
    const entry = registry.get(engine) as RegistryAgent | undefined;
    if (!entry) return Promise.reject(new Error("Agent 不在官方目录，请配置本机 ACP 启动命令"));
    return this.#operate(engine, entry.name, action, async (report) => {
      let staged: string | undefined;
      let previous: string | undefined;
      await this.#write(
        engine,
        async (stored) => {
          if (action === "automatic" && stored) return;
          const record = registered(stored);
          let release = entry;
          if (action === "update") {
            if (!record || !this.#managed(record, entry))
              throw new Error("此 Agent 由本机管理，请通过原安装方式更新");
            report({ stage: "checking" });
            // 持安装锁重读本地版本，另一宿主已更新时只检查目录，不重复下载。
            const installedVersion = await this.#installedVersion(record, entry);
            const update = await findRegistryUpdate(
              entry,
              installedVersion,
              this.#controller.signal,
            );
            if (!update) return;
            release = update;
          } else if (record) return { ...record, enabled: true };
          await this.#checkRuntimeParent(engine);
          // 每次安装使用新目录；更新失败或记录尚未发布时，旧路径仍然可用。
          const revision = `revision-${randomUUID()}`;
          const directory = join(this.#runtime(engine), revision);
          staged = directory;
          const command = await this.#dependencies.install(
            release,
            directory,
            this.#controller.signal,
            report,
          );
          report({ stage: "publishing" });
          if (record?.managed) previous = join(this.#runtime(engine), record.managed.revision);
          const env = { ...command.env, ...record?.env };
          if (detectedExecutable && (engine === "codex" || engine === "claude"))
            env[engine === "codex" ? "CODEX_PATH" : "CLAUDE_CODE_EXECUTABLE"] = detectedExecutable;
          return {
            ...command,
            engine,
            name: record?.name ?? entry.name,
            env,
            enabled: record?.enabled ?? true,
            managed: { version: release.version, revision },
          };
        },
        async () => {
          if (staged) await rm(staged, { recursive: true, force: true });
        },
      );
      // Windows 可能还在使用旧文件；不影响新版本，下次移除会再次清理。
      if (previous) await rm(previous, { recursive: true, force: true }).catch(() => undefined);
    });
  }
  remove(engine: AgentEngine): Promise<void> {
    return this.#operate(engine, registry.get(engine)?.name ?? engine, "remove", async () => {
      const runtime = this.#runtime(engine);
      let retired: string | undefined;
      await this.#write(
        engine,
        async (stored) => {
          if (!stored || "removed" in stored) return;
          await this.#checkRuntimeParent(engine);
          const trash = `${runtime}.removed-${randomUUID()}`;
          try {
            await rename(runtime, trash);
            retired = trash;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          // 只移除应用私有运行时，绝不根据配置里的 command 删除本机工具。
          // 原子发布移除记录，刷新和另一个宿主也不能把本机 CLI 自动接回。
          return { engine, removed: true };
        },
        async () => {
          if (retired) await rename(retired, runtime);
        },
      );
      if (retired)
        await rm(retired, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    });
  }
  async configure(input: AcpAgentRegistration): Promise<void> {
    if (!Value.Check(AcpAgentRegistrationSchema, input)) throw new Error("ACP Agent 配置无效");
    await this.#write(input.engine, (stored) => {
      const current = registered(stored);
      return {
        ...input,
        ...(input.env === undefined && current?.env ? { env: current.env } : {}),
        ...(current?.managed &&
        input.command === current.command &&
        input.args.length === current.args.length &&
        input.args.every((arg, index) => arg === current.args[index])
          ? { managed: current.managed }
          : {}),
      };
    });
    this.#errors.delete(input.engine);
  }
  async close(): Promise<void> {
    this.#controller.abort();
    await Promise.allSettled([this.#discovery, ...this.#pending.values()]);
  }
  async command(engine: AgentEngine): Promise<AgentCommand> {
    const record = registered(await this.#read(engine));
    if (!record?.enabled) throw new Error("请先在 ACP 中安装并启用此 Agent");
    return {
      command: record.command,
      args: record.args,
      ...(record.env ? { env: record.env } : {}),
    };
  }
}
