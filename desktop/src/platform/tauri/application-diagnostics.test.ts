import { describe, expect, it, vi } from "vitest";

import { createReactDiagnosticHandlers } from "./application-diagnostics.js";

describe("application diagnostics", () => {
  it("records React errors without adding application data", () => {
    const record = vi.fn();
    const handlers = createReactDiagnosticHandlers(record);
    const error = new Error("render failed");

    handlers.onUncaughtError?.(error, { componentStack: "at Workbench" });

    expect(record).toHaveBeenCalledWith({
      context: {},
      errorMessage: "render failed",
      event: "react_error_uncaught",
      level: "error",
      stack: "at Workbench",
    });
  });

  it("normalizes non-error recoverable failures", () => {
    const record = vi.fn();
    const handlers = createReactDiagnosticHandlers(record);

    handlers.onRecoverableError?.("hydration failed", { componentStack: "" });

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: "hydration failed",
        event: "react_error_recoverable",
        stack: "",
      }),
    );
  });
});
