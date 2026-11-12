import { expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { ApplicationPreferencesPatchSchema } from "./application-preferences.js";
import { ApplicationPreferencesSchema } from "./application-preferences.js";
import workerSchema from "./application-preferences-schema.js";
it("应用偏好保留原始模型和 null，拒绝缺失宠物身份、未知字段及未配对修改", () => {
  for (const value of [
    { defaultAgent: "claude", defaultModel: "raw/model" },
    { defaultAgent: "codex", defaultModel: null },
    { pet: { enabled: false, selectedPetId: null } },
  ])
    expect(Value.Check(ApplicationPreferencesPatchSchema, value)).toBe(true);
  for (const value of [
    {},
    { defaultModel: "x" },
    { defaultAgent: "claude" },
    { model: "x" },
    { pet: { enabled: true, selectedPetId: null } },
  ])
    expect(Value.Check(ApplicationPreferencesPatchSchema, value)).toBe(false);
});
it("Node Worker 校验与公开 Schema 完全一致", () => {
  expect(workerSchema).toEqual(ApplicationPreferencesSchema);
});
