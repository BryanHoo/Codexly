import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TimelineItemContent } from "./task-timeline-items.js";
import { formatToolDuration } from "./task-timeline-status.js";

describe("tool duration", () => {
  it("freezes completed duration after later clock ticks", () => {
    expect(formatToolDuration({ startedAtMs: 1_000, completedAtMs: 3_500 }, 10_000)).toBe("2.5s");
  });
  it("renders elapsed duration while a command is running", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T00:00:03.500Z"));
    try {
      const markup = renderToStaticMarkup(
        createElement(TimelineItemContent, {
          isLastTurnItem: true,
          item: {
            command: "pwd",
            cwd: "/workspace",
            id: "command-live",
            outputOmitted: { bytes: 0, lines: 0 },
            status: "running",
            type: "command",
          },
          itemTiming: { startedAtMs: Date.parse("2026-09-26T00:00:01.000Z") },
          onOpenFileDiff: () => undefined,
          onOpenSourceFile: () => undefined,
          projectId: "project-1",
          taskId: "task-1",
          turnStatus: "running",
        }),
      );
      expect(markup).toMatch(/data-tool-duration[^>]*>2\.5s<\/span>\s*<span[^>]*>.*?运行中/su);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders duration before the command status without a timestamp", () => {
    const markup = renderToStaticMarkup(
      createElement(TimelineItemContent, {
        isLastTurnItem: true,
        item: {
          command: "pwd",
          cwd: "/workspace",
          id: "command-1",
          outputOmitted: { bytes: 0, lines: 0 },
          status: "completed",
          type: "command",
        },
        itemTiming: { startedAtMs: 1_753_318_800_000, completedAtMs: 1_753_318_802_500 },
        onOpenFileDiff: () => undefined,
        onOpenSourceFile: () => undefined,
        projectId: "project-1",
        taskId: "task-1",
        turnStatus: "completed",
      }),
    );
    expect(markup).toMatch(/data-tool-duration[^>]*>2\.5s<\/span>\s*<span[^>]*>.*?已完成/su);
    expect(markup).not.toContain(new Date(1_753_318_800_000).toISOString());
  });

  it("renders generic and subagent tool durations beside their statuses", () => {
    for (const item of [
      { id: "tool-1", name: "read_file", status: "completed", type: "tool" },
      { id: "subagent-1", name: "agent/wait", status: "completed", type: "tool" },
    ] as const) {
      const markup = renderToStaticMarkup(
        createElement(TimelineItemContent, {
          isLastTurnItem: true,
          item,
          itemTiming: { startedAtMs: 1_753_318_800_000, completedAtMs: 1_753_318_800_250 },
          onOpenFileDiff: () => undefined,
          onOpenSourceFile: () => undefined,
          projectId: "project-1",
          taskId: "task-1",
          turnStatus: "completed",
        }),
      );
      expect(markup).toMatch(/data-tool-duration[^>]*>250ms<\/span>\s*<span[^>]*>.*?已完成/su);
      expect(markup).not.toContain("dateTime=");
    }
  });
});
