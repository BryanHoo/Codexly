import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import schema from "../../protocol/src/local-catalog-schema.json" with { type: "json" };
import { SqliteStateRepository } from "./sqlite-state-repository.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("merges Windows extended paths with the corresponding Web project", async () => {
  const root = await mkdtemp(join(tmpdir(), "codexly-windows-path-"));
  roots.push(root);
  const sources = [join(root, "web"), join(root, "desktop")];
  const databases: Database.Database[] = [];
  let repository: SqliteStateRepository | undefined;
  try {
    for (const [index, source] of sources.entries()) {
      await mkdir(source);
      const db = new Database(join(source, index === 0 ? "state.sqlite3" : "catalog.sqlite3"));
      databases.push(db);
      db.exec(schema.sql);
      db.prepare("INSERT INTO managed_projects VALUES (?,?,?,?,0)").run(
        `p${String(index)}`,
        "项目",
        index === 0 ? "C:\\Workspace" : "\\\\?\\C:\\Workspace",
        "2026-01-01",
      );
    }
    repository = await SqliteStateRepository.open(join(root, ".codexly", "state.sqlite3"), {
      legacyDirectories: sources,
    });
    expect(await repository.catalog("project.list", undefined)).toHaveLength(1);
  } finally {
    await repository?.close();
    databases.forEach((db) => db.close());
  }
});

it("merges Web and desktop WAL histories once and shares subsequent commits", async () => {
  const root = await mkdtemp(join(tmpdir(), "codexly-migrate-"));
  roots.push(root);
  const web = join(root, "old-web");
  const desktop = join(root, "old-desktop");
  const target = join(root, ".codexly", "state.sqlite3");
  await mkdir(web);
  await mkdir(desktop);
  const oldWeb = await SqliteStateRepository.open(join(web, "state.sqlite3"));
  const oldDesktop = new Database(join(desktop, "catalog.sqlite3"));
  oldDesktop.pragma("journal_mode = WAL");
  oldDesktop.pragma("wal_autocheckpoint = 0");
  oldDesktop.exec(schema.sql);
  oldDesktop
    .prepare("INSERT INTO managed_projects VALUES (?,?,?,?,?)")
    .run("desktop-project", "桌面", "/workspace", "2026-01-01", 0);
  oldDesktop
    .prepare("INSERT INTO managed_tasks VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(
      "desktop-task",
      "desktop-project",
      "Claude 历史",
      "/workspace",
      "claude",
      "claude-session",
      2,
      1,
      0,
      "idle",
    );
  await oldWeb.catalog("project.put", {
    id: "web-project",
    name: "Web",
    path: "/workspace",
    createdAt: "2026-01-01",
  });
  await oldWeb.catalog("task.put", {
    id: "web-task",
    projectId: "web-project",
    title: "Codex 历史",
    cwd: "/workspace",
    provider: "codex",
    sessionId: "codex-session",
    updatedAt: 1,
    pinned: false,
    archived: false,
    status: "idle",
  });
  await writeFile(join(desktop, "app.json"), '{"version":1,"preferences":{}}');
  await mkdir(join(desktop, "attachments", "desktop-project"), { recursive: true });
  await writeFile(join(desktop, "attachments", "desktop-project", "image.png"), "image");
  await writeFile(
    join(desktop, "agent-settings.json"),
    JSON.stringify({
      version: 1,
      global: {},
      projects: { "desktop-project": { model: "desktop-model" } },
    }),
  );
  await mkdir(join(desktop, "task-settings", "desktop-project"), { recursive: true });
  await writeFile(
    join(desktop, "task-settings", "desktop-project", "desktop-task.json"),
    JSON.stringify({
      version: 1,
      projectId: "desktop-project",
      taskId: "desktop-task",
      settings: {},
    }),
  );
  await mkdir(join(web, "engines", "claude"), { recursive: true });
  await writeFile(join(web, "engines", "claude", "history.json"), "history");
  let repository: SqliteStateRepository | undefined;
  try {
    repository = await SqliteStateRepository.open(target, { legacyDirectories: [web, desktop] });
    expect(
      (await repository.catalog("task.bindings", undefined)).map((task) => task.id).sort(),
    ).toEqual(["desktop-task", "web-task"]);
    expect((await repository.catalog("task.read", { id: "desktop-task" }))?.projectId).toBe(
      "web-project",
    );
    expect(await readFile(join(root, ".codexly", "app.json"), "utf8")).toContain('"version":1');
    expect(
      await readFile(join(root, ".codexly", "attachments", "web-project", "image.png"), "utf8"),
    ).toBe("image");
    const preferences = JSON.parse(
      await readFile(join(root, ".codexly", "agent-settings.json"), "utf8"),
    ) as { projects: Record<string, { model: string }> };
    expect(preferences.projects["web-project"]?.model).toBe("desktop-model");
    expect(
      JSON.parse(
        await readFile(
          join(root, ".codexly", "task-settings", "web-project", "desktop-task.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ projectId: "web-project" });
    expect(
      await readFile(join(root, ".codexly", "engines", "claude", "history.json"), "utf8"),
    ).toBe("history");
    const external = new Database(target);
    external
      .prepare("INSERT INTO managed_projects VALUES (?,?,?,?,?)")
      .run("external-project", "外部创建", "/external", "2026-01-01", 1);
    external.prepare("UPDATE managed_tasks SET title=? WHERE id=?").run("跨进程修改", "web-task");
    external.close();
    expect((await repository.catalog("task.read", { id: "web-task" }))?.title).toBe("跨进程修改");
    expect((await repository.read("external-project"))?.name).toBe("外部创建");
    await repository.catalog("task.remove", { id: "desktop-task" });
    await repository.close();
    repository = await SqliteStateRepository.open(target, { legacyDirectories: [web, desktop] });
    expect(await repository.catalog("task.read", { id: "desktop-task" })).toBeNull();
    expect(await oldWeb.catalog("task.read", { id: "web-task" })).not.toBeNull();
  } finally {
    await repository?.close();
    await oldWeb.close();
    oldDesktop.close();
  }
});
