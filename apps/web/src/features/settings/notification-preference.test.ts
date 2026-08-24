import { describe, expect, it, vi } from "vitest";

import {
  readNotificationPreference,
  saveNotificationPreference,
} from "./notification-preference.js";

describe("notification preference", () => {
  it("defaults to enabled and reads only valid versioned preferences", () => {
    expect(readNotificationPreference({ getItem: () => null })).toBe(true);
    expect(
      readNotificationPreference({
        getItem: () => '{"enabled":false,"version":1}',
      }),
    ).toBe(false);
    expect(readNotificationPreference({ getItem: () => "broken" })).toBe(true);
  });

  it("persists the selected preference", () => {
    const setItem = vi.fn();

    saveNotificationPreference(false, { setItem });

    expect(setItem).toHaveBeenCalledWith(
      "codexly.notification-preference",
      '{"enabled":false,"version":1}',
    );
  });
});
