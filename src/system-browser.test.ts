import { describe, expect, it, vi } from "vitest";

import { openSystemBrowser } from "./system-browser.js";

describe("openSystemBrowser", () => {
  it("uses the native browser command on Windows", async () => {
    const launch = vi.fn(() => Promise.resolve());

    await openSystemBrowser("http://127.0.0.1:3210", { launch, platform: "win32" });

    expect(launch).toHaveBeenCalledWith({
      args: ["/c", "start", "", "http://127.0.0.1:3210"],
      executable: "cmd.exe",
    });
  });

  it("falls back to gio when xdg-open is not installed", async () => {
    const launch = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("spawn xdg-open ENOENT"), { code: "ENOENT" }))
      .mockResolvedValueOnce(undefined);

    await openSystemBrowser("http://127.0.0.1:3210", { launch, platform: "linux" });

    expect(launch).toHaveBeenNthCalledWith(2, {
      args: ["open", "http://127.0.0.1:3210"],
      executable: "gio",
    });
  });

  it("falls back when an installed Linux launcher exits unsuccessfully", async () => {
    const launch = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("xdg-open exited with code 3"), { code: "LAUNCHER_EXIT" }),
      )
      .mockResolvedValueOnce(undefined);

    await openSystemBrowser("http://127.0.0.1:3210", { launch, platform: "linux" });

    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("reports missing Linux browser launchers", async () => {
    const launch = vi.fn(() =>
      Promise.reject(Object.assign(new Error("not found"), { code: "ENOENT" })),
    );

    await expect(
      openSystemBrowser("http://127.0.0.1:3210", { launch, platform: "linux" }),
    ).rejects.toThrow("No supported browser launcher is installed");
  });
});
