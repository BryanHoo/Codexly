export function isSplitBlankPoint(target: EventTarget | null, x: number, y: number): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      'a, button, input, textarea, select, label, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="menu"], .xterm, img, video, audio, canvas, pre, code',
    )
  )
    return false;
  const document = target.ownerDocument;
  if (document.getSelection()?.isCollapsed === false) return false;
  // 按实际字符矩形判断正文，段落的行尾及容器留白仍然能打开菜单。
  const caretDocument: {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  } = document;
  let range = caretDocument.caretRangeFromPoint?.(x, y);
  if (range === undefined) {
    const caret = caretDocument.caretPositionFromPoint?.(x, y);
    if (caret !== undefined && caret !== null) {
      range = document.createRange();
      range.setStart(caret.offsetNode, caret.offset);
    }
  }
  const node = range?.startContainer;
  if (range && node?.nodeType === Node.TEXT_NODE && target.contains(node)) {
    const offset = range.startOffset;
    range.setStart(node, Math.max(0, offset - 1));
    range.setEnd(node, Math.min(node.textContent?.length ?? 0, offset + 1));
    for (const rect of range.getClientRects()) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return false;
    }
  }
  return true;
}
