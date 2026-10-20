import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, rm, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Value } from "@sinclair/typebox/value";
import {
  ClaudeExtensionMutationSchema,
  type ClaudeExtension,
  type ClaudeExtensionKind,
  type ClaudeExtensionMutation,
  type ClaudeExtensionPage,
} from "@codexly/protocol";
import { renameStorageFile } from "./storage-rename.js";
import { claudeExtensionCommand, type ClaudeExtensionCommand } from "./extensions-cli.js";

type Json = Record<string, unknown>;
const object = (value: unknown): Json =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const text = (value: unknown) => (typeof value === "string" ? value : "");
async function read(path: string): Promise<Json> {
  try {
    return object(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Claude 配置无法读取，请修复 JSON 后重试", { cause: error });
  }
}
async function persist(path: string, value: Json) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await renameStorageFile(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Web 和桌面宿主共用原生配置与官方 CLI，不启动推理会话或 MCP 连接。 */
export class ClaudeExtensions {
  #write: Promise<unknown> = Promise.resolve();
  constructor(
    readonly userDirectory: string,
    readonly run: ClaudeExtensionCommand = claudeExtensionCommand(),
    readonly configPath = process.env["CLAUDE_CONFIG_DIR"]
      ? join(userDirectory, ".claude.json")
      : join(homedir(), ".claude.json"),
  ) {}

  async list(kind: ClaudeExtensionKind, cwd?: string): Promise<ClaudeExtensionPage> {
    return this.#list(kind, cwd ? await realpath(cwd) : undefined);
  }

  async #list(kind: ClaudeExtensionKind, cwd?: string): Promise<ClaudeExtensionPage> {
    if (kind === "plugins") return this.#plugins(cwd);
    const [native, user, project, local] = await Promise.all([
      read(this.configPath),
      read(join(this.userDirectory, "settings.json")),
      cwd ? read(join(cwd, ".claude", "settings.json")) : {},
      cwd ? read(join(cwd, ".claude", "settings.local.json")) : {},
    ]);
    if (kind === "mcp") {
      const context = object(object(native["projects"])[cwd ?? ""]);
      const disabled = strings(context["disabledMcpServers"]);
      const projectMcp = cwd ? await read(join(cwd, ".mcp.json")) : {};
      const merged = new Map<string, ClaudeExtension>();
      // 列表严格按配置归属分区；同一项目中，私有定义覆盖同名共享定义。
      const configurations = cwd
        ? ([
            ["project", projectMcp],
            ["local", context],
          ] as const)
        : ([["user", native]] as const);
      for (const [scope, config] of configurations) {
        for (const [name, value] of Object.entries(object(config["mcpServers"]))) {
          const server = object(value);
          merged.set(name, {
            id: name,
            name,
            scope,
            description: text(server["type"]) || "stdio",
            enabled: !disabled.includes(name),
            installed: true,
            mutable: true,
          });
        }
      }
      return { data: [...merged.values()] };
    }
    const overrides = {
      ...object(user["skillOverrides"]),
      ...object(object(project)["skillOverrides"]),
      ...object(object(local)["skillOverrides"]),
    };
    // 项目视图只读取项目目录，不把继承的全局 Skills 混入管理列表。
    const roots = cwd
      ? [{ scope: "project", path: join(cwd, ".claude", "skills") }]
      : [{ scope: "user", path: join(this.userDirectory, "skills") }];
    const merged = new Map<string, ClaudeExtension>();
    for (const root of roots) {
      let entries;
      try {
        entries = await readdir(root.path, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const path = join(root.path, entry.name, "SKILL.md");
        let content;
        try {
          content = await readFile(path, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1] ?? "";
        const field = (key: string) =>
          new RegExp(`^${key}:\\s*(.+)$`, "m")
            .exec(frontmatter)?.[1]
            ?.replace(/^["']|["']$/g, "") ?? "";
        const name = field("name") || entry.name;
        merged.set(name, {
          id: name,
          name,
          description: field("description"),
          scope: root.scope,
          enabled: overrides[name] !== "off",
          installed: true,
          mutable: true,
          path,
        });
      }
    }
    return { data: [...merged.values()] };
  }

  mutate(input: ClaudeExtensionMutation, cwd?: string): Promise<void> {
    if (!Value.Check(ClaudeExtensionMutationSchema, input))
      return Promise.reject(new Error("无效的 Claude 扩展操作"));
    const snapshot = structuredClone(input);
    // 全局串行化读改写，防止两个窗口同时切换时丢失无关配置。
    const pending = this.#write
      .catch(() => undefined)
      .then(async () => this.#mutate(snapshot, cwd ? await realpath(cwd) : undefined));
    this.#write = pending;
    return pending;
  }

  async #mutate(input: ClaudeExtensionMutation, cwd?: string) {
    const { kind, action, id, scope } = input;
    if (scope !== "user" && !cwd) throw new Error("请先选择项目");
    if (kind === "plugins") {
      if (action === "sync") {
        const marketplaces: unknown = JSON.parse(
          await this.run(["plugin", "marketplace", "list", "--json"], cwd ?? homedir()),
        );
        const known =
          Array.isArray(marketplaces) &&
          marketplaces.some((value) => object(value)["name"] === "claude-plugins-official");
        await this.run(
          known
            ? ["plugin", "marketplace", "update", "claude-plugins-official"]
            : ["plugin", "marketplace", "add", "anthropics/claude-plugins-official"],
          cwd ?? homedir(),
        );
        return;
      }
      if (
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]*@claude-plugins-official$/.test(id) ||
        !["enable", "disable", "install", "uninstall", "update"].includes(action)
      )
        throw new Error("仅支持官方目录的插件操作");
      await this.run(["plugin", action, id, "--scope", scope], cwd ?? homedir());
      return;
    }
    if (kind === "mcp") {
      const found = (await this.list("mcp", cwd)).data.find((item) => item.id === id);
      if (!found) throw new Error("MCP 服务不存在，请刷新后重试");
      if (action === "remove") {
        if (found.scope !== scope) throw new Error("MCP 配置作用域已变化，请刷新后重试");
        await this.run(["mcp", "remove", "--scope", scope, id], cwd ?? homedir());
        return;
      }
      if (!cwd || !["enable", "disable"].includes(action))
        throw new Error("MCP 启停按项目保存，请先选择项目");
      const native = await read(this.configPath),
        projects = object(native["projects"]),
        project = object(projects[cwd]);
      const disabled = strings(project["disabledMcpServers"]).filter((name) => name !== id);
      if (action === "disable") disabled.push(id);
      await persist(this.configPath, {
        ...native,
        projects: { ...projects, [cwd]: { ...project, disabledMcpServers: disabled } },
      });
      return;
    }
    if (!["enable", "disable"].includes(action))
      throw new Error("Skills 可见性支持启用或停用；安装请使用官方插件");
    if (!(await this.list("skills", cwd)).data.some((item) => item.id === id))
      throw new Error("Skill 不存在，请刷新后重试");
    const settingsPath =
      scope === "user"
        ? join(this.userDirectory, "settings.json")
        : join(cwd ?? "", ".claude", scope === "project" ? "settings.json" : "settings.local.json");
    const settings = await read(settingsPath);
    await persist(settingsPath, {
      ...settings,
      skillOverrides: {
        ...object(settings["skillOverrides"]),
        [id]: action === "enable" ? "on" : "off",
      },
    });
  }

  async #plugins(cwd?: string): Promise<ClaudeExtensionPage> {
    const result = object(
      JSON.parse(await this.run(["plugin", "list", "--json", "--available"], cwd ?? homedir())),
    );
    const installed = Array.isArray(result["installed"]) ? result["installed"] : [];
    const available = Array.isArray(result["available"]) ? result["available"] : [];
    const data: ClaudeExtension[] = [];
    for (const [rows, isInstalled] of [
      [installed, true],
      [available, false],
    ] as const) {
      for (const value of rows) {
        const item = object(value),
          id = text(item[isInstalled ? "id" : "pluginId"]);
        if (!id.endsWith("@claude-plugins-official")) continue;
        if (
          text(item["projectPath"]) &&
          (!cwd || resolve(text(item["projectPath"])) !== resolve(cwd))
        )
          continue;
        const scope = text(item["scope"]) || "user";
        if (!cwd && scope !== "user" && isInstalled) continue;
        data.push({
          id,
          name: id.split("@")[0] ?? id,
          description: text(item["description"]),
          scope,
          enabled: isInstalled && item["enabled"] === true,
          installed: isInstalled,
          mutable: ["user", "project", "local"].includes(scope),
          ...(typeof item["version"] === "string" ? { version: item["version"] } : {}),
        });
      }
    }
    return { data };
  }
}
