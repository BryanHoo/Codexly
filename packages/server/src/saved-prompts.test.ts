import type { SavedPromptsRequest } from "@codexly/protocol";
import { expect, test } from "vitest";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

test("shares prompt mutations across connections and imports legacy records only once", async () => {
  const root = await createWorkspace();
  const web = await openRepository(root);
  const desktop = await openRepository(root);
  const prompt = { id: "legacy", name: "检查", content: "检查代码" };
  const sync = (store: typeof web, input: SavedPromptsRequest) =>
    store.catalog("prompts.sync", input);
  expect(await sync(web, { action: "import", prompts: [prompt] })).toEqual([prompt]);
  expect(
    await sync(desktop, { action: "save", prompt: { ...prompt, content: "桌面修改" } }),
  ).toEqual([{ ...prompt, content: "桌面修改" }]);
  expect(await sync(web, { action: "list" })).toEqual([{ ...prompt, content: "桌面修改" }]);
  await sync(web, { action: "remove", id: prompt.id });
  expect(await sync(desktop, { action: "import", prompts: [prompt] })).toEqual([]);
  await sync(web, { action: "save", prompt: { ...prompt, id: "new" } });
  await expect(
    sync(desktop, { action: "save", prompt: { ...prompt, id: "duplicate" } }),
  ).rejects.toThrow("duplicate");
});

test("atomically removes project prompts across connections while preserving global prompts", async () => {
  const root = await createWorkspace();
  const web = await openRepository(root);
  const desktop = await openRepository(root);
  await web.catalog("project.put", {
    id: "p",
    name: "项目",
    path: root,
    createdAt: "2026-11-03T00:00:00Z",
  });
  const prompt = { id: "global", name: "检查", content: "全局正文" };
  await web.catalog("prompts.sync", { action: "save", prompt });
  await desktop.catalog("prompts.sync", {
    action: "save",
    prompt: { ...prompt, id: "scoped", projectId: "p" },
  });
  await web.catalog("project.remove", { id: "p" });
  expect(await desktop.catalog("prompts.sync", { action: "list" })).toEqual([prompt]);
});

test("validates HTTP payloads and exposes the shared store without starting an engine", async () => {
  const { createCodexlyServer } = await import("./app.js");
  const { createProvider, createServerOptions } = await import("./app-all.test-support.js");
  const root = await createWorkspace();
  const store = await openRepository(root);
  const { provider } = createProvider();
  const app = await createCodexlyServer({
    ...createServerOptions(provider),
    tokenUsageStore: store,
  });
  try {
    const prompt = { id: "http", name: "接口检查", content: "检查内容" };
    const response = await app.inject({
      method: "POST",
      url: "/v1/saved-prompts",
      headers: { "idempotency-key": crypto.randomUUID() },
      payload: { action: "save", prompt },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual([prompt]);
    expect(await store.catalog("prompts.sync", { action: "list" })).toEqual([prompt]);
    const imported = await app.inject({
      method: "POST",
      url: "/v1/saved-prompts",
      headers: { "idempotency-key": "large-import" },
      payload: {
        action: "import",
        prompts: Array.from({ length: 30 }, (_, index) => ({
          id: `legacy-${String(index)}`,
          name: `旧提示词 ${String(index)}`,
          content: "中".repeat(20000),
        })),
      },
    });
    expect(imported.statusCode, imported.body.slice(0, 200)).toBe(200);

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/saved-prompts",
          headers: { "idempotency-key": crypto.randomUUID() },
          payload: { action: "save", prompt: { ...prompt, content: "" } },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/saved-prompts",
          headers: { "idempotency-key": crypto.randomUUID() },
          payload: { action: "save", prompt: { ...prompt, id: "duplicate" } },
        })
      ).statusCode,
    ).toBe(409);
  } finally {
    await app.close();
  }
});
