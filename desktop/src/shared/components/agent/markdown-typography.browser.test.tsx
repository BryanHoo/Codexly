import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import "../../styles/globals.css";
import { markdownTypographyClassName } from "./markdown-typography.js";

describe("shared timeline and task window typography", () => {
  it("keeps headings, quotes, code and oversized images within their layout", async () => {
    const screen = await render(
      <div className={markdownTypographyClassName} style={{ width: 160 }}>
        <h1>Title</h1>
        <h2>Section</h2>
        <h3>Detail</h3>
        <blockquote>Quoted reply</blockquote>
        <code>Inline code</code>
        <img alt="Attachment" width={800} height={400} />
        <pre>{"x".repeat(200)}</pre>
        <p>Last paragraph</p>
      </div>,
    );
    const root = screen.container.firstElementChild!;
    const style = (selector: string) => getComputedStyle(root.querySelector(selector)!);
    expect(getComputedStyle(root).overflowWrap).toBe("break-word");
    expect(style("h1").fontSize).toBe("20px");
    expect(style("h2").fontSize).toBe("18px");
    for (const heading of ["h1", "h2", "h3"]) {
      expect(style(heading).fontWeight).toBe("650");
    }
    expect(style("blockquote").borderLeftWidth).toBe("2px");
    expect(style("blockquote").paddingLeft).toBe("12px");
    expect(style("code").fontSize).toBe("13px");
    expect(style("img").display).toBe("block");
    expect(style("img").objectFit).toBe("contain");
    expect(root.querySelector("img")!.getBoundingClientRect().width).toBeLessThanOrEqual(160);
    expect(style("pre").overflowX).toBe("auto");
    expect(root.querySelector("pre")!.scrollWidth).toBeGreaterThan(160);
    expect(style("h1").marginTop).toBe("0px");
    expect(style("p").marginBottom).toBe("0px");
  });
});
