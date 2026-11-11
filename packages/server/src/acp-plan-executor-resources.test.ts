import { afterEach, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { AgentTurnNotSubmittedError } from "@codexly/core";
import type { AcpScheduledPlanDefinition } from "@codexly/protocol/acp-scheduled-plan";
import definition from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import { fixture } from "./acp-plan-executor.test-support.js";
import { project } from "./app-all.test-support.js";
import { AttachmentStore } from "./attachment-store.js";
import { AcpPlanResourceManager } from "./acp-plan-resource-transfer.js";
import { acpPlanSubmissionKey, createAcpPlanExecutor } from "./acp-plan-executor.js";
import { fingerprintPayload } from "./server-runtime.js";

const uploadsToDispose: AttachmentStore[] = [];
afterEach(async () => {
  await Promise.all(uploadsToDispose.splice(0).map((u) => u.dispose()));
});
async function attached() {
  const s = await fixture();
  const uploads = new AttachmentStore({ attachmentDirectory: join(s.root, "uploads") });
  uploadsToDispose.push(uploads);
  await s.store.catalog("acp.plan.finish", {
    ...s.key,
    runId: "run",
    expectedStatus: "claimed",
    status: "failed",
    taskId: null,
    error: "attachment proof",
  });
  const manager = new AcpPlanResourceManager(s.store, uploads);
  const uploaded = await uploads.add(project.id, {
    kind: "file",
    mediaType: "application/octet-stream",
    name: "proof.bin",
    content: Readable.from([Buffer.from([0, 255, 42])]),
  });
  const resource = await manager.stage({ ...s.key, projectId: project.id }, uploaded.attachment.id);
  const body = {
    ...(definition as AcpScheduledPlanDefinition),
    projectId: project.id,
    enabled: true,
    prompt: {
      type: "prompt" as const,
      text: "",
      attachments: [{ id: resource.attachment.id }],
      skills: [],
    },
  };
  await s.store.catalog("acp.plan.save", {
    ...s.key,
    expectedRevision: 1,
    definition: body,
    resources: [resource.token],
  });
  await s.store.catalog("acp.plan.arm", {
    ...s.key,
    expectedRevision: 2,
    expectedStateRevision: 2,
    nextRunAt: 20,
  });
  await s.store.catalog("acp.plan.claim", {
    ...s.key,
    expectedRevision: 2,
    expectedStateRevision: 3,
    runId: "file-run",
    now: 20,
    nextRunAt: null,
  });
  const resolveInput = async (
    _project: string,
    input: { text: string; attachments: { id: string }[] },
  ) => {
    const items = await uploads.resolve(
      project.id,
      input.attachments.map((a) => a.id),
    );
    return {
      attachmentIds: input.attachments.map((a) => a.id),
      providerInput: {
        text: input.text,
        skills: [],
        images: [],
        textAttachments: [],
        files: items.map((a) => {
          if (a.kind !== "file") throw Error("Expected file");
          return { path: a.path, name: a.name, mediaType: a.mediaType };
        }),
      },
    };
  };
  const execute = createAcpPlanExecutor({
    catalog: s.store,
    submissions: s.store,
    getProjectContext: s.getProjectContext,
    resolveInput,
    resources: manager,
  });
  const run = () => execute("plan", "file-run");
  const key = { ...s.key, runId: "file-run" };
  return { ...s, uploads, manager, run, key, body, resource };
}

it("附件计划使用原始身份发送一次，已确认结果回收本轮副本", async () => {
  const s = await attached();
  const original = s.configured.getMockImplementation();
  if (!original) throw Error("Missing configured fixture");
  s.configured.mockImplementation(async (...args) => {
    expect(await readFile(args[1].files[0]?.path ?? "")).toEqual(Buffer.from([0, 255, 42]));
    return original(...args);
  });
  expect(await s.run()).toMatchObject({ status: "started" });
  await expect(readFile(s.configured.mock.calls[0]?.[1].files[0]?.path ?? "")).rejects.toThrow();
  s.getProjectContext.mockRejectedValue(Error("offline"));
  expect(await s.run()).toMatchObject({ status: "started" });
  expect(s.configured).toHaveBeenCalledOnce();
  expect(
    (await s.store.readSubmission(project.id, acpPlanSubmissionKey("plan", "file-run")))
      ?.fingerprint,
  ).toBe(
    fingerprintPayload({
      type: "acp-prompt",
      engine: s.body.engine,
      initialConfig: s.body.values,
      input: s.body.prompt,
    }),
  );
});

it.each(["started", "failed"] as const)(
  "%s 已确认但缓存清理失败，恢复只重试清理",
  async (status) => {
    const s = await attached();
    if (status === "failed")
      s.configured.mockRejectedValue(new AgentTurnNotSubmittedError("not sent"));
    vi.spyOn(s.manager, "releaseOwner").mockRejectedValueOnce(Error("cleanup denied"));
    expect(await s.run()).toMatchObject({ status: "unknown" });
    expect(await s.store.catalog("acp.plan.completion.read", s.key)).toMatchObject({ status });
    s.getProjectContext.mockRejectedValue(Error("must not resolve project"));
    vi.spyOn(s.manager, "restore").mockRejectedValue(Error("must not restore again"));
    vi.spyOn(s.store, "readSubmission").mockRejectedValue(Error("must not inspect ledger again"));
    expect(await s.run()).toMatchObject({ status });
    expect(s.configured).toHaveBeenCalledOnce();
    expect(await s.store.catalog("acp.plan.completion.read", s.key)).toBeNull();
    await expect(readFile(s.configured.mock.calls[0]?.[1].files[0]?.path ?? "")).rejects.toThrow();
  },
);

it("RPC 未知保留副本与占用，恢复不重发也不回收缓存", async () => {
  const s = await attached();
  s.configured.mockRejectedValue(Error("disconnected"));
  expect(await s.run()).toMatchObject({ status: "unknown" });
  const path = s.configured.mock.calls[0]?.[1].files[0]?.path ?? "";
  expect(await readFile(path)).toEqual(Buffer.from([0, 255, 42]));
  s.getProjectContext.mockRejectedValue(Error("offline"));
  const release = vi.spyOn(s.manager, "releaseOwner");
  expect(await s.run()).toMatchObject({ status: "unknown" });
  expect(release).not.toHaveBeenCalled();
  expect(s.configured).toHaveBeenCalledOnce();
  expect(await readFile(path)).toEqual(Buffer.from([0, 255, 42]));
  expect(await s.store.catalog("acp.plan.completion.read", s.key)).toBeNull();
});

it("资源损坏在创建任务前失败，永久资源和原上传不被清理", async () => {
  const s = await attached();
  const create = vi.spyOn(s.h.provider, "startTask");
  const db = new Database(join(s.root, "state.sqlite3"));
  try {
    db.prepare("UPDATE acp_plan_resources SET digest=? WHERE token=?").run(
      "0".repeat(64),
      s.resource.token,
    );
    expect(await s.run()).toMatchObject({ status: "failed", taskId: null });
    expect(create).not.toHaveBeenCalled();
    expect(s.configured).not.toHaveBeenCalled();
    expect(
      await s.store.catalog("acp.resource.list", {
        ...s.key,
        projectId: project.id,
        expectedRevision: 2,
      }),
    ).toHaveLength(1);
  } finally {
    db.close();
  }
});

it("RPC 已确认但提交结果持续写入失败时，仍以完成意图结束且不重发", async () => {
  const s = await attached();
  const db = new Database(join(s.root, "state.sqlite3"));
  try {
    db.exec(
      "CREATE TRIGGER fail_result BEFORE UPDATE ON task_submissions WHEN json_extract(NEW.record_json,'$.stage') IN ('started','completed') BEGIN SELECT RAISE(ABORT,'result write failed'); END;",
    );
    expect(await s.run()).toMatchObject({ status: "started" });
    expect(await s.run()).toMatchObject({ status: "started" });
    expect(s.configured).toHaveBeenCalledOnce();
    await expect(readFile(s.configured.mock.calls[0]?.[1].files[0]?.path ?? "")).rejects.toThrow();
  } finally {
    db.close();
  }
});
