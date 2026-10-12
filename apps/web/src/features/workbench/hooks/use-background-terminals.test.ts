import { describe, expect, it } from "vitest";

import {
  getBackgroundTerminalPollInterval,
  shouldRefreshBackgroundTerminals,
} from "./use-background-terminals.js";

describe("background terminal polling", () => {
  it("continues polling after the AI turn completes while a terminal is still running", () => {
    expect(getBackgroundTerminalPollInterval(false, 1)).toBe(1_500);
  });

  it("uses a low-frequency discovery fallback when a running turn has no terminals", () => {
    expect(getBackgroundTerminalPollInterval(true, 0)).toBe(10_000);
    expect(getBackgroundTerminalPollInterval(false, 0)).toBe(false);
    expect(getBackgroundTerminalPollInterval(true, 1)).toBe(1_500);
  });

  it("does not bypass lazy loading when the context tab is inactive", () => {
    expect(shouldRefreshBackgroundTerminals(false, true, false, "task-1")).toBe(false);
    expect(shouldRefreshBackgroundTerminals(true, true, false, "task-1")).toBe(true);
  });
});
