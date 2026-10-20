import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { ClaudeExtensions } from "./extensions.js";

const directories: string[] = [];
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, realpath: vi.fn(actual.realpath) };
});
afterEach(async () => {
  vi.mocked(fs.realpath).mockReset();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("reads and updates the native CLI project key for Windows paths", async () => {
  const { service, config } = await setup();
  const project = "C:\\Users\\runner\\project";
  const key = "C:/Users/runner/project";
  vi.mocked(fs.realpath).mockResolvedValueOnce(project);
  await writeFile(
    config,
    JSON.stringify({
      projects: {
        [key]: { mcpServers: { local: { command: "node" } }, trusted: true },
      },
    }),
  );
  expect((await service.list("mcp", project)).data.map((item) => item.name)).toEqual(["local"]);
  vi.mocked(fs.realpath).mockResolvedValueOnce(project).mockResolvedValueOnce(project);
  await service.mutate({ kind: "mcp", action: "disable", id: "local", scope: "local" }, project);
  const saved = JSON.parse(await readFile(config, "utf8")) as { projects: Record<string, unknown> };
  expect(saved.projects[key]).toMatchObject({ trusted: true, disabledMcpServers: ["local"] });
  expect(saved.projects[project]).toBeUndefined();
  vi.mocked(fs.realpath).mockResolvedValueOnce(project);
  expect((await service.list("mcp", project)).data[0]?.enabled).toBe(false);
});
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "claude-extensions-")));
  directories.push(root);
  const user = join(root, "user"),
    project = join(root, "project"),
    config = join(root, "claude.json");
  await mkdir(user);
  await mkdir(project);
  const run = vi.fn((_args: readonly string[], _cwd: string) => Promise.resolve("{}"));
  return { root, user, project, config, run, service: new ClaudeExtensions(user, run, config) };
}

it("discovers scoped MCP without exposing credentials and persists per-project toggles", async () => {
  const { service, project, config } = await setup();
  // 原生 CLI 在三个平台均使用正斜杠作为 JSON 项目键。
  const key = project.split(sep).join("/");
  await writeFile(
    config,
    JSON.stringify({
      secret: "preserved",
      mcpServers: { global: { command: "node", env: { TOKEN: "private-token" } } },
      projects: {
        [key]: {
          mcpServers: { local: { type: "http", url: "https://example.com?token=private-token" } },
        },
      },
    }),
  );
  await writeFile(
    join(project, ".mcp.json"),
    JSON.stringify({ mcpServers: { team: { command: "npx" } } }),
  );
  const page = await service.list("mcp", project);
  expect(page.data.map((item) => item.name).sort()).toEqual(["local", "team"]);
  expect((await service.list("mcp")).data.map((item) => item.name)).toEqual(["global"]);
  expect(JSON.stringify(page)).not.toContain("private-token");
  await service.mutate({ kind: "mcp", action: "disable", id: "team", scope: "project" }, project);
  const saved = JSON.parse(await readFile(config, "utf8")) as {
    secret: string;
    projects: Record<string, { disabledMcpServers: string[] }>;
  };
  expect(saved.secret).toBe("preserved");
  expect(saved.projects[key]?.disabledMcpServers).toEqual(["team"]);
  expect(
    (await service.list("mcp", project)).data.find((item) => item.name === "team")?.enabled,
  ).toBe(false);
});

it("uses skillOverrides without changing SKILL.md and prevents path traversal", async () => {
  const { service, project } = await setup();
  const directory = join(project, ".claude", "skills", "review");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "SKILL.md"),
    content = "---\nname: review\ndescription: Review changes\n---\nReview carefully.";
  await writeFile(path, content);
  expect((await service.list("skills", project)).data[0]?.description).toBe("Review changes");
  await service.mutate(
    { kind: "skills", action: "disable", id: "review", scope: "local" },
    project,
  );
  expect(
    (
      JSON.parse(await readFile(join(project, ".claude", "settings.local.json"), "utf8")) as {
        skillOverrides: { review: string };
      }
    ).skillOverrides.review,
  ).toBe("off");
  expect(await readFile(path, "utf8")).toBe(content);
  await expect(
    service.mutate(
      { kind: "skills", action: "disable", id: "../../escape", scope: "user" },
      project,
    ),
  ).rejects.toThrow();
});

it("lists only skills owned by the selected scope, including same-name skills", async () => {
  const { service, user, project } = await setup();
  for (const [root, name, description] of [
    [join(user, "skills"), "review", "Global review"],
    [join(user, "skills"), "global-only", "Global skill"],
    [join(project, ".claude", "skills"), "review", "Project review"],
    [join(project, ".claude", "skills"), "project-only", "Project skill"],
  ] as const) {
    const directory = join(root, name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\nInstructions.\n`,
    );
  }
  const global = await service.list("skills");
  expect(global.data.map((item) => item.name).sort()).toEqual(["global-only", "review"]);
  expect(global.data.find((item) => item.name === "review")?.description).toBe("Global review");
  expect(global.data.every((item) => item.scope === "user")).toBe(true);
  const scoped = await service.list("skills", project);
  expect(scoped.data.map((item) => item.name).sort()).toEqual(["project-only", "review"]);
  expect(scoped.data.find((item) => item.name === "review")?.description).toBe("Project review");
  expect(scoped.data.every((item) => item.scope === "project")).toBe(true);
});

it("uses official CLI lifecycle with explicit scopes and rejects unofficial plugins", async () => {
  const { service, run, project } = await setup();
  run.mockResolvedValueOnce(
    JSON.stringify({
      installed: [
        { id: "review@claude-plugins-official", scope: "project", enabled: true, version: "1" },
      ],
      available: [
        { pluginId: "design@claude-plugins-official", description: "Design UI" },
        { pluginId: "other@third-party" },
      ],
    }),
  );
  const page = await service.list("plugins", project);
  expect(page.data).toHaveLength(2);
  expect(page.data.find((item) => item.name === "design")?.installed).toBe(false);
  await service.mutate(
    { kind: "plugins", action: "install", id: "design@claude-plugins-official", scope: "project" },
    project,
  );
  expect(run).toHaveBeenCalledWith(
    ["plugin", "install", "design@claude-plugins-official", "--scope", "project"],
    project,
  );
  await expect(
    service.mutate(
      { kind: "plugins", action: "install", id: "evil@third-party", scope: "user" },
      project,
    ),
  ).rejects.toThrow();
  await expect(
    service.mutate({ kind: "mcp", action: "disable", id: "global", scope: "user" }),
  ).rejects.toThrow();
});
