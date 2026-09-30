import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboardText } from "./clipboard.js";

afterEach(() => vi.unstubAllGlobals());

function setupSelectionCopy(result = true) {
  const textarea = {
    value: "",
    style: {},
    setAttribute: vi.fn(),
    focus: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    remove: vi.fn(),
  };
  const range = {};
  const selection = {
    rangeCount: 1,
    getRangeAt: vi.fn(() => ({ cloneRange: () => range })),
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
  };
  const focus = vi.fn();
  const execCommand = vi.fn(() => result);
  const append = vi.fn();
  vi.stubGlobal("document", {
    body: { append },
    activeElement: { focus },
    getSelection: () => selection,
    createElement: vi.fn(() => textarea),
    execCommand,
  });
  return { textarea, selection, range, focus, execCommand, append };
}

describe("writeClipboardText", () => {
  it("优先使用现代接口且保留原始文本，不创建临时元素", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { append } = setupSelectionCopy();
    const text = "# 标题\n\n**重点**\n";
    await writeClipboardText(text);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
    expect(append).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, { clipboard: {} }])(
    "API 缺失时同步执行降级复制：%j",
    async (navigator) => {
      vi.stubGlobal("navigator", navigator);
      const { textarea, execCommand, focus, selection, range } = setupSelectionCopy();
      const text = "  first\nsecond\n";
      const copied = writeClipboardText(text);
      // 降级路径不能等待异步任务后才复制，以保留当前点击的用户手势。
      expect(execCommand).toHaveBeenCalledExactlyOnceWith("copy");
      await expect(copied).resolves.toBeUndefined();
      expect(textarea.value).toBe(text);
      expect(textarea.setSelectionRange).toHaveBeenCalledWith(0, text.length);
      expect(textarea.remove).toHaveBeenCalledOnce();
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(selection.addRange).toHaveBeenCalledWith(range);
    },
  );

  it("现代接口被拒绝时尝试降级复制", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const { execCommand } = setupSelectionCopy();
    await expect(writeClipboardText("text")).resolves.toBeUndefined();
    expect(execCommand).toHaveBeenCalledOnce();
  });

  it("降级复制返回 false 时报错并清理临时元素", async () => {
    vi.stubGlobal("navigator", {});
    const { textarea, focus } = setupSelectionCopy(false);
    await expect(writeClipboardText("text")).rejects.toThrow("Unable to copy text");
    expect(textarea.remove).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("降级复制抛错时仍恢复选区和焦点", async () => {
    vi.stubGlobal("navigator", {});
    const { textarea, execCommand, focus, selection, range } = setupSelectionCopy();
    execCommand.mockImplementation(() => {
      throw new Error("copy failed");
    });
    await expect(writeClipboardText("text")).rejects.toThrow("copy failed");
    expect(textarea.remove).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(selection.addRange).toHaveBeenCalledWith(range);
  });

  it("两种复制方式都失败时保留现代接口的错误", async () => {
    const error = new Error("permission denied");
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(error) } });
    setupSelectionCopy(false);
    await expect(writeClipboardText("text")).rejects.toBe(error);
  });

  it("无 DOM 环境下返回明确的异步错误", async () => {
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal("document", undefined);
    await expect(writeClipboardText("text")).rejects.toThrow("Clipboard access is unavailable");
  });
});
