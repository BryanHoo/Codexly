import { withStorageCatalog, storageCatalog } from "./storage-catalog.test-support.js";
import { expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AcpSettingsStore } from "./settings-store.js";
it("首次读取并发合并旧来源，原始 false 与未知值私有保存，新选择及重启不被覆盖", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-legacy-store-"));
  const legacy = {
    model: "old",
    permissionMode: "future",
    flag: false,
    unknown: { nested: true },
  };
  const source = vi.fn(() => Promise.resolve({ settings: legacy, policy: "migrate" as const }));
  try {
    const store = new AcpSettingsStore(root, source);
    const [a, b] = await Promise.all([store.read("codex"), store.read("codex")]);
    expect(a.legacy).toEqual(legacy);
    expect(b).toEqual(a);
    expect(source).toHaveBeenCalledTimes(1);
    await store.update("codex", (current) => ({
      ...current,
      configured: true,
      values: { model: "new", flag: false },
    }));
    const reopened = new AcpSettingsStore(
      root,
      vi.fn(() => Promise.reject(Error("must not read old source"))),
    );
    expect(await reopened.read("codex")).toMatchObject({
      configured: true,
      values: { model: "new", flag: false },
      legacy: { model: "old" },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("来源失败不保存空快照，后续读取可以重试且没有源配置写入", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-legacy-retry-"));
  const source = vi
    .fn()
    .mockRejectedValueOnce(Error("source unreadable"))
    .mockResolvedValue({ settings: { flag: false }, policy: "migrate" as const });
  try {
    const store = new AcpSettingsStore(root, source);
    await expect(store.read("claude")).rejects.toThrow("source unreadable");
    await expect(readFile(join(root, "claude.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await store.read("claude")).legacy).toEqual({ flag: false });
    expect(source).toHaveBeenCalledTimes(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("Web 运行时和桌面宿主共用旧来源注入，不启动 agent 或读取任务目录", async () => {
  const { AcpRuntime } = await import("./runtime.js");
  const { AcpApplicationRuntime } = await import("./application-runtime.js");
  const { AcpHost } = await import("./host.js");
  const { Writable } = await import("node:stream");
  const root = await mkdtemp(join(tmpdir(), "acp-legacy-runtime-"));
  const source = vi.fn(() =>
    Promise.resolve({ settings: { flag: false }, policy: "migrate" as const }),
  );
  const launch = vi.fn(() => Promise.reject(Error("no agent")));
  const catalog = vi.fn(() => Promise.reject(Error("no catalog")));
  const storage = storageCatalog();
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const frame = JSON.parse(chunk.toString()) as Record<string, unknown>;
      if (typeof frame["catalogId"] === "number") {
        const result = storage(frame["operation"], frame["payload"]);
        queueMicrotask(() => {
          host.receive(
            Buffer.from(`${JSON.stringify({ catalogId: frame["catalogId"], result })}\n`),
          );
        });
      }
      callback();
    },
  });
  const runtime = new AcpRuntime(
    join(root, "runtime"),
    withStorageCatalog({ catalog }),
    launch,
    source,
  );
  const application = new AcpApplicationRuntime(
    join(root, "application"),
    withStorageCatalog({ catalog }),
    () => Promise.resolve(undefined),
    launch,
    source,
  );
  const host = new AcpHost(join(root, "host"), output, launch, source);
  try {
    for (const current of [runtime, application, host.runtime])
      expect((await current.settings.read("codex")).legacy).toEqual({ flag: false });
    expect(source).toHaveBeenCalledTimes(3);
    expect(launch).not.toHaveBeenCalled();
    expect(catalog).not.toHaveBeenCalled();
  } finally {
    await Promise.all([runtime.close(), application.close(), host.close()]);
    output.destroy();
    await rm(root, { recursive: true, force: true });
  }
});

it("已经明确保存的 ACP 设置不依赖旧来源仍可读取，不因旧文件损坏而报错", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-legacy-configured-"));
  try {
    await new AcpSettingsStore(root).update("codex", (current) => ({
      ...current,
      configured: true,
      values: { model: "new", flag: false },
    }));
    const source = vi.fn(() => Promise.reject(Error("old file invalid")));
    await expect(new AcpSettingsStore(root, source).read("codex")).resolves.toMatchObject({
      configured: true,
      values: { model: "new", flag: false },
    });
    expect(source).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("旧来源失败先于 agent 启动且不记录空快照", async () => {
  const { AcpAgentService } = await import("./agent-service.js");
  const root = await mkdtemp(join(tmpdir(), "acp-legacy-before-agent-"));
  const source = vi.fn(() => Promise.reject(Error("source unreadable")));
  const launch = vi.fn(() => Promise.reject(Error("agent started")));
  const service = new AcpAgentService("codex", root, new AcpSettingsStore(root, source), launch);
  try {
    await expect(service.inspect()).rejects.toThrow("source unreadable");
    expect(launch).not.toHaveBeenCalled();
    await expect(readFile(join(root, "codex.json"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("来源读取期间另一宿主保存的新选择优先，旧快照导入不覆盖它", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-legacy-concurrent-"));
  let release!: (value: { settings: Record<string, unknown>; policy: "preserve" }) => void;
  const source = vi.fn(
    () =>
      new Promise<{ settings: Record<string, unknown>; policy: "preserve" }>((resolve) => {
        release = resolve;
      }),
  );
  const store = new AcpSettingsStore(root, source);
  try {
    const pending = store.read("codex");
    await vi.waitFor(() => {
      expect(source).toHaveBeenCalledOnce();
    });
    await new AcpSettingsStore(root).update("codex", (current) => ({
      ...current,
      configured: true,
      values: { model: "new", flag: false },
    }));
    release({ settings: { model: "old" }, policy: "preserve" });
    expect(await pending).toMatchObject({
      configured: true,
      values: { model: "new", flag: false },
      legacy: { model: "old" },
      legacyPolicy: "preserve",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
