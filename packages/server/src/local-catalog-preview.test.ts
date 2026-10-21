import Database from "better-sqlite3";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  EngineProjectRouter,
  localTaskMetadata,
  type AgentExecutionAdapter,
} from "../../core/src/engine-router.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

const task = {
  id: "preview-task",
  projectId: null,
  title: "",
  cwd: "/work",
  provider: "codex",
  sessionId: "native-preview",
  updatedAt: 100,
  pinned: false,
  archived: false,
  status: "idle",
};

it("persists the user preview before execution so an interrupted title generator cannot lose it", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  await store.catalog("task.put", task);
  const startTurn = vi.fn(async () => {
    expect(await store.catalog("task.read", { id: task.id })).toMatchObject({
      preview: "首条用户请求",
    });
    throw new Error("Execution or title generation interrupted");
  });
  const adapter = { startTurn } as unknown as AgentExecutionAdapter;
  const router = new EngineProjectRouter(
    { kind: "temporary", id: "temporary", rootPath: root, runtimeWorkspaceRoots: [] },
    store,
    { codex: adapter, claude: adapter },
  );
  await expect(
    router.startTurn(
      task.id,
      {
        text: "首条用户请求\n后续行",
        files: [],
        images: [],
        skills: [],
        textAttachments: [],
      },
      {} as never,
    ),
  ).rejects.toThrow("interrupted");
  await store.close();
  const reopened = await openRepository(root);
  const saved = await reopened.catalog("task.read", { id: task.id });
  expect(saved && localTaskMetadata(saved).title).toBe("首条用户请求");
});

it("keeps the first preview after reopening without treating it as a generated name", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  await store.catalog("task.put", task);
  await store.catalog("task.preview", { id: task.id, preview: "  修复重启标题\n第二行  " });
  await store.catalog("task.preview", { id: task.id, preview: "后续消息不能改写" });
  await store.close();
  const reopened = await openRepository(root);
  const page = await reopened.catalog("task.list", { projectId: null, searchTerm: "重启" });
  expect(page.data).toHaveLength(1);
  expect(page.data[0]).toMatchObject({ title: "", preview: "修复重启标题", updatedAt: 100 });
  const loaded = page.data[0];
  expect(loaded && localTaskMetadata(loaded).title).toBe("修复重启标题");
  await reopened.catalog("task.patch", { id: task.id, title: "正式标题" });
  const renamed = await reopened.catalog("task.read", { id: task.id });
  expect(renamed && localTaskMetadata(renamed).title).toBe("正式标题");
});

it("recovers only missing previews by native session identity without changing management state", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  await store.catalog("task.put", { ...task, archived: true, pinned: true });
  await store.catalog("task.put", {
    ...task,
    id: "named",
    sessionId: "native-named",
    title: "手动标题",
  });
  const sourcePath = join(root, "native.sqlite");
  const source = new Database(sourcePath);
  source.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, preview TEXT NOT NULL)");
  source.prepare("INSERT INTO threads VALUES (?,?)").run(task.sessionId, "恢复旧预览\n保留正文");
  source.prepare("INSERT INTO threads VALUES (?,?)").run("native-named", "不覆盖手动名称");
  source.close();
  expect(await store.catalog("task.recoverPreviews", { databasePath: sourcePath })).toBe(1);
  expect(await store.catalog("task.recoverPreviews", { databasePath: sourcePath })).toBe(0);
  expect(await store.catalog("task.read", { id: task.id })).toMatchObject({
    title: "",
    preview: "恢复旧预览",
    archived: true,
    pinned: true,
    updatedAt: 100,
  });
  expect(await store.catalog("task.read", { id: "named" })).toMatchObject({ title: "手动标题" });
  expect(await store.catalog("task.read", { id: "native-preview" })).toBeNull();
});

it("upgrades an old catalog and restores previews during startup before listing tasks", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  await store.catalog("task.put", task);
  await store.close();
  const old = new Database(join(root, "state.sqlite3"));
  old.exec("DROP TABLE managed_task_previews");
  old.close();
  const source = new Database(join(root, "state_5.sqlite"));
  source.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, preview TEXT NOT NULL)");
  source.prepare("INSERT INTO threads VALUES (?,?)").run(task.sessionId, "启动时自动恢复");
  source.close();
  vi.stubEnv("CODEX_SQLITE_HOME", root);
  try {
    const reopened = await openRepository(root);
    const page = await reopened.catalog("task.list", { projectId: null });
    const loaded = page.data[0];
    expect(loaded && localTaskMetadata(loaded).title).toBe("启动时自动恢复");
    await reopened.catalog("task.remove", { id: task.id });
    expect(
      await reopened.catalog("task.recoverPreviews", {
        databasePath: join(root, "state_5.sqlite"),
      }),
    ).toBe(0);
    expect(await reopened.catalog("task.read", { id: task.id })).toBeNull();
  } finally {
    vi.unstubAllEnvs();
  }
});
