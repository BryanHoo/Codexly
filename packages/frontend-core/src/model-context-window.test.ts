import { describe, expect, it } from "vitest";
import { parseModelContextWindow } from "./model-context-window.js";

describe("上下文窗口输入", () => {
  it("Claude 容量与自动压缩采用独立范围，不改变 Codex 的默认边界", () => {
    const capacity = { minK: 1, maxK: Math.floor(Number.MAX_SAFE_INTEGER / 1000) };
    const compact = { minK: 100, maxK: 1000 };
    expect(parseModelContextWindow("200", capacity)).toBe(200000);
    expect(parseModelContextWindow("2000", capacity)).toBe(2000000);
    expect(parseModelContextWindow("0", capacity)).toBeUndefined();
    expect(parseModelContextWindow("100", compact)).toBe(100000);
    expect(parseModelContextWindow("99", compact)).toBeUndefined();
    expect(parseModelContextWindow("1001", compact)).toBeUndefined();
    expect(parseModelContextWindow("", compact)).toBeNull();
    expect(parseModelContextWindow("9007199254741", capacity)).toBeUndefined();
  });
  it("空值恢复自动，272–1000 的整数按千 tokens 换算", () => {
    expect(parseModelContextWindow(" ")).toBeNull();
    expect(parseModelContextWindow("272")).toBe(272_000);
    expect(parseModelContextWindow("400")).toBe(400_000);
    expect(parseModelContextWindow(" 1000 ")).toBe(1_000_000);
  });
  it.each([
    "0",
    "-1",
    "271",
    "1001",
    "272.5",
    "1e3",
    "400,000",
    "400000",
    "text",
    "9007199254740992",
  ])("拒绝非法输入 %s", (value) => {
    expect(parseModelContextWindow(value)).toBeUndefined();
  });
});
