import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import fixture from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import type { AcpScheduledPlanDefinition } from "@codexly/protocol/acp-scheduled-plan";
const definition = fixture as AcpScheduledPlanDefinition;
import { AttachmentStore } from "./attachment-store.js";
import { AcpPlanResourceManager } from "./acp-plan-resource-transfer.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

const stores: AttachmentStore[] = [];

it("恢复保持引用顺序，后续资源摘要错误或取消时回收全部新缓存", async () => {
  for (const failure of ["digest", "cancel"] as const) {
    const root = await createWorkspace();
    const catalog = await openRepository(root);
    const uploadDirectory = join(root, "uploads");
    const uploads = new AttachmentStore({ attachmentDirectory: uploadDirectory });
    stores.push(uploads);
    const manager = new AcpPlanResourceManager(catalog, uploads);
    const scope = { source: "web" as const, scheduleId: "plan", projectId: "p" };
    const resources = [];
    for (const name of ["first.bin", "second.bin"]) {
      const uploaded = await uploads.add("p", {
        kind: "file",
        mediaType: "application/octet-stream",
        name,
        content: Readable.from([name]),
      });
      resources.push(await manager.stage(scope, uploaded.attachment.id));
      await uploads.discard(uploaded.attachment.id);
    }
    resources.reverse();
    const plan = await catalog.catalog("acp.plan.save", {
      ...scope,
      expectedRevision: 0,
      definition: {
        ...definition,
        prompt: {
          ...definition.prompt,
          attachments: resources.map((r) => ({ id: r.attachment.id })),
        },
      },
      resources: resources.map((r) => r.token),
    });
    if (!plan) throw new Error("Missing saved plan");
    const restored = await manager.restore(plan);
    const ordered = await Promise.all(restored.restoredIds.map((id) => uploads.read("p", id)));
    expect(ordered.map((r) => r.attachment.name)).toEqual(["second.bin", "first.bin"]);
    await manager.discard(restored.restoredIds);
    await expect(
      manager.restore({ ...plan, definition: { ...plan.definition, projectId: "other" } }),
    ).rejects.toThrow();
    const controller = new AbortController();
    const db = new Database(join(root, "state.sqlite3"));
    try {
      if (failure === "digest") {
        db.prepare("UPDATE acp_plan_resources SET digest=? WHERE token=?").run(
          "0".repeat(64),
          resources[1]?.token,
        );
      } else {
        const add = uploads.add.bind(uploads);
        vi.spyOn(uploads, "add").mockImplementation(async (project, input) => {
          const result = await add(project, input);
          controller.abort();
          return result;
        });
      }
      await expect(manager.restore(plan, controller.signal)).rejects.toThrow(
        failure === "digest" ? /digest/iu : /abort/iu,
      );
      expect(await readdir(uploadDirectory)).toEqual([]);
      expect(
        await catalog.catalog("acp.resource.list", { ...scope, expectedRevision: 1 }),
      ).toHaveLength(2);
      expect(await catalog.catalog("acp.plan.read", scope)).toEqual(plan);
    } finally {
      db.close();
    }
  }
});

it("永久资源重启后恢复为每轮新上传，原定义与字节保持", async () => {
  const root = await createWorkspace();
  let catalog = await openRepository(root);
  const uploads = new AttachmentStore();
  stores.push(uploads);
  const bytes = Buffer.from([0, 255, 128, 42]);
  const uploaded = await uploads.add("p", {
    kind: "file",
    mediaType: "application/octet-stream",
    name: "proof.bin",
    content: Readable.from([bytes]),
  });
  const scope = { source: "web" as const, scheduleId: "plan", projectId: "p" };
  const resource = await new AcpPlanResourceManager(catalog, uploads).stage(
    scope,
    uploaded.attachment.id,
  );
  const plan = await catalog.catalog("acp.plan.save", {
    ...scope,
    expectedRevision: 0,
    definition: {
      ...definition,
      prompt: { ...definition.prompt, attachments: [{ id: resource.attachment.id }] },
    },
    resources: [resource.token],
  });
  if (!plan) throw new Error("Missing saved plan");
  await uploads.discard(uploaded.attachment.id);
  await catalog.close();
  catalog = await openRepository(root);
  const manager = new AcpPlanResourceManager(catalog, uploads);
  const before = structuredClone(plan);
  const first = await manager.restore(plan);
  const second = await manager.restore(plan);
  expect(first.restoredIds).toHaveLength(1);
  expect(first.restoredIds).not.toEqual(second.restoredIds);
  expect(first.prompt.attachments).toEqual(first.restoredIds.map((id) => ({ id })));
  expect((await uploads.read("p", first.restoredIds[0] ?? "")).content).toEqual(bytes);
  expect(plan).toEqual(before);
  await expect(manager.restore({ ...plan, revision: 2 })).rejects.toThrow();
});
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.dispose()));
});

it("按项目将授权上传分块封存为独立引用，不消费原上传", async () => {
  const catalog = await openRepository(await createWorkspace());
  const uploads = new AttachmentStore();
  stores.push(uploads);
  const bytes = Buffer.alloc(300000, 255);
  bytes[0] = 0;
  const uploaded = await uploads.add("p", {
    kind: "file",
    mediaType: "application/octet-stream",
    name: "a.bin",
    content: Readable.from([bytes]),
  });
  const manager = new AcpPlanResourceManager(catalog, uploads);
  vi.spyOn(uploads, "read").mockRejectedValue(
    new Error("must stream instead of reading whole file"),
  );
  const scope = { source: "web" as const, scheduleId: "plan", projectId: "p" };
  const resource = await manager.stage(scope, uploaded.attachment.id);
  expect(resource.attachment.id).not.toBe(uploaded.attachment.id);
  expect(resource).toMatchObject({
    written: bytes.length,
    digest: createHash("sha256").update(bytes).digest("hex"),
    boundRevision: null,
  });
  const first = await catalog.catalog("acp.resource.chunk", {
    ...scope,
    token: resource.token,
    offset: 0,
  });
  expect(first).toHaveLength(262144);
  if (!first) throw new Error("Missing first resource chunk");
  const last = await catalog.catalog("acp.resource.chunk", {
    ...scope,
    token: resource.token,
    offset: first.length,
  });
  if (!last) throw new Error("Missing last resource chunk");
  expect(Buffer.concat([first, last])).toEqual(bytes);
  const original = await uploads.stream("p", uploaded.attachment.id);
  const saved: Buffer[] = [];
  for await (const chunk of original.content) saved.push(chunk as Buffer);
  expect(Buffer.concat(saved)).toEqual(bytes);
  await expect(
    manager.stage({ ...scope, projectId: "other" }, uploaded.attachment.id),
  ).rejects.toThrow();
});

it("第二块持久化失败时回收已写块，并保留原上传", async () => {
  const root = await createWorkspace();
  const catalog = await openRepository(root);
  const uploads = new AttachmentStore();
  stores.push(uploads);
  const uploaded = await uploads.add("p", {
    kind: "file",
    mediaType: "application/octet-stream",
    name: "a.bin",
    content: Readable.from([Buffer.alloc(300000, 42)]),
  });
  const db = new Database(join(root, "state.sqlite3"));
  try {
    db.exec(
      "CREATE TRIGGER fail_second_chunk BEFORE INSERT ON acp_plan_resource_chunks WHEN NEW.offset>0 BEGIN SELECT RAISE(ABORT,'disk failure'); END;",
    );
    await expect(
      new AcpPlanResourceManager(catalog, uploads).stage(
        { source: "web", scheduleId: "plan", projectId: "p" },
        uploaded.attachment.id,
      ),
    ).rejects.toThrow("disk failure");
    expect(db.prepare("SELECT token FROM acp_plan_resources").all()).toEqual([]);
    expect(db.prepare("SELECT token FROM acp_plan_resource_chunks").all()).toEqual([]);
    expect((await uploads.read("p", uploaded.attachment.id)).content).toHaveLength(300000);
  } finally {
    db.close();
  }
});

it("取消或源流错误会清理暂存，不消费上传", async () => {
  for (const failure of ["cancel", "stream"] as const) {
    const root = await createWorkspace();
    const catalog = await openRepository(root);
    const uploads = new AttachmentStore();
    stores.push(uploads);
    const uploaded = await uploads.add("p", {
      kind: "file",
      mediaType: "application/octet-stream",
      name: "file",
      content: Readable.from([Buffer.alloc(300000, 42)]),
    });
    const controller = new AbortController();
    const openStream = uploads.stream.bind(uploads);
    vi.spyOn(uploads, "stream").mockImplementation(async (project, id) => {
      const source = await openStream(project, id);
      return {
        ...source,
        content: Readable.from(
          (async function* () {
            try {
              for await (const chunk of source.content) {
                yield chunk;
                if (failure === "cancel") controller.abort();
                else throw new Error("source read failed");
              }
            } finally {
              source.content.destroy();
            }
          })(),
        ),
      };
    });
    await expect(
      new AcpPlanResourceManager(catalog, uploads).stage(
        { source: "web", scheduleId: "plan", projectId: "p" },
        uploaded.attachment.id,
        controller.signal,
      ),
    ).rejects.toThrow(failure === "cancel" ? /abort/iu : "source read failed");
    const db = new Database(join(root, "state.sqlite3"));
    try {
      expect(db.prepare("SELECT token FROM acp_plan_resources").all()).toEqual([]);
      expect(db.prepare("SELECT token FROM acp_plan_resource_chunks").all()).toEqual([]);
    } finally {
      db.close();
    }
    expect((await uploads.read("p", uploaded.attachment.id)).content).toHaveLength(300000);
  }
});

it("过期、已消费、外部路径和错误来源在暂存前拒绝", async () => {
  const root = await createWorkspace();
  const catalog = await openRepository(root);
  let now = 100;
  const uploads = new AttachmentStore({ clock: () => now, ttlMs: 100 });
  stores.push(uploads);
  const add = () =>
    uploads.add("p", {
      kind: "text",
      mediaType: "text/plain",
      name: "a.txt",
      content: Readable.from(["proof"]),
    });
  const manager = new AcpPlanResourceManager(catalog, uploads);
  const scope = { source: "web" as const, scheduleId: "plan", projectId: "p" };
  const consumed = await add();
  await uploads.consume("p", [consumed.attachment.id], "turn");
  await expect(manager.stage(scope, consumed.attachment.id)).rejects.toThrow();
  const expired = await add();
  now = 201;
  await expect(manager.stage(scope, expired.attachment.id)).rejects.toThrow();
  await expect(manager.stage(scope, "/etc/passwd")).rejects.toThrow();
  await expect(manager.stage({ ...scope, source: "desktop" }, "anything")).rejects.toThrow();
  const db = new Database(join(root, "state.sqlite3"));
  try {
    expect(db.prepare("SELECT token FROM acp_plan_resources").all()).toEqual([]);
  } finally {
    db.close();
  }
});
