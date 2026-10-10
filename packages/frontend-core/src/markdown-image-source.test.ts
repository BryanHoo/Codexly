import { describe, expect, it } from "vitest";
import { getMarkdownImagePath } from "./markdown-image-source.js";

describe("Markdown 图片路径边界", () => {
  it.each([
    ["/__codexly_relative__/outputs/中文%20图片.png", "outputs/中文 图片.png"],
    [
      "/__codeagent_relative__/./outputs/icon-designs/comparison.png",
      "./outputs/icon-designs/comparison.png",
    ],
    ["/Users/bryanhu/outputs/comparison.png", "/Users/bryanhu/outputs/comparison.png"],
    ["/C:/outputs/comparison.png", "C:/outputs/comparison.png"],
    ["/__codeagent_unc__/server/share/comparison.png", "//server/share/comparison.png"],
    ["/__codexly_unc__/server/share/comparison.png", "//server/share/comparison.png"],
    ["file:///Users/user/My%20Images/icon.png", "/Users/user/My Images/icon.png"],
    ["file:///C:/outputs/icon.png", "C:/outputs/icon.png"],
    ["sandbox:/mnt/data/icon.png", "/mnt/data/icon.png"],
    ["./outputs/100%.png", "./outputs/100%.png"],
  ])("将 %s 还原为宿主文件路径", (source, expected) => {
    expect(getMarkdownImagePath(source)).toBe(expected);
  });
  it.each([
    "https://example.com/icon.png",
    "http://example.com/icon.png",
    "//example.com/icon.png",
    "blob:local-image",
    "data:image/png;base64,AAAA",
    "asset://localhost/icon.png",
  ])("保留已有浏览器资源 %s", (source) => {
    expect(getMarkdownImagePath(source)).toBeNull();
  });
});
