import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createLazyHistoryProcess } from "@codexly/ui/core/lazy-history-process";

it("does not download process rendering code for a collapsed reply", () => {
  const load = vi.fn(() => Promise.resolve({ default: () => null }));
  const Process = createLazyHistoryProcess<{ expanded: boolean }>(load);
  expect(renderToStaticMarkup(createElement(Process, { expanded: false }))).toBe("");
  expect(load).not.toHaveBeenCalled();
});
