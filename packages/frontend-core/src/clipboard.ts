function copyWithSelection(text: string): void {
  if (typeof document === "undefined") {
    throw new Error("Clipboard access is unavailable. Use HTTPS or allow clipboard access.");
  }
  const body = document.body as HTMLElement | null;
  const legacyDocument: { execCommand?: (command: string) => boolean } = document;
  const execCommand = legacyDocument.execCommand?.bind(document);
  if (!body || typeof execCommand !== "function") {
    throw new Error("Clipboard access is unavailable. Use HTTPS or allow clipboard access.");
  }
  const activeElement: (Element & { focus?: (options: FocusOptions) => void }) | null =
    document.activeElement;
  const selection = document.getSelection();
  const ranges: Range[] = [];
  for (let index = 0; selection && index < selection.rangeCount; index++) {
    ranges.push(selection.getRangeAt(index).cloneRange());
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute("aria-hidden", "true");
  // HTTP 部署可能没有 Clipboard API；可选中的屏外文本仍可在点击手势内复制。
  Object.assign(textarea.style, { position: "fixed", left: "-9999px", top: "0", fontSize: "16px" });
  body.append(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    if (!execCommand("copy"))
      throw new Error("Unable to copy text. Allow clipboard access or use HTTPS.");
  } finally {
    textarea.remove();
    activeElement?.focus?.({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}

export async function writeClipboardText(text: string): Promise<void> {
  // DOM 类型将这些接口声明为必填，但非安全上下文或受限 WebView 实际可能不提供。
  const browserNavigator = globalThis.navigator as
    { clipboard?: Partial<Pick<Clipboard, "writeText">> } | undefined;
  const clipboard = browserNavigator?.clipboard;
  if (typeof clipboard?.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return;
    } catch (error) {
      // 授权或 WebView 限制也可能拒绝现代接口；两种方式都失败时保留原始错误。
      try {
        copyWithSelection(text);
        return;
      } catch {
        throw error;
      }
    }
  }
  copyWithSelection(text);
}
