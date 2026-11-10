import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it, expect } from "vitest";
import { createAcpPrompt } from "./turn-input.js";
const empty = { text: "正文", files: [], images: [], skills: [], textAttachments: [] };
it("文件使用持久副本的 ACP 资源链接，上传临时文件删除后仍可读取", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-input-"));
  try {
    const source = join(root, "source.txt");
    await writeFile(source, "中文内容");
    const prompt = await createAcpPrompt(
      { ...empty, files: [{ path: source, name: "文件.txt", mediaType: "text/plain" }] },
      {},
      join(root, "saved"),
    );
    await rm(source);
    const file = prompt.find((c) => c.type === "resource_link");
    if (file?.type !== "resource_link") throw new Error("缺少链接");
    expect(await readFile(fileURLToPath(file.uri), "utf8")).toBe("中文内容");
    expect(file.name).toBe("文件.txt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("图片需协商能力，支持后发送标准 base64 image", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-image-"));
  try {
    const source = join(root, "a.png");
    await writeFile(source, Buffer.from([1, 2, 3]));
    const input = {
      ...empty,
      images: [{ path: source, mediaType: "image/png" as const, detail: "auto" as const }],
    };
    await expect(createAcpPrompt(input, {}, join(root, "saved"))).rejects.toThrow("图片");
    expect(await createAcpPrompt(input, { image: true }, join(root, "saved"))).toEqual([
      { type: "text", text: "正文" },
      { type: "image", mimeType: "image/png", data: "AQID" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("文本附件保留名称和正文，空输入不提交", async () => {
  expect(
    await createAcpPrompt(
      { ...empty, textAttachments: [{ name: "日志", text: "原始\n内容" }] },
      {},
      "/unused",
    ),
  ).toEqual([
    { type: "text", text: "正文" },
    { type: "text", text: "日志\n原始\n内容" },
  ]);
  await expect(createAcpPrompt({ ...empty, text: "" }, {}, "/unused")).rejects.toThrow("为空");
});
