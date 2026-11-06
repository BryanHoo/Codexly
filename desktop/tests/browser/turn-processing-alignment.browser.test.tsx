import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { TurnProcessingTime as WebTimer } from "../../../apps/web/src/features/workbench/components/task-timeline-status.js";
import { TurnProcessingTime as DesktopTimer } from "../../src/features/workbench/components/task-timeline-status.js";
import "../../src/shared/styles/globals.css";

for (const [platform, Timer] of [["web", WebTimer], ["desktop", DesktopTimer]] as const) {
  it.each([360, 1280])(`${platform} 计时栏在 %ipx 宽度下垂直居中`, async (width) => {
    const screen = await render(
      <div style={{ width }}>
        <Timer status="completed" startedAt="2026-11-06T00:00:00Z"
          completedAt="2026-11-06T00:03:58Z" onToggle={() => undefined} />
      </div>,
    );
    const timer = screen.container.querySelector<HTMLElement>("[data-turn-processing-time]")!;
    const bounds = timer.getBoundingClientRect();
    const center = bounds.top + bounds.height / 2;
    // 测量真实布局而非类名，确保图标、文字、耗时和箭头均位于整栏的垂直中心。
    expect(timer.querySelector("time")?.textContent).toBe("3m 58s");
    for (const child of timer.children) {
      const rect = child.getBoundingClientRect();
      expect(Math.abs(rect.top + rect.height / 2 - center)).toBeLessThanOrEqual(1);
    }
  });
}
