import { describe, expect, it } from "vitest";

import { formatTaskBoardElapsed } from "./task-board-time.js";

describe("formatTaskBoardElapsed", () => {
  it("使用紧凑的分钟、小时和天数展示运行时长", () => {
    const now = Date.parse("2026-09-02T10:00:00.000Z");

    expect(formatTaskBoardElapsed("2026-09-02T09:59:45.000Z", now)).toBe("<1m");
    expect(formatTaskBoardElapsed("2026-09-02T09:55:00.000Z", now)).toBe("5m");
    expect(formatTaskBoardElapsed("2026-09-02T07:55:00.000Z", now)).toBe("2h 5m");
    expect(formatTaskBoardElapsed("2026-08-31T07:00:00.000Z", now)).toBe("2d 3h");
    expect(formatTaskBoardElapsed("invalid", now)).toBeNull();
  });
});
