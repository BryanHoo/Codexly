import { Writable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { AgentProvider, AgentProviderEventListener } from "@codexly/core";
import { AcpHost } from "./host.js";

it("宿主按订阅身份幂等保留，多持有者释放及忙回合终态释放", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-leases-"));
  const frames: Record<string, unknown>[] = [];
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      frames.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  const host = new AcpHost(root, output);
  let listener: AgentProviderEventListener | undefined;
  const unsubscribeTask = vi.fn().mockResolvedValue("unsubscribed");
  const provider = {
    subscribeEvents: (next: AgentProviderEventListener) => {
      listener = next;
      return () => undefined;
    },
    readTaskMetadata: vi.fn(() => Promise.resolve({ id: "t" })),
    unsubscribeTask,
  } as unknown as AgentProvider;
  vi.spyOn(host.runtime, "forScope").mockReturnValue(provider);
  vi.spyOn(host.queue, "resume").mockResolvedValue(undefined);
  const scope = { id: "p", kind: "project", rootPath: root, runtimeWorkspaceRoots: [root] };
  let id = 0;
  async function request(method: string, leaseId: string) {
    const current = ++id;
    host.receive(
      Buffer.from(
        `${JSON.stringify({ id: current, scope, method, params: { taskId: "t", leaseId } })}\n`,
      ),
    );
    return vi.waitFor(() => {
      const result = frames.find((frame) => frame["id"] === current);
      if (!result) throw new Error("等待宿主");
      return result;
    });
  }
  try {
    expect(await request("task.retain", "one")).not.toHaveProperty("error");
    expect(await request("task.retain", "one")).not.toHaveProperty("error");
    expect(await request("task.retain", "two")).not.toHaveProperty("error");
    await request("task.release", "one");
    expect(unsubscribeTask).not.toHaveBeenCalled();
    await request("task.release", "two");
    expect(unsubscribeTask).toHaveBeenCalledExactlyOnceWith("t");
    await request("task.release", "two");
    expect(unsubscribeTask).toHaveBeenCalledOnce();
    await request("task.retain", "busy");
    unsubscribeTask.mockResolvedValueOnce("busy");
    await request("task.release", "busy");
    expect(unsubscribeTask).toHaveBeenCalledTimes(2);
    listener?.({
      type: "turn.completed",
      taskId: "t",
      turnId: "turn",
      payload: {
        turn: {
          id: "turn",
          status: "completed",
          items: [],
          startedAt: null,
          completedAt: null,
          error: null,
        },
      },
    });
    await vi.waitFor(() => {
      expect(unsubscribeTask).toHaveBeenCalledTimes(3);
    });
  } finally {
    await host.close();
    output.destroy();
    await rm(root, { recursive: true, force: true });
  }
});
