import { afterEach, expect, test, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { render } from "vitest-browser-react";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { MessageMetadata } from "./task-timeline-status.js";
afterEach(() => { clearMocks(); vi.restoreAllMocks(); });

test("copies original Markdown through native IPC even when WebView denies clipboard permission", async () => {
  const invoke = vi.fn().mockResolvedValue(undefined);
  mockIPC(invoke);
  const write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new DOMException("The request is not allowed", "NotAllowedError"));
  const text = "# 标题\n\n**重点**";
  const screen = await render(<TooltipProvider><MessageMetadata text={text} /></TooltipProvider>);
  expect(screen.getByRole("button").all()).toHaveLength(1);
  expect(writeText).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: /Markdown/ }).click();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("plugin:clipboard-manager|write_text", expect.objectContaining({ text }));
  expect(writeText).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
