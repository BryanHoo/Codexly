import { describe, expect, it } from "vitest";

import { reasoningTitle } from "./reasoning-title.js";

describe("reasoningTitle", () => {
  it("uses the first nonempty line without Markdown markup", () => {
    expect(reasoningTitle("\n## **检查** [文件](https://example.com) `src/a.ts`\n下一行", "推理摘要"))
      .toBe("检查 文件 src/a.ts");
  });

  it("falls back when the summary is empty", () => {
    expect(reasoningTitle("  \n", "推理摘要")).toBe("推理摘要");
  });

  it("keeps underscores in identifiers", () => {
    expect(reasoningTitle("**检查** `file_name.ts`", "推理摘要")).toBe("检查 file_name.ts");
    expect(reasoningTitle("***核对*** file_name.ts", "推理摘要")).toBe("核对 file_name.ts");
  });
});
