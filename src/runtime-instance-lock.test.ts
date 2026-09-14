import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { acquireRuntimeLock } from "./runtime-instance-lock.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function home() {
  const directory = await mkdtemp(join(tmpdir(), "codexly-instance-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

describe("runtime instance lock", () => {
  it("rejects concurrent owners including directory aliases, then releases ownership", async () => {
    const directory = await home();
    const alias = join(await home(), "alias");
    await symlink(directory, alias, "junction");
    const first = await acquireRuntimeLock(directory);
    cleanup.push(() => first.close());
    await expect(acquireRuntimeLock(alias)).rejects.toThrow("已有 Codexly 实例");
    await first.close();
    const next = await acquireRuntimeLock(alias);
    cleanup.push(() => next.close());
    expect(next.signal.aborted).toBe(false);
  });

  it("releases the OS lock after its owner is terminated without cleanup", async () => {
    const directory = await home();
    await mkdir(join(directory, "codexly"));
    const worker = new Worker(new URL("./runtime-instance-worker.js", import.meta.url), {
      workerData: { path: join(directory, "codexly", "instance.sqlite3") },
    });
    cleanup.push(() => worker.terminate());
    await new Promise<void>((resolve, reject) => {
      worker.once("message", (message: { type: string }) => {
        if (message.type === "ready") resolve();
        else reject(new Error("Lock failed"));
      });
      worker.once("error", reject);
    });
    await expect(acquireRuntimeLock(directory)).rejects.toThrow("已有 Codexly 实例");
    await worker.terminate();
    const next = await acquireRuntimeLock(directory);
    cleanup.push(() => next.close());
    expect(next.signal.aborted).toBe(false);
  });
});
