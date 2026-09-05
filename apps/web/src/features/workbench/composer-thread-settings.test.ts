import { expect, test } from "vitest";
import type { AgentTaskSettings } from "@codexly/protocol";
import { resolveThreadComposerSettings } from "./composer-state.js";

const settings: AgentTaskSettings = {
  model: "default-model",
  reasoningEffort: "low",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandboxMode: "read-only",
};

test("restores only model settings without mutating task defaults or permissions", () => {
  const result = resolveThreadComposerSettings(settings, {
    model: "thread-model",
    reasoningEffort: "high",
  });
  expect(result).toEqual({ ...settings, model: "thread-model", reasoningEffort: "high" });
  expect(settings.model).toBe("default-model");
  expect(settings.reasoningEffort).toBe("low");
});

test.each([
  undefined,
  { model: null, reasoningEffort: null },
  { model: "default-model", reasoningEffort: "low" },
])("retains the settings reference when restoration changes nothing (%j)", (configuration) => {
  expect(resolveThreadComposerSettings(settings, configuration)).toBe(settings);
});

test("falls back independently for missing thread fields", () => {
  expect(
    resolveThreadComposerSettings(settings, { model: "thread-model", reasoningEffort: null }),
  ).toEqual({ ...settings, model: "thread-model" });
  expect(resolveThreadComposerSettings(settings, { model: null, reasoningEffort: "high" })).toEqual(
    { ...settings, reasoningEffort: "high" },
  );
});
