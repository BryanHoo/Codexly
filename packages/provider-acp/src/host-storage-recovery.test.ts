import { Writable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AcpHost } from "./host.js";

it("原生领取回执超时后关闭宿主，禁止活 PID 遗留锁继续接收写入", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-storage-timeout-"));
  const requested = Promise.withResolvers<undefined>();
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      const frame = JSON.parse(chunk.toString()) as Record<string, unknown>;
      if (frame["operation"] === "acp.storage.read")
        queueMicrotask(() => {
          host.receive(
            Buffer.from(`${JSON.stringify({ catalogId: frame["catalogId"], result: null })}\n`),
          );
        });
      if (frame["operation"] === "acp.storage.claim") requested.resolve(undefined);
      done();
    },
  });
  const host = new AcpHost(root, output);
  const update = host.runtime.settings.update("codex", (current) => current);
  const rejected = expect(update).rejects.toThrow();
  try {
    await requested.promise;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // 领取计时器已注册，直接模拟其回执失败；实际超时行为由同一目录通道处理。
    host.receive(Buffer.from('{"catalogId":2,"error":"native unavailable"}\n'));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_001);
    expect(host.closed).toBe(true);
  } finally {
    vi.useRealTimers();
    await host.close();
    await rejected;
    output.destroy();
    await rm(root, { recursive: true, force: true });
  }
});
