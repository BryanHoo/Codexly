import { expect, it } from "vitest";
import { modelPage } from "./app-all.test-support.js";
import { resolveGlobalSettings } from "./global-settings-reader.js";

it("keeps application generation defaults independent from the conversation model catalog", () => {
  const settings = resolveGlobalSettings(modelPage.data, undefined, {
    model: "conversation-model",
  });
  expect(settings).toMatchObject({ defaultAgent: "codex" as const, defaultModel: "gpt-6-luna" });
});

it("defaults to Claude Haiku when only Claude is configured", () => {
  const settings = resolveGlobalSettings(modelPage.data, undefined, {}, ["claude"]);
  expect(settings).toMatchObject({ defaultAgent: "claude", defaultModel: "haiku" });
});
