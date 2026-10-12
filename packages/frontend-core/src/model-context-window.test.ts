import { describe, expect, it } from "vitest";
import { parseModelContextWindow } from "./model-context-window.js";

describe("上下文窗口输入", () => {
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
