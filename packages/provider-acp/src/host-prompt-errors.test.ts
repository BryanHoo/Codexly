import { Writable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { AcpHost } from "./host.js";

it("配置后发送的路由拒绝通过固定错误码表明未提交，其他错误不宣称可重试", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-prompt-error-"));
  const replies: Record<string, unknown>[] = [];
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const message = JSON.parse(chunk.toString()) as Record<string, unknown>;
      if (typeof message["catalogId"] === "number")
        queueMicrotask(() => {
          host.receive(
            Buffer.from(`${JSON.stringify({ catalogId: message["catalogId"], result: null })}\n`),
          );
        });
      else replies.push(message);
      callback();
    },
  });
  const host = new AcpHost(
    directory,
    output,
    vi.fn(() => Promise.reject(new Error("不能启动模型"))),
  );
  const scope = {
    id: "p",
    kind: "project",
    rootPath: directory,
    runtimeWorkspaceRoots: [directory],
  };
  const input = { text: "继续", files: [], images: [], skills: [], textAttachments: [] };
  try {
    host.receive(
      Buffer.from(
        `${JSON.stringify({ id: 1, method: "prompt.start", scope, params: { taskId: "missing", input } })}\n`,
      ),
    );
    await vi.waitFor(() => {
      expect(replies).toContainEqual({ id: 1, error: "ACP_HOST_PROMPT_NOT_SUBMITTED" });
    });
    host.receive(
      Buffer.from(
        `${JSON.stringify({ id: 2, method: "prompt.start", scope, params: { taskId: "missing", input, options: { model: "old" } } })}\n`,
      ),
    );
    await vi.waitFor(() => {
      expect(replies).toContainEqual({ id: 2, error: "ACP_HOST_REQUEST_FAILED" });
    });
  } finally {
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
