import { expect, it } from "vitest";
import { acpConfigLabel, acpConfigDescription } from "./acp-config-labels.js";
it("中文设置翻译已知文案，英文和模型标识保持原样", () => {
  expect(acpConfigLabel("Reasoning effort", "zh-CN")).toBe("推理强度");
  expect(acpConfigLabel("High", "zh-CN")).toBe("高");
  expect(acpConfigLabel("High", "en")).toBe("High");
  expect(acpConfigLabel("GPT-5.6", "zh-CN")).toBe("GPT-5.6");
  expect(acpConfigDescription("An unrecognized dynamic description", "zh-CN")).toBeUndefined();
});
