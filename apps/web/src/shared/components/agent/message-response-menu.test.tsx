import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageResponse } from "./message-response.js";

const menuActions = vi.hoisted(() => new Map<string, () => void>());

vi.mock("../core/context-menu.js", () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect: () => void }) => {
    const label = renderToStaticMarkup(<>{children}</>)
      .replace(/<[^>]*>/gu, "")
      .trim();
    menuActions.set(label, onSelect);
    return <div>{children}</div>;
  },
}));

afterEach(() => {
  menuActions.clear();
  vi.unstubAllGlobals();
});

describe("streaming message file reference menu", () => {
  it("copies the absolute path without the line number", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderToStaticMarkup(
      <MessageResponse mode="streaming" onOpenFileReference={vi.fn()}>
        {"[main.ts](/workspace/src/main.ts:12)"}
      </MessageResponse>,
    );

    expect([...menuActions.keys()]).toContain("复制绝对路径");
    menuActions.get("复制绝对路径")?.();
    expect(writeText).toHaveBeenCalledWith("/workspace/src/main.ts");
  });

  it("opens the containing folder while preserving the file reference", () => {
    const onOpenFileReference = vi.fn();
    renderToStaticMarkup(
      <MessageResponse mode="streaming" onOpenFileReference={onOpenFileReference}>
        {"[main.ts](/workspace/src/main.ts:12)"}
      </MessageResponse>,
    );

    expect([...menuActions.keys()]).toEqual(
      expect.arrayContaining(["复制绝对路径", "打开所在文件夹", "在独立窗口打开"]),
    );
    menuActions.get("打开所在文件夹")?.();
    expect(onOpenFileReference).toHaveBeenCalledWith(
      { lineNumber: 12, path: "/workspace/src/main.ts" },
      "containing-folder",
    );
  });
});
