import { afterEach, describe, expect, it, vi } from "vitest";

import { recordInternalWarning } from "./internal-diagnostics.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordInternalWarning", () => {
  it("writes structured internal failures to the console without using action toast", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    recordInternalWarning("git_status_poll_failed", new Error("fatal: transport closed"), {
      projectId: "project-1",
    });

    expect(warn).toHaveBeenCalledWith("Codexly internal warning", {
      diagnosticCode: "git_status_poll_failed",
      errorMessage: "fatal: transport closed",
      projectId: "project-1",
    });
  });

  it("uses a stable fallback for non-error rejection values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    recordInternalWarning("snapshot_recovery_failed", { privateValue: "hidden" });

    expect(warn).toHaveBeenCalledWith("Codexly internal warning", {
      diagnosticCode: "snapshot_recovery_failed",
      errorMessage: "Unknown internal error",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("privateValue");
  });
});
