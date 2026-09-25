import { describe, expect, it } from "vitest";
import { parseTaskWindowMarkdown } from "./task-window-markdown.js";

describe("task window Markdown projection", () => {
  it("splits long paragraphs and code into bounded render blocks", () => {
    const blocks = parseTaskWindowMarkdown("**" + "输出😀".repeat(500) + "**\n\n```ts\n" + "x".repeat(2000));
    expect(blocks.length).toBeGreaterThan(10);
    expect(blocks.every((block) => block.runs.reduce((length, run) => length + Array.from(run.text).length, 0) <= 240)).toBe(true);
    expect(blocks[0]?.runs[0]?.marks).toContain("strong");
    expect(blocks.some((block) => block.kind === "code")).toBe(true);
  });
  it("keeps Markdown structure and discards raw HTML and remote image loads", () => {
    const blocks = parseTaskWindowMarkdown("## 标题\n\n- **加粗**\n- `code`\n\n> 引用\n\n<script>alert(1)</script>\n\n![示意](https://example.com/image.png)");
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "list", "list", "quote", "paragraph"]);
    expect(JSON.stringify(blocks)).not.toContain("alert(1)");
    expect(JSON.stringify(blocks)).not.toContain("https://");
  });

  it("renders Chinese bold labels without changing code or escaped markers", () => {
    const blocks = parseTaskWindowMarkdown("- **持续对话： **使用 `query()`\n- **精确恢复：**记录原生");
    expect(blocks.flatMap((block) => block.runs).filter((run) => run.marks.includes("strong")).map((run) => run.text)).toEqual(["持续对话：", "精确恢复："]);
    const literal = parseTaskWindowMarkdown("`**持续对话： **`\n\n\\*\\*持续对话： \\*\\*");
    expect(literal.flatMap((block) => block.runs).some((run) => run.marks.includes("strong"))).toBe(false);
  });

});
