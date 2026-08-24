import { describe, expect, it, vi } from "vitest";

import {
  applyLanguagePreference,
  readLanguagePreference,
  resolveSupportedLanguage,
  saveLanguagePreference,
} from "./language-preference.js";

describe("language preference", () => {
  it("matches supported BCP 47 languages and falls back to Simplified Chinese", () => {
    expect(resolveSupportedLanguage(["en-US", "zh-CN"])).toBe("en");
    expect(resolveSupportedLanguage(["zh-Hans-CN"])).toBe("zh-CN");
    expect(resolveSupportedLanguage(["fr-FR"])).toBe("zh-CN");
  });

  it("reads only valid versioned preferences", () => {
    expect(readLanguagePreference({ getItem: () => '{"language":"en","version":1}' })).toBe("en");
    expect(readLanguagePreference({ getItem: () => "broken" })).toBeNull();
    expect(readLanguagePreference({ getItem: () => '{"language":"fr","version":1}' })).toBeNull();
  });

  it("persists the preference and applies the HTML language", () => {
    const setItem = vi.fn();
    const root = { lang: "" };

    saveLanguagePreference("en", { setItem });
    applyLanguagePreference("en", root);

    expect(setItem).toHaveBeenCalledWith(
      "codexly.language-preference",
      '{"language":"en","version":1}',
    );
    expect(root.lang).toBe("en");
  });
});
