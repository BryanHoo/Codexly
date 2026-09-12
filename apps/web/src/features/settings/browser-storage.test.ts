import { afterEach, expect, it, vi } from "vitest";

import { getSafeLocalStorage } from "../../shared/lib/browser-storage.js";
import { readInitialTheme } from "./components/global-settings-model.js";
import {
  applyWorkbenchBackgroundPreference,
  DEFAULT_WORKBENCH_BACKGROUND,
  readWorkbenchBackgroundPreference,
  WORKBENCH_BACKGROUND_CHANGED_EVENT,
} from "./workbench-background-preference.js";
import {
  DEFAULT_PET_POSITION,
  readPetPositionPreference,
  writePetPositionPreference,
} from "../pets/pet-position-preference.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("returns the available storage without changing persistence", () => {
  const storage = { getItem: vi.fn(), setItem: vi.fn() };
  vi.stubGlobal("window", { localStorage: storage });
  expect(getSafeLocalStorage()).toBe(storage);
});

it("provides empty storage outside the browser", () => {
  vi.stubGlobal("window", undefined);
  expect(getSafeLocalStorage().getItem("preference")).toBeNull();
  expect(() => {
    getSafeLocalStorage().setItem("preference", "value");
  }).not.toThrow();
});

it.each(["getter", "methods"])(
  "keeps preferences usable when storage %s throw",
  async (failure) => {
    const denied = (): never => {
      throw new DOMException("Storage is blocked", "SecurityError");
    };
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      get localStorage() {
        return failure === "getter" ? denied() : { getItem: denied, setItem: denied };
      },
      dispatchEvent,
    });

    expect(readInitialTheme()).toBe("system");
    expect(readWorkbenchBackgroundPreference(getSafeLocalStorage())).toEqual(
      DEFAULT_WORKBENCH_BACKGROUND,
    );
    expect(readPetPositionPreference(getSafeLocalStorage())).toEqual(DEFAULT_PET_POSITION);
    expect(() => {
      writePetPositionPreference(getSafeLocalStorage(), DEFAULT_PET_POSITION);
    }).not.toThrow();
    const preference = { ...DEFAULT_WORKBENCH_BACKGROUND, mode: "bing" as const };
    await applyWorkbenchBackgroundPreference(preference, { deletedImageIds: [], imagesToSave: [] });
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WORKBENCH_BACKGROUND_CHANGED_EVENT,
        detail: preference,
      }),
    );
  },
);
