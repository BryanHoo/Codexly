import { expect, it } from "vitest";
import { jsonBlob, jsonChunks } from "./conversation-export-json.js";

it("逐块输出与格式化 JSON 一致，保留边界 Emoji、孤立代理项和控制字符", async () => {
  const value = {
    text: "a".repeat(8191) + '🐈\ud800\udc00\ud800\udc00\ud800\u0000\n\\"',
    empty: [],
    nil: null,
    absent: undefined,
    nested: [{ x: 1 }, false],
  };
  const expected = JSON.stringify(value, null, 2) + "\n";
  expect(await jsonBlob(value, new TextEncoder().encode(expected).byteLength).text()).toBe(
    expected,
  );
  expect(Math.max(...Array.from(jsonChunks(value), (chunk) => chunk.length))).toBeLessThanOrEqual(
    49_152,
  );
});

it("按实际转义与缩进后的 UTF-8 字节精确拒绝超限", async () => {
  for (const value of [{ text: "中文🐈\n\u0000" }, [], "", { a: [1, 2] }]) {
    const expected = JSON.stringify(value, null, 2) + "\n";
    const size = new TextEncoder().encode(expected).byteLength;
    expect(() => jsonBlob(value, size - 1)).toThrow(RangeError);
    expect(await jsonBlob(value, size).text()).toBe(expected);
  }
});
