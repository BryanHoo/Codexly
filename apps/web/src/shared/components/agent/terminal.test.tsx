import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Terminal, TerminalContent } from "./terminal.js";

function renderTerminal(output: string): string {
  return renderToStaticMarkup(
    <Terminal output={output}>
      <TerminalContent />
    </Terminal>,
  );
}

describe("TerminalContent", () => {
  it("uses an ANSI parser without the vulnerable linkification dependency", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"),
    ) as { dependencies: Record<string, string> };

    expect(packageJson.dependencies).toHaveProperty("anser", "catalog:");
    expect(packageJson.dependencies).not.toHaveProperty("ansi-to-react");
  });

  it("renders ANSI styles without turning command output into links", () => {
    const markup = renderTerminal(
      "\u001b[31merror\u001b[0m https://example.com mailto:security@example.com",
    );

    expect(markup).toContain("color:rgb(187, 0, 0)");
    expect(markup).toContain("https://example.com mailto:security@example.com");
    expect(markup).not.toContain("<a");
  });
});
