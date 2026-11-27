import { expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { directoryPatch } from "./codefree-session.js";
import { CodefreeOutput, promptPart } from "./codefree-turn.js";

it("附加目录授权可撤销，保留原有拒绝规则", () => {
  const cwd = resolve("work"),
    extra = resolve("extra");
  const grant = directoryPatch(cwd, [cwd, extra, extra]);
  expect(grant.permission).toHaveLength(1);
  const deny = { permission: "external_directory", pattern: "*", action: "deny" };
  const restored = directoryPatch(cwd, [], {
    id: "test",
    title: "",
    time: { updated: 0 },
    directory: cwd,
    metadata: { ...grant.metadata, custom: true },
    permission: [...(grant.permission ?? []), deny],
  });
  expect(restored.permission).toEqual([deny]);
  expect(restored.metadata).toMatchObject({ custom: true });
  expect(() => directoryPatch(cwd, [extra + "*"])).toThrow();
});
it("嵌入资源使用 ACP 传入的内容，工具完成事件保留文件差异和位置", async () => {
  expect(
    promptPart({ type: "resource", resource: { uri: "file:///unsaved", text: "未保存内容" } }),
  ).toEqual({ type: "text", text: "未保存内容" });
  expect(
    promptPart({
      type: "resource",
      resource: { uri: "test:blob", mimeType: "image/png", blob: "eA==" },
    }),
  ).toMatchObject({ type: "file", url: "data:image/png;base64,eA==" });
  const notify = vi.fn(() => Promise.resolve());
  const output = new CodefreeOutput(notify, resolve("work"));
  const part = {
    id: "p",
    messageID: "m",
    type: "tool",
    callID: "c",
    tool: "edit",
    state: { status: "running", input: { filePath: "a.ts" } },
  };
  await output.part(part);
  await output.part({
    ...part,
    state: {
      ...part.state,
      status: "completed",
      metadata: { filediff: { file: "a.ts", before: "旧", after: "新" } },
    },
  });
  expect(notify).toHaveBeenLastCalledWith(
    expect.objectContaining({
      sessionUpdate: "tool_call_update",
      status: "completed",
      kind: "edit",
      locations: [{ path: resolve("work", "a.ts") }],
      content: [{ type: "diff", path: resolve("work", "a.ts"), oldText: "旧", newText: "新" }],
    }),
  );
});
