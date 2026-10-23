import { expect, it, vi } from "vitest";
import {
  createReactDiagnosticHandlers,
  installGlobalDiagnostics,
} from "./application-diagnostics.js";

it("records React error details and removes global listeners on cleanup", () => {
  const record = vi.fn();
  const target = new EventTarget() as Window;
  const cleanup = installGlobalDiagnostics(target, record);
  createReactDiagnosticHandlers(record).onUncaughtError(new Error("render failed"), {
    componentStack: "at Workbench",
  });
  expect(record).toHaveBeenLastCalledWith(
    expect.objectContaining({
      event: "react_error_uncaught",
      errorMessage: "render failed",
      stack: "at Workbench",
      context: {},
    }),
  );
  target.dispatchEvent(Object.assign(new Event("error"), { error: new Error("window failed") }));
  target.dispatchEvent(
    Object.assign(new Event("unhandledrejection"), { reason: "promise failed" }),
  );
  expect(record).toHaveBeenCalledTimes(3);
  cleanup();
  target.dispatchEvent(Object.assign(new Event("error"), { message: "ignored" }));
  expect(record).toHaveBeenCalledTimes(3);
});
