import { expect, test, vi } from "vitest";
import { createSavedPromptsSync } from "./saved-prompts-sync.js";

test("retains legacy data on failure and clears it only after a successful import", async () => {
  const prompt = { id: "old", name: "检查", content: "正文" };
  const clear = vi.fn();
  const publish = vi.fn();
  const request = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([prompt]);
  const sync = createSavedPromptsSync({
    request,
    readLegacy: () => [prompt],
    clearLegacy: clear,
    publish,
  });
  await expect(sync.refresh()).rejects.toThrow("offline");
  expect(clear).not.toHaveBeenCalled();
  await sync.refresh();
  expect(request).toHaveBeenNthCalledWith(2, { action: "import", prompts: [prompt] });
  expect(clear).toHaveBeenCalledOnce();
  await sync.refresh();
  expect(request).toHaveBeenLastCalledWith({ action: "list" });
});

test("coalesces concurrent refreshes and keeps a delayed read from overwriting a save", async () => {
  const old = { id: "id", name: "检查", content: "旧正文" };
  const updated = { ...old, content: "新正文" };
  let resolveRead: ((value: (typeof old)[]) => void) | undefined;
  const reading = new Promise<(typeof old)[]>((resolve) => {
    resolveRead = resolve;
  });
  const request = vi.fn().mockReturnValueOnce(reading).mockResolvedValue([updated]);
  const publish = vi.fn();
  const sync = createSavedPromptsSync({
    request,
    readLegacy: () => [],
    clearLegacy: vi.fn(),
    publish,
  });
  const first = sync.refresh();
  expect(sync.refresh()).toBe(first);
  const saving = sync.run({ action: "save", prompt: updated });
  await vi.waitFor(() => {
    expect(request).toHaveBeenCalledTimes(1);
  });
  resolveRead?.([old]);
  await Promise.all([first, saving]);
  expect(publish).toHaveBeenLastCalledWith([updated]);
  expect(request).toHaveBeenNthCalledWith(2, { action: "save", prompt: updated });
});
