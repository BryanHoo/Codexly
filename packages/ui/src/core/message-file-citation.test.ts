import { describe, expect, it, vi } from "vitest";
import type { MouseEvent } from "react";
import { MessageFileCitation } from "./message-file-citation.js";

describe("文件卡片打开动作", () => {
  it("displays a normal Windows path while opening the original path", () => {
    const onOpen = vi.fn();
    const path = String.raw`\\?\D:\reports\report.pptx`;
    const card = MessageFileCitation({ path, openLabel: "Open", onOpen });
    expect(card.props.title).toBe(String.raw`Open: D:\reports\report.pptx`);
    card.props.onClick?.({} as MouseEvent<HTMLButtonElement>);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith({ path, lineNumber: null }, "system-default");
  });

  it("将字面路径和系统默认应用模式交给平台回调", () => {
    const onOpen = vi.fn();
    const path = String.raw`D:\正式汇报\报告.pptx`;
    const card = MessageFileCitation({ path, openLabel: "系统默认应用", onOpen });
    card.props.onClick?.({} as MouseEvent<HTMLButtonElement>);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith({ path, lineNumber: null }, "system-default");
  });

  it("只读消息没有打开能力时保留文件卡片并禁用点击", () => {
    const card = MessageFileCitation({
      path: "/tmp/report.pptx",
      openLabel: "系统默认应用",
      onOpen: null,
    });
    expect(card.props.disabled).toBe(true);
    expect(() => card.props.onClick?.({} as MouseEvent<HTMLButtonElement>)).not.toThrow();
  });

  it("将右键菜单触发器的事件透传到文件按钮", () => {
    const onContextMenu = vi.fn();
    const card = MessageFileCitation({
      path: "/tmp/report.pptx",
      openLabel: "系统默认应用",
      onOpen: vi.fn(),
      onContextMenu,
    });
    expect(card.props.onContextMenu).toBe(onContextMenu);
  });
});
