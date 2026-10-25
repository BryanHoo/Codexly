import { afterEach, expect, it, vi } from "vitest";
import { downloadFile } from "./download-file.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("下载 UTF-8 JSON，移除临时节点并在浏览器接管下载后释放 URL", async () => {
  vi.useFakeTimers();
  let file: Blob | undefined;
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", {
    createObjectURL: (blob: Blob) => {
      file = blob;
      return "blob:export";
    },
    revokeObjectURL,
  });
  const anchor = { click: vi.fn(), remove: vi.fn(), href: "", download: "" };
  vi.stubGlobal("document", { createElement: () => anchor, body: { append: vi.fn() } });
  downloadFile("记录.json", '{"text":"你好 🐈"}');
  expect(anchor).toMatchObject({ href: "blob:export", download: "记录.json" });
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.remove).toHaveBeenCalledOnce();
  expect(file?.type).toBe("application/json;charset=utf-8");
  expect(JSON.parse(await (file?.text() ?? Promise.resolve("null")))).toEqual({ text: "你好 🐈" });
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
});

it("下载触发失败时仍清理节点和 Blob URL", () => {
  vi.useFakeTimers();
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: () => "blob:failed", revokeObjectURL });
  const anchor = {
    click: () => {
      throw new Error("failed");
    },
    remove: vi.fn(),
  };
  vi.stubGlobal("document", { createElement: () => anchor, body: { append: vi.fn() } });
  expect(() => {
    downloadFile("file.json", "{}");
  }).toThrow("failed");
  expect(anchor.remove).toHaveBeenCalledOnce();
  vi.runAllTimers();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:failed");
});
