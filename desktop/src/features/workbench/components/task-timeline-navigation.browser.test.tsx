import { useCurrentNavigationAnchor } from "@codexly/ui/core/timeline-navigation-anchor";
import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { conversationDisplayPreferences } from "../../settings/conversation-display-preferences.js";
import { MessageAction } from "../../../shared/components/agent/message.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { TaskTimelineNavigation as DesktopNavigation } from "./task-timeline-navigation.js";
import { TaskTimelineNavigation as WebNavigation } from "../../../../../apps/web/src/features/workbench/components/task-timeline-navigation.js";
import { conversationDisplayPreferences as webPreferences } from "../../../../../apps/web/src/features/settings/conversation-display-preferences.js";

beforeEach(() => {
  conversationDisplayPreferences.set("navigation", true);
  webPreferences.set("navigation", true);
});
afterEach(() => {
  conversationDisplayPreferences.set("navigation", false);
  webPreferences.set("navigation", false);
  vi.restoreAllMocks();
});

describe.each([
  { name: "桌面", Navigation: DesktopNavigation, preferences: conversationDisplayPreferences },
  { name: "Web", Navigation: WebNavigation, preferences: webPreferences },
])(
  "$name 消息目录",
  ({ Navigation: TaskTimelineNavigation, preferences: conversationDisplayPreferences }) => {
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
      const hit = document.elementFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
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

    it("关闭时不生成目录索引，长目录只挂载可见按钮", async () => {
      conversationDisplayPreferences.set("navigation", false);
      const onNavigate = vi.fn();
      const getItems = vi.fn(() =>
        Array.from({ length: 4096 }, (_, index) => ({
          anchorId: `long-${index}`,
          turnIndex: index,
          preview: `问题 ${index}`,
        })),
      );
      function Harness() {
        const container = useRef<HTMLDivElement>(null);
        return (
          <TooltipProvider>
            <div
              className="split-workspace-pane"
              ref={container}
              style={{ position: "relative", width: 640, height: 600 }}
            >
              <TaskTimelineNavigation
                items={getItems}
                onNavigate={onNavigate}
                scrollContainerRef={container}
                scrollbarWidth={0}
              />
            </div>
          </TooltipProvider>
        );
      }
      const screen = await render(<Harness />);
      expect(getItems).not.toHaveBeenCalled();
      conversationDisplayPreferences.set("navigation", true);
      await expect.element(screen.getByRole("navigation")).toBeVisible();
      expect(getItems).toHaveBeenCalledOnce();
      expect(
        screen.getByRole("navigation").element().querySelectorAll("button").length,
      ).toBeLessThan(100);
      const navigation = screen.getByRole("navigation").element();
      await expect
        .poll(() => {
          navigation.scrollTop = navigation.scrollHeight;
          navigation.dispatchEvent(new Event("scroll"));
          return navigation.querySelector('[data-timeline-navigation-item="long-4095"]') !== null;
        })
        .toBe(true);
      const last = page.getByRole("button", { name: /4096$/ });
      await expect.element(last).toBeVisible();
      await last.click();
      expect(onNavigate).toHaveBeenCalledExactlyOnceWith(getItems.mock.results[0]!.value[4095]);
      expect(getItems).toHaveBeenCalledOnce();
      conversationDisplayPreferences.set("navigation", false);
      await expect.element(screen.getByRole("navigation")).not.toBeInTheDocument();
      expect(getItems).toHaveBeenCalledOnce();
    });

    it("滚动二分定位当前锚点，不重新查询目录或顺序测量历史", async () => {
      const items = Array.from({ length: 4096 }, (_, index) => ({
        anchorId: `anchor-${index}`,
        preview: `${index}`,
        turnIndex: index,
      }));
      let viewport: HTMLDivElement;
      function Harness() {
        const container = useRef<HTMLDivElement>(null);
        return (
          <div>
            <div
              ref={(node) => {
                container.current = node;
                if (node) viewport = node;
              }}
              style={{ height: 400, overflow: "auto" }}
            >
              {items.map((item) => (
                <div
                  key={item.anchorId}
                  data-conversation-anchor={item.anchorId}
                  style={{ height: 20 }}
                />
              ))}
            </div>
            <AnchorProbe items={items} container={container} />
          </div>
        );
      }
      const screen = await render(<Harness />);
      await expect.element(screen.getByTestId("current-anchor")).toHaveTextContent("anchor-5");
      // 等待 WebKit 的首次尺寸通知完成，再隔离增量正文的测量成本。
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const query = vi.spyOn(viewport!, "querySelectorAll");
      const measure = vi.spyOn(Element.prototype, "getBoundingClientRect");
      // 不改变行高的流式正文更新不应唤醒目录布局测量。
      viewport!.firstElementChild!.textContent = "增量正文";
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      expect(measure).not.toHaveBeenCalled();
      viewport!.scrollTop = 60_000;
      viewport!.dispatchEvent(new Event("scroll"));
      await expect.element(screen.getByTestId("current-anchor")).toHaveTextContent("anchor-3005");
      expect(query).not.toHaveBeenCalled();
      // 4096 个锚点只需约 12 次探测，给浏览器自身与断言保留少量余量。
      expect(measure.mock.calls.length).toBeLessThan(40);
      query.mockRestore();
      measure.mockRestore();
    });
  },
);

it("正文尺寸变化与锚点增删后仍按当前布局定位", async () => {
  const items = [
    { anchorId: "prepended", preview: "补页", turnIndex: 0 },
    ...Array.from({ length: 40 }, (_, index) => ({
      anchorId: `dynamic-${index}`,
      preview: `${index}`,
      turnIndex: index,
    })),
  ];
  let viewport: HTMLDivElement;
  function Harness() {
    const container = useRef<HTMLDivElement>(null);
    return (
      <div>
        <div
          ref={(node) => {
            container.current = node;
            if (node) viewport = node;
          }}
          style={{ height: 400, overflow: "auto", overflowAnchor: "none" }}
        >
          <div data-slot="message-scroller-content">
            {items.slice(1).map((item) => (
              <div
                key={item.anchorId}
                data-conversation-anchor={item.anchorId}
                style={{ height: 20 }}
              />
            ))}
          </div>
        </div>
        <AnchorProbe items={items} container={container} />
      </div>
    );
  }
  const screen = await render(<Harness />);
  await expect.element(screen.getByTestId("current-anchor")).toHaveTextContent("dynamic-5");
  viewport!.scrollTop = 200;
  await expect.element(screen.getByTestId("current-anchor")).toHaveTextContent("dynamic-15");
  const content = viewport!.firstElementChild!;
  (content.firstElementChild as HTMLElement).style.height = "220px";
  await expect.element(screen.getByTestId("current-anchor")).toHaveTextContent("dynamic-5");
  const extra = document.createElement("div");
  extra.dataset["conversationAnchor"] = "prepended";
  extra.style.height = "120px";
  content.prepend(extra);
  viewport!.scrollTop = 0;
  await expect.element(screen.getByTestId("current-anchor")).toHaveTextContent("prepended");
  extra.remove();
  await expect.element(screen.getByTestId("current-anchor")).toHaveTextContent("dynamic-0");
});

function AnchorProbe({
  items,
  container,
}: {
  items: readonly import("@codexly/frontend-core/timeline-navigation").TaskTimelineNavigationItem[];
  container: import("react").RefObject<HTMLDivElement | null>;
}) {
  return (
    <output data-testid="current-anchor">{useCurrentNavigationAnchor(items, container)}</output>
  );
}
