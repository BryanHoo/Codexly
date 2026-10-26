import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, expect, it } from "vitest";
import { mapCodexMessageImage } from "./agent-provider-message-attachments.js";
import { mapAgentItem } from "./codex-item-mapping.js";
import { CodexHistoricalAttachmentStore } from "./historical-attachment-store.js";
import { JsonlFrameProcessor, readStagedImage } from "./jsonl-frame-processor.js";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const fileImage = {
  failure: null,
  fileId: "private-file-id",
  id: "generated-image",
  inputImages: [{ path: "/private/reference.png", sha256: "ab".repeat(32) }],
  revisedPrompt: null,
  status: "completed",
  type: "imageGeneration",
};

describe("Codex 0.164 图片文件引用", () => {
  it("将无法读取的文件引用投影为消息占位，不暴露内部元数据", () => {
    const item = mapAgentItem(fileImage);
    expect(item).toEqual({ id: fileImage.id, role: "assistant", text: "[图片]", type: "message" });
  });

  it("不把未完成或失败的文件引用显示为成功图片", () => {
    expect(mapAgentItem({ ...fileImage, status: "inProgress" })).toMatchObject({
      status: "running",
      type: "tool",
    });
    expect(
      mapAgentItem({
        ...fileImage,
        failure: { limitId: "private-limit", resetsAt: null, type: "usageLimitExceeded" },
        status: "failed",
      }),
    ).toMatchObject({ status: "failed", type: "tool", output: { reason: "usage_limit_exceeded" } });
  });

  it.each([undefined, "/missing/codexly-generated-image.png"])(
    "文件引用优先于迁移记录中的旧 Base64，savedPath=%s",
    async (savedPath) => {
      const store = new CodexHistoricalAttachmentStore();
      try {
        expect(
          await mapCodexMessageImage(
            store,
            "task-1",
            { ...fileImage, result: png.toString("base64"), savedPath },
            0,
          ),
        ).toBeUndefined();
      } finally {
        store.dispose();
      }
    },
  );

  it("继续使用文件引用的有效 savedPath，并保留附件授权", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codexly-164-image-"));
    const savedPath = join(directory, "generated.png");
    writeFileSync(savedPath, png);
    const store = new CodexHistoricalAttachmentStore();
    try {
      const attachment = await mapCodexMessageImage(
        store,
        "task-1",
        { ...fileImage, savedPath },
        0,
      );
      expect(attachment).toMatchObject({ kind: "image", mediaType: "image/png", size: png.length });
      assert(attachment !== undefined);
      const mapped = mapAgentItem(fileImage, new Map(), () => attachment);
      expect(mapped).toMatchObject({ attachments: [attachment], text: "", type: "message" });
      const serialized = JSON.stringify(mapped);
      expect(serialized).not.toContain(fileImage.fileId);
      expect(serialized).not.toContain("/private/reference.png");
      await expect(store.read("task-1", attachment.id)).resolves.toMatchObject({ content: png });
      await expect(store.read("another-task", attachment.id)).resolves.toBeUndefined();
    } finally {
      store.dispose();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("大帧 Worker 丢弃文件引用的旧正文，不解码或暂存过期图片", async () => {
    const processor = new JsonlFrameProcessor();
    try {
      const message = (await processor.parse(
        Buffer.from(JSON.stringify({ items: [{ ...fileImage, result: png.toString("base64") }] })),
      )) as { items: Record<string, unknown>[] };
      const item = message.items[0];
      assert(item !== undefined);
      expect(item["fileId"]).toBe(fileImage.fileId);
      expect(item).not.toHaveProperty("result");
      expect(readStagedImage(item)).toBeUndefined();
    } finally {
      processor.dispose();
    }
  });
});
