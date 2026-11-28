import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AcpSettingsSnapshots } from "./settings-snapshot.js";

const snapshot = {
  profile: {
    engine: "codex",
    protocolVersion: 1,
    agentInfo: { name: "codex", version: "1" },
    authMethods: [],
  },
} as const;

it("合并同时刷新的请求，重启后读取快照，失败时保留快照，身份变化时丢弃", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-settings-snapshot-"));
  let identity = "before";
  const binding = () => Promise.resolve(identity);
  const probe = vi.fn(() =>
    Promise.resolve({ ...snapshot, profile: { ...snapshot.profile, authMethods: [] } }),
  );
  try {
    const cache = new AcpSettingsSnapshots(directory, binding, probe);
    expect(await cache.read("codex")).toBeNull();
    await Promise.all([cache.refresh("codex"), cache.refresh("codex")]);
    expect(probe).toHaveBeenCalledTimes(1);
    const reopened = new AcpSettingsSnapshots(directory, binding, probe);
    expect(await reopened.read("codex")).toEqual(snapshot);
    probe.mockRejectedValueOnce(new Error("network error"));
    await expect(reopened.refresh("codex")).rejects.toThrow("network error");
    expect(await reopened.read("codex")).toEqual(snapshot);
    identity = "after";
    expect(await reopened.read("codex")).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("切走的客户端不取消其他观察者，身份失效后拒绝迟到的结果", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-settings-snapshot-"));
  const first = Promise.withResolvers<typeof snapshot>();
  const started = Promise.withResolvers<undefined>();
  const probe = vi.fn(async () => {
    started.resolve(undefined);
    const result = await first.promise;
    return { profile: { ...result.profile, authMethods: [] } };
  });
  try {
    const cache = new AcpSettingsSnapshots(directory, () => Promise.resolve("same"), probe);
    const controller = new AbortController();
    const firstReader = cache.refresh("codex", controller.signal);
    const secondReader = cache.refresh("codex");
    await started.promise;
    const stopped = expect(firstReader).rejects.toThrow();
    controller.abort();
    await stopped;
    const invalidated = expect(secondReader).rejects.toThrow();
    await cache.invalidate("codex");
    first.resolve(snapshot);
    await invalidated;
    expect(probe).toHaveBeenCalledTimes(1);
    expect(await cache.read("codex")).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
