import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import type * as FileSystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { readProjectTextFile, saveProjectTextFile } from "./project-text-file.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof FileSystem>();
  return {
    ...fs,
    rename: async (source: string, target: string) => {
      await fs.rename(source, target);
      // 模拟外部程序在原子保存完成后、附加缓存标记前删除目标。
      await fs.unlink(target);
    },
  };
});

it("acknowledges a completed save even if its optional cache revision is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "codexly-edit-receipt-"));
  try {
    await writeFile(join(root, "a.txt"), "old");
    const original = await readProjectTextFile(root, "a.txt");
    expect(
      await saveProjectTextFile(root, {
        path: "a.txt",
        content: "saved",
        expectedVersion: original.version,
      }),
    ).toEqual({
      version: createHash("sha256").update("saved").digest("hex"),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
