import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGlobalInstructionsStore } from "./global-instructions.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
describe("global instructions", () => {
  it("保留原文并拒绝过期编辑，不覆盖外部修改", async () => {
    const home = await mkdtemp(join(tmpdir(), "codexly-instructions-"));
    directories.push(home);
    const store = createGlobalInstructionsStore(home);
    expect((await store.read()).content).toBe("");
    const content = "# 全局说明\r\n  保留空格\n";
    await store.save({ content, expectedContent: "" });
    expect(await readFile(join(home, "AGENTS.md"), "utf8")).toBe(content);
    await writeFile(join(home, "AGENTS.md"), "external");
    await expect(store.save({ content: "stale", expectedContent: content })).rejects.toMatchObject({
      code: "GLOBAL_INSTRUCTIONS_CHANGED",
    });
    expect((await store.read()).content).toBe("external");
  });
  it("保留符号链接并串行校验并发保存", async () => {
    const home = await mkdtemp(join(tmpdir(), "codexly-instructions-"));
    directories.push(home);
    await writeFile(join(home, "shared.md"), "");
    await symlink(join(home, "shared.md"), join(home, "AGENTS.md"));
    await writeFile(join(home, "AGENTS.override.md"), "override");
    const store = createGlobalInstructionsStore(home);
    const results = await Promise.allSettled([
      store.save({ content: "first", expectedContent: "" }),
      store.save({ content: "second", expectedContent: "" }),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(await readFile(join(home, "shared.md"), "utf8")).toBe("first");
    expect((await store.read()).overrideActive).toBe(true);
  });
});
