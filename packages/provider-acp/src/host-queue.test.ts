import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Value } from "@sinclair/typebox/value";
import type { AgentProvider } from "@codexly/core";
import {
  AddAgentQueuedSubmissionResponseSchema,
  UpdateAgentQueuedSubmissionResponseSchema,
  ReorderAgentQueuedSubmissionsResponseSchema,
  StartAgentQueuedSubmissionResponseSchema,
  DeleteAgentQueuedSubmissionResponseSchema,
} from "@codexly/protocol";
import { AcpQueue } from "./queue.js";
import { dispatchAcpHost } from "./host-dispatch.js";
import type { AcpRuntime } from "./runtime.js";

it("宿主队列完整往返符合两端共享响应契约，非法排序不修改记录", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-host-queue-"));
  try {
    let running = true;
    const execute = vi.fn(() =>
      Promise.resolve({
        id: "turn",
        status: "running" as const,
        items: [],
        error: null,
        startedAt: null,
        completedAt: null,
      }),
    );
    const provider = {
      readTaskMetadata: () => Promise.resolve({ id: "t", engine: "codex" }),
      readTask: () =>
        Promise.resolve({ turns: running ? [{ id: "active", status: "running" }] : [] }),
    } as unknown as AgentProvider;
    const queue = new AcpQueue(directory, execute, () => undefined);
    const runtime = { directory, forScope: () => provider } as unknown as AcpRuntime;
    const scope = {
      id: "p",
      kind: "project",
      rootPath: directory,
      runtimeWorkspaceRoots: [directory],
    };
    const send = (method: string, params: object = {}) =>
      dispatchAcpHost(
        runtime,
        { scope, method, params: { taskId: "t", ...params } },
        () => undefined,
        new AbortController().signal,
        () => undefined,
        queue,
      );
    const input = { text: "next", skills: [], images: [], files: [], textAttachments: [] };
    const added = await send("queue.add", { input, clientUserMessageId: "message" });
    expect(Value.Check(AddAgentQueuedSubmissionResponseSchema, added)).toBe(true);
    const id = (await queue.list(provider, "p", "t"))[0]?.id;
    const updated = await send("queue.update", {
      queuedSubmissionId: id,
      input: { ...input, text: "edited" },
      status: "editing",
    });
    expect(Value.Check(UpdateAgentQueuedSubmissionResponseSchema, updated)).toBe(true);
    const reordered = await send("queue.reorder", { queuedSubmissionIds: [id] });
    expect(Value.Check(ReorderAgentQueuedSubmissionsResponseSchema, reordered)).toBe(true);
    await expect(send("queue.reorder", { queuedSubmissionIds: [id, id] })).rejects.toThrow();
    expect((await queue.list(provider, "p", "t"))[0]?.text).toBe("edited");
    await send("queue.update", { queuedSubmissionId: id, input, status: "queued" });
    running = false;
    const started = await send("queue.start", { queuedSubmissionId: id });
    expect(Value.Check(StartAgentQueuedSubmissionResponseSchema, started)).toBe(true);
    const deleted = await send("queue.delete", { queuedSubmissionId: id });
    expect(Value.Check(DeleteAgentQueuedSubmissionResponseSchema, deleted)).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
