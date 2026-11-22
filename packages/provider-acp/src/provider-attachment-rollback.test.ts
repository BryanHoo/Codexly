import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import type * as acp from "@agentclientprotocol/sdk/unstable";
import type { AgentTurnOptions } from "@codexly/protocol";
import { fixture, input } from "./provider.test-support.js";

async function copies(directory: string, taskId: string) {
  try {
    return await readdir(
      join(directory, "attachments", createHash("sha256").update(taskId).digest("hex")),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

it.each(["codex", "claude"] as const)(
  "%s 创建会话连续失败三次不遗留本次附件副本",
  async (engine) => {
    const f = await fixture(engine);
    const path = join(f.history.directory, "upload.txt");
    await writeFile(path, "重试附件");
    const task = await f.provider.startTask();
    f.created.mockRejectedValue(new Error("创建会话失败"));
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(
        f.provider.startTurn(
          task.id,
          {
            ...input,
            files: [{ path, name: "upload.txt", mediaType: "text/plain" }],
          },
          {} as AgentTurnOptions,
        ),
      ).rejects.toMatchObject({ name: "AgentTurnNotSubmittedError" });
      expect(await copies(f.history.directory, task.id)).toEqual([]);
      expect((await f.history.read(task.id)).turns).toEqual([]);
      expect(await readFile(path, "utf8")).toBe("重试附件");
    }
  },
);

it.each(["历史附件", "配置", "标题"])(
  "%s 准备失败只回收本次副本，保留已提交附件",
  async (stage) => {
    const f = await fixture("codex");
    const path = join(f.history.directory, "upload.txt");
    await writeFile(path, "旧附件");
    const task = await f.provider.startTask();
    const turnInput = { ...input, files: [{ path, name: "upload.txt", mediaType: "text/plain" }] };
    await f.provider.startTurn(task.id, turnInput, {} as AgentTurnOptions);
    await expect.poll(async () => (await f.provider.readTask(task.id)).status).toBe("idle");
    const previous = await copies(f.history.directory, task.id);
    expect(previous).toHaveLength(1);
    if (stage === "历史附件")
      vi.spyOn(f.provider.attachments, "prepare").mockRejectedValueOnce(new Error("历史附件失败"));
    if (stage === "标题") f.provider.prepareTaskTitle = () => Promise.reject(new Error("标题失败"));
    await expect(
      f.provider.startTurn(task.id, turnInput, {
        ...(stage === "配置" ? { model: "不存在的模型" } : {}),
      } as AgentTurnOptions),
    ).rejects.toMatchObject({ name: "AgentTurnNotSubmittedError" });
    expect(await copies(f.history.directory, task.id)).toEqual(previous);
    const snapshot = await f.provider.readTask(task.id);
    const user = snapshot.turns[0]?.items.find(
      (item) => item.type === "message" && item.role === "user",
    );
    if (user?.type !== "message" || !user.attachments?.[0]) throw new Error("旧附件缺失");
    expect(
      Buffer.from(
        (await f.provider.readTaskAttachment(task.id, user.attachments[0].id))?.content ?? [],
      ).toString(),
    ).toBe("旧附件");
  },
);

it("开始调用 prompt 后结果未知仍保留资源副本", async () => {
  let prompt: acp.ContentBlock[] = [];
  const f = await fixture("claude", ({ params }) => {
    prompt = params.prompt;
    return Promise.reject(new Error("响应丢失，结果未知"));
  });
  const path = join(f.history.directory, "upload.txt");
  await writeFile(path, "必须保留");
  const task = await f.provider.startTask();
  await f.provider.startTurn(
    task.id,
    { ...input, files: [{ path, name: "upload.txt", mediaType: "text/plain" }] },
    {} as AgentTurnOptions,
  );
  await expect
    .poll(async () => (await f.provider.readTask(task.id)).turns.at(-1)?.status)
    .toBe("failed");
  expect(await copies(f.history.directory, task.id)).toHaveLength(1);
  const resource = prompt.find((block) => block.type === "resource_link");
  if (!resource) throw new Error("资源链接缺失");
  expect(await readFile(fileURLToPath(resource.uri), "utf8")).toBe("必须保留");
});
