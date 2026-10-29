import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { conversationDisplayPreferences } from "../../settings/conversation-display-preferences.js";
import { MessageAction } from "../../../shared/components/agent/message.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { TaskTimelineNavigation } from "./task-timeline-navigation.js";

beforeEach(() => conversationDisplayPreferences.set("navigation", true));
afterEach(() => conversationDisplayPreferences.set("navigation", false));

it("锚点左侧的消息复制按钮可点击，刻度仍可预览与跳转", async () => {
  const onCopy = vi.fn();
  const onNavigate = vi.fn();
  const items = [1, 2].map((id) => ({
    anchorId: `message-${id}`,
    turnIndex: id - 1,
    preview: `问题 ${id}`,
  }));
  function Harness() {
    const container = useRef<HTMLDivElement>(null);
    return (
      <TooltipProvider>
        <div
          className="split-workspace-pane"
          ref={container}
          style={{ position: "relative", width: 640, height: 400 }}
        >
          {/* 将复制按钮与首个刻度对齐，复现目录透明热区覆盖消息操作的布局。 */}
          <MessageAction
            label="复制消息"
            onClick={onCopy}
            style={{ position: "absolute", right: 24, top: "calc(50% - 18px)" }}
          >
            复制
          </MessageAction>
          <TaskTimelineNavigation
            items={items}
            onNavigate={onNavigate}
            scrollContainerRef={container}
            scrollbarWidth={0}
          />
        </div>
      </TooltipProvider>
    );
  }
  const screen = await render(<Harness />);
  const anchor = screen.getByRole("navigation").getByRole("button").first();
  await expect.element(anchor).toBeVisible();
  const copy = screen.getByRole("button", { name: "复制消息" });
  const button = copy.element();
  const bounds = button.getBoundingClientRect();
  const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  expect(hit === button || (hit !== null && button.contains(hit))).toBe(true);
  await copy.hover();
  await copy.click();
  expect(onCopy).toHaveBeenCalledOnce();
  expect(onNavigate).not.toHaveBeenCalled();
  expect(page.getByRole("tooltip").query()).toBeNull();

  await anchor.hover();
  await expect.element(page.getByRole("tooltip")).toHaveTextContent("问题 1");
  await anchor.click();
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith(items[0]);
});
