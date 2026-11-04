import { afterEach, expect, it, vi } from "vitest";
import { createNativeAttachmentDrop } from "./attachment-drop.js";

const mocks = vi.hoisted(() => ({ listen: vi.fn(), native: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.native, convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: mocks.listen }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("shares one native subscription, converts high DPI positions and releases the last subscriber", async () => {
  vi.stubGlobal("window", { devicePixelRatio: 2 });
  const unlisten = vi.fn();
  mocks.listen.mockResolvedValueOnce(unlisten);
  const client = { importHostAttachment: vi.fn() };
  const first = vi.fn();
  const second = vi.fn();
  const stopFirst = await createNativeAttachmentDrop(client, "one").subscribe(first);
  const stopSecond = await createNativeAttachmentDrop(client, "two").subscribe(second);
  expect(mocks.listen).toHaveBeenCalledTimes(1);
  mocks.listen.mock.calls[0]![0]({ payload: { type: "drop", paths: ["C:\\图.PNG"], position: { x: 200, y: 100 } } });
  expect(first).toHaveBeenCalledWith({ type: "drop", paths: ["C:\\图.PNG"], x: 100, y: 50 });
  expect(second).toHaveBeenCalledTimes(1);
  stopFirst();
  expect(unlisten).not.toHaveBeenCalled();
  stopSecond();
  expect(unlisten).toHaveBeenCalledTimes(1);
});
it("imports local paths through the existing client without loading bytes", async () => {
  const attachment = { id: "/cache/image.png", kind: "image" as const, name: "图.PNG", size: 3, mediaType: "image/png" };
  const client = { importHostAttachment: vi.fn(async () => ({ attachment })) };
  const adapter = createNativeAttachmentDrop(client, "project");
  await expect(adapter.importPath("C:\\图.PNG")).resolves.toMatchObject({ source: "host", previewUrl: "asset:/cache/image.png", attachment: { ...attachment, detail: "auto" } });
  expect(client.importHostAttachment).toHaveBeenCalledWith("project", "image", "C:\\图.PNG");
  await adapter.importPath("/tmp/report.pdf");
  expect(client.importHostAttachment).toHaveBeenLastCalledWith("project", "file", "/tmp/report.pdf");
});
it("can retry failed registration and skips native APIs in browser previews", async () => {
  const adapter = createNativeAttachmentDrop({ importHostAttachment: vi.fn() }, "p");
  mocks.listen.mockRejectedValueOnce(new Error("registration failed"));
  await expect(adapter.subscribe(vi.fn())).rejects.toThrow("registration failed");
  const unlisten = vi.fn();
  mocks.listen.mockResolvedValueOnce(unlisten);
  const stop = await adapter.subscribe(vi.fn());
  stop();
  expect(unlisten).toHaveBeenCalledOnce();
  mocks.native.mockReturnValueOnce(false);
  const stopPreview = await adapter.subscribe(vi.fn());
  stopPreview();
  expect(mocks.listen).toHaveBeenCalledTimes(2);
});
