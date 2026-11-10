import { expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoricalTaskAttachments, exportTaskAttachment } from "./task-attachments.js";
it("共享附件引用在重启后恢复，不能跨任务读取", async () => {
  const root = await mkdtemp(join(tmpdir(), "shared-task-attachments-"));
  try {
    const store = new HistoricalTaskAttachments(root);
    const [a] = await store.prepare("task", {
      text: "",
      files: [],
      images: [],
      skills: [],
      textAttachments: [{ name: "a.txt", text: "proof" }],
    });
    if (!a) throw new Error("附件缺失");
    const fresh = new HistoricalTaskAttachments(root);
    expect(Buffer.from((await fresh.read("task", a.id))?.content ?? []).toString()).toBe("proof");
    expect(await fresh.read("other", a.id)).toBeUndefined();
    const exported = await exportTaskAttachment(fresh, "task", a.id);
    expect(await readFile(exported.path, "utf8")).toBe("proof");
    await expect(exportTaskAttachment(fresh, "other", a.id)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
