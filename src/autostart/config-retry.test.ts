import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { writePrivateJson } from "./config.js";

const clock = vi.hoisted(() => ({ elapsed: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
vi.mock("node:timers/promises", () => ({
  // 用逻辑时钟模拟共享锁持续时间，避免测试依赖 CI 机器的调度速度。
  setTimeout: vi.fn((milliseconds: number) => {
    clock.elapsed += milliseconds;
    return Promise.resolve();
  }),
}));

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clock.elapsed = 0;
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function lockedState(platform: string, code: string, duration: number) {
  const { rename } = await vi.importActual<typeof fs>("node:fs/promises");
  vi.mocked(fs.rename).mockImplementation(rename);
  const root = await fs.mkdtemp(join(tmpdir(), "codexly-state-retry-"));
  roots.push(root);
  const path = join(root, "runtime.json");
  await writePrivateJson(path, { phase: "ready" });
  vi.stubGlobal("process", { ...process, platform });
  const failure = Object.assign(new Error("模拟文件替换失败"), { code });
  vi.mocked(fs.rename).mockImplementation(async (source, destination) => {
    if (clock.elapsed < duration) throw failure;
    await rename(source, destination);
  });
  return { root, path, failure };
}

it.each(["EPERM", "EACCES", "EBUSY"])(
  "recovers from a one-second Windows sharing lock (%s)",
  async (code) => {
    const { path, root } = await lockedState("win32", code, 1_000);
    await expect(writePrivateJson(path, { phase: "stopped" })).resolves.toBeUndefined();
    expect(JSON.parse(await fs.readFile(path, "utf8"))).toEqual({ phase: "stopped" });
    expect(await fs.readdir(root)).toEqual(["runtime.json"]);
  },
);

it("bounds persistent Windows lock retries and preserves the complete previous state", async () => {
  const { path, root, failure } = await lockedState("win32", "EPERM", Infinity);
  await expect(writePrivateJson(path, { phase: "stopped" })).rejects.toBe(failure);
  expect(clock.elapsed).toBeGreaterThanOrEqual(1_000);
  expect(clock.elapsed).toBeLessThan(4_000);
  expect(JSON.parse(await fs.readFile(path, "utf8"))).toEqual({ phase: "ready" });
  expect(await fs.readdir(root)).toEqual(["runtime.json"]);
});

it.each([
  ["linux", "EPERM"],
  ["darwin", "EBUSY"],
  ["win32", "ENOENT"],
])("does not retry unrelated replacement failures (%s, %s)", async (platform, code) => {
  const { path, root, failure } = await lockedState(platform, code, Infinity);
  await expect(writePrivateJson(path, { phase: "stopped" })).rejects.toBe(failure);
  expect(clock.elapsed).toBe(0);
  expect(JSON.parse(await fs.readFile(path, "utf8"))).toEqual({ phase: "ready" });
  expect(await fs.readdir(root)).toEqual(["runtime.json"]);
});
