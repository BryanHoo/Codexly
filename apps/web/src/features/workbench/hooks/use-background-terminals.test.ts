import { describe, expect, it } from "vitest";

import {
  getBackgroundTerminalPollInterval,
  shouldRefreshBackgroundTerminals,
} from "./use-background-terminals.js";

describe("background terminal polling", () => {
  it("continues polling after the AI turn completes while a terminal is still running", () => {
    expect(getBackgroundTerminalPollInterval(false, 1)).toBe(1_500);
  });

  it("stops polling only after both the turn and all terminals finish", () => {
    expect(getBackgroundTerminalPollInterval(true, 0)).toBe(1_500);
    expect(getBackgroundTerminalPollInterval(false, 0)).toBe(false);
  });

  it("does not bypass lazy loading when the context tab is inactive", () => {
    expect(shouldRefreshBackgroundTerminals(false, true, false, "task-1")).toBe(false);
    expect(shouldRefreshBackgroundTerminals(true, true, false, "task-1")).toBe(true);
  });
});
