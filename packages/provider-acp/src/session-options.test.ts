import { it, expect } from "vitest";
import { acpModels } from "./session-options.js";
it("模型和当前思考档位来自 ACP 配置，分组选项保留顺序，不为其他模型猜测档位", () => {
  const models = acpModels([
    {
      id: "model",
      name: "模型",
      type: "select",
      category: "model",
      currentValue: "b",
      options: [
        {
          group: "g",
          name: "组",
          options: [
            { value: "a", name: "A" },
            { value: "b", name: "B" },
          ],
        },
      ],
    },
    {
      id: "effort",
      name: "思考",
      type: "select",
      category: "thought_level",
      currentValue: "high",
      options: [{ value: "high", name: "高" }],
    },
  ]);
  expect(models.data.map((m) => m.id)).toEqual(["a", "b"]);
  expect(models.data[0]?.supportedReasoningEfforts).toEqual([]);
  expect(models.data[1]).toMatchObject({
    isDefault: true,
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: [{ id: "high", description: "高" }],
  });
  expect(acpModels([])).toEqual({ data: [], nextCursor: null });
});
