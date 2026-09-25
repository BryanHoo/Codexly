type ShortcutEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "repeat" | "isComposing" | "defaultPrevented">;

export function isTerminalShortcut(event: ShortcutEvent, mac: boolean, acceptRepeated = false): boolean {
  return event.key.toLowerCase() === "j" && (acceptRepeated || !event.repeat) && !event.isComposing && !event.defaultPrevented && !event.shiftKey && !event.altKey
    && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}
