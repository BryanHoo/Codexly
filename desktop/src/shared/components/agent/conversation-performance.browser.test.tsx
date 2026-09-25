import { expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { ConversationList } from "./conversation.js";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function getTimelineItemCount(turnIndex: number): number {
  // 复刻 207 轮真实历史的分位分布：总计约 11,505 Item，单 Turn 峰值 335。
  if (turnIndex === 0) return 335;
  if (turnIndex <= 2) return 285;
  if (turnIndex <= 9) return 161;
  if (turnIndex <= 20) return 117;
  return 44;
}

it("测量 207 轮动态高度会话的跳转窗口", async () => {
  const items = Array.from({ length: 207 }, (_, index) => `turn-${String(index)}`);
  const startedAt = performance.now();
  const screen = await render(
    <ConversationList
      conversationId="task-performance-207"
      getItemKey={(turnId) => turnId}
      items={items}
      renderItem={(turnId, index) => (
        <div>
          <span>{turnId}</span>
          {Array.from({ length: getTimelineItemCount(index) }, (_, itemIndex) => (
            <div data-timeline-item="" key={itemIndex} style={{ height: 24 }}>
              item-{String(itemIndex)}
            </div>
          ))}
        </div>
      )}
      style={{ height: 720, overflowY: "auto" }}
    />,
  );
  await nextFrame();
  await nextFrame();
  const initialRenderMs = performance.now() - startedAt;
  const container = screen.getByRole("log").element();
  const jumpDurations: number[] = [];
  let maxMountedTurns = 0;
  let maxMountedTimelineItems = 0;
  let blankFrames = 0;

  for (const ratio of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    const jumpStartedAt = performance.now();
    container.scrollTop = (container.scrollHeight - container.clientHeight) * ratio;
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    await nextFrame();
    jumpDurations.push(performance.now() - jumpStartedAt);
    const containerRect = container.getBoundingClientRect();
    const turns = Array.from(
      container.querySelectorAll<HTMLElement>("[data-conversation-turn]"),
    );
    maxMountedTurns = Math.max(maxMountedTurns, turns.length);
    maxMountedTimelineItems = Math.max(
      maxMountedTimelineItems,
      container.querySelectorAll("[data-timeline-item]").length,
    );
    if (
      !turns.some((turn) => {
        const rect = turn.getBoundingClientRect();
        return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
      })
    ) {
      blankFrames += 1;
    }
  }

  console.info(
    "conversation-performance-207",
    JSON.stringify({
      blankFrames,
      initialRenderMs: Number(initialRenderMs.toFixed(2)),
      maxJumpMs: Number(Math.max(...jumpDurations).toFixed(2)),
      maxMountedTimelineItems,
      maxMountedTurns,
      meanJumpMs: Number(
        (jumpDurations.reduce((total, duration) => total + duration, 0) / jumpDurations.length).toFixed(
          2,
        ),
      ),
    }),
  );
  expect(blankFrames).toBe(0);
  expect(maxMountedTimelineItems).toBeLessThan(1_500);
  expect(maxMountedTurns).toBeLessThan(8);
});
