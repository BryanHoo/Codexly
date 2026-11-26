import Database from "better-sqlite3";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import definition from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
it("资源分块封存后与定义原子绑定，重启保留原字节且隔离项目", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const call = (op: string, p: unknown) => store.catalog(op as never, p as never);
  const key = { source: "web", scheduleId: "plan", projectId: "p", token: "resource-token" };
  const attachment = {
    id: "a",
    kind: "file",
    mediaType: "application/octet-stream",
    name: "a.bin",
    size: 4,
  };
  await call("acp.resource.begin", { ...key, attachment });
  await call("acp.resource.append", { ...key, offset: 0, content: new Uint8Array([0, 255]) });
  await call("acp.resource.append", { ...key, offset: 0, content: new Uint8Array([0, 255]) });
  await expect(call("acp.resource.seal", key)).rejects.toThrow();
  await call("acp.resource.append", { ...key, offset: 2, content: new Uint8Array([128, 1]) });
  const sealed = await call("acp.resource.seal", key);
  expect(sealed).toMatchObject({
    digest: createHash("sha256")
      .update(new Uint8Array([0, 255, 128, 1]))
      .digest("hex"),
  });
  const body = { ...definition, prompt: { ...definition.prompt, attachments: [{ id: "a" }] } };
  expect(
    await call("acp.plan.save", {
      source: "web",
      scheduleId: "plan",
      definition: body,
      expectedRevision: 0,
      resources: [key.token],
    }),
  ).toMatchObject({ revision: 1 });
  // 旧版仍会整体替换计划并清理孤立附件，新私有资源不能被这一清理路径触碰。
  await store.replaceScheduledTasks([]);
  expect(await store.listScheduledTasks()).toEqual([]);
  expect(await call("acp.resource.chunk", { ...key, offset: 2 })).toEqual(new Uint8Array([128, 1]));
  await store.close();
  const fresh = await openRepository(root);
  const read = (op: string, p: unknown) => fresh.catalog(op as never, p as never);
  expect(await read("acp.resource.chunk", { ...key, offset: 0 })).toEqual(new Uint8Array([0, 255]));
  await expect(
    read("acp.resource.chunk", { ...key, projectId: "foreign", offset: 0 }),
  ).rejects.toThrow();
  expect(
    await read("acp.plan.save", {
      source: "web",
      scheduleId: "plan",
      definition,
      expectedRevision: 0,
      resources: [],
    }),
  ).toBeNull();
  expect(
    await read("acp.resource.list", {
      source: "web",
      scheduleId: "plan",
      projectId: "p",
      expectedRevision: 1,
    }),
  ).toHaveLength(1);
});

it("资源绑定失败回滚定义和旧字节，运行中不能替换，删除级联资源", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const call = (op: string, p: unknown) => store.catalog(op as never, p as never);
  const scope = { source: "web", scheduleId: "plan", projectId: "p" };
  const stage = async (token: string, id: string) => {
    const k = { ...scope, token };
    await call("acp.resource.begin", {
      ...k,
      attachment: {
        id,
        kind: "file",
        mediaType: "application/octet-stream",
        name: "file",
        size: 1,
      },
    });
    await call("acp.resource.append", { ...k, offset: 0, content: new Uint8Array([42]) });
    await call("acp.resource.seal", k);
  };
  await stage("old", "a");
  await stage("new", "b");
  const body = (id: string) => ({
    ...definition,
    prompt: { ...definition.prompt, attachments: [{ id }] },
  });
  await call("acp.plan.save", {
    ...scope,
    definition: body("a"),
    expectedRevision: 0,
    resources: ["old"],
  });
  const db = new Database(join(root, "state.sqlite3"));
  try {
    const version = db.pragma("user_version", { simple: true });
    db.exec(
      "CREATE TRIGGER block_bind BEFORE UPDATE ON acp_plan_resources WHEN OLD.bound_source IS NULL AND NEW.bound_source IS NOT NULL BEGIN SELECT RAISE(ABORT,'bind failed'); END;",
    );
    await expect(
      call("acp.plan.save", {
        ...scope,
        definition: body("b"),
        expectedRevision: 1,
        resources: ["new"],
      }),
    ).rejects.toThrow("bind failed");
    expect(await call("acp.plan.read", scope)).toMatchObject({
      revision: 1,
      definition: { prompt: { attachments: [{ id: "a" }] } },
    });
    expect(await call("acp.resource.chunk", { ...scope, token: "old", offset: 0 })).toEqual(
      new Uint8Array([42]),
    );
    db.exec("DROP TRIGGER block_bind");
    expect(
      await call("acp.plan.save", {
        ...scope,
        definition: { ...body("b"), enabled: true },
        expectedRevision: 1,
        resources: ["new"],
      }),
    ).toMatchObject({ revision: 2 });
    await expect(
      call("acp.resource.chunk", { ...scope, token: "old", offset: 0 }),
    ).rejects.toThrow();
    await call("acp.plan.arm", {
      ...scope,
      expectedRevision: 2,
      expectedStateRevision: 0,
      nextRunAt: 10,
    });
    await call("acp.plan.claim", {
      ...scope,
      expectedRevision: 2,
      expectedStateRevision: 1,
      runId: "r",
      now: 10,
      nextRunAt: null,
    });
    expect(
      await call("acp.plan.save", { ...scope, definition, expectedRevision: 2, resources: [] }),
    ).toBeNull();
    expect(await call("acp.resource.list", { ...scope, expectedRevision: 2 })).toHaveLength(1);
    await call("acp.plan.finish", {
      ...scope,
      runId: "r",
      expectedStatus: "claimed",
      status: "failed",
      taskId: null,
      error: "not sent",
    });
    expect(await call("acp.plan.delete", { ...scope, expectedRevision: 2 })).toBe(true);
    await expect(
      call("acp.resource.chunk", { ...scope, token: "new", offset: 0 }),
    ).rejects.toThrow();
    expect(db.pragma("user_version", { simple: true })).toBe(version);
  } finally {
    db.close();
  }
});

it("拒绝错误偏移、变更重试、超块及坏文本，暂存预算可释放", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const call = (op: string, p: unknown) => store.catalog(op as never, p as never);
  const key = { source: "web", scheduleId: "plan", projectId: "p", token: "text" };
  await call("acp.resource.begin", {
    ...key,
    attachment: { id: "a", kind: "text", mediaType: "text/plain", name: "a.txt", size: 1 },
  });
  await expect(
    call("acp.resource.append", { ...key, offset: 1, content: new Uint8Array([1]) }),
  ).rejects.toThrow();
  await expect(
    call("acp.resource.append", { ...key, offset: 0, content: new Uint8Array(262145) }),
  ).rejects.toThrow();
  await call("acp.resource.append", { ...key, offset: 0, content: new Uint8Array([255]) });
  await expect(
    call("acp.resource.append", { ...key, offset: 0, content: new Uint8Array([1]) }),
  ).rejects.toThrow();
  await expect(call("acp.resource.seal", key)).rejects.toThrow();
  await call("acp.resource.abort", key);
  const big = (token: string) => ({
    ...key,
    token,
    attachment: {
      id: token,
      kind: "file",
      mediaType: "application/octet-stream",
      name: "large",
      size: 52428800,
    },
  });
  await call("acp.resource.begin", big("one"));
  await call("acp.resource.begin", big("two"));
  await expect(call("acp.resource.begin", big("three"))).rejects.toThrow();
  expect(await call("acp.resource.abort", { ...key, token: "one" })).toBe(true);
  await call("acp.resource.begin", big("three"));
  const db = new Database(join(root, "state.sqlite3"));
  try {
    db.exec("UPDATE acp_plan_resources SET created_at=0 WHERE token='two'");
    await call("acp.resource.begin", {
      ...key,
      token: "fresh",
      attachment: { id: "f", kind: "file", mediaType: "x", name: "f", size: 1 },
    });
    await expect(call("acp.resource.seal", { ...key, token: "two" })).rejects.toThrow();
  } finally {
    db.close();
  }
});

it("持久元数据尺寸损坏时拒绝读取，不能按伪造尺寸交付", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const key = { source: "web" as const, scheduleId: "plan", projectId: "p", token: "corrupt" };
  await store.catalog("acp.resource.begin", {
    ...key,
    attachment: { id: "a", kind: "file", mediaType: "x", name: "a", size: 1 },
  });
  await store.catalog("acp.resource.append", { ...key, offset: 0, content: new Uint8Array([42]) });
  await store.catalog("acp.resource.seal", key);
  const db = new Database(join(root, "state.sqlite3"));
  try {
    db.exec("UPDATE acp_plan_resources SET metadata_json=json_set(metadata_json,'$.size',2)");
    await expect(store.catalog("acp.resource.chunk", { ...key, offset: 0 })).rejects.toThrow();
  } finally {
    db.close();
  }
});
