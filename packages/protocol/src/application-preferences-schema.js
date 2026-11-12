// 由 应用偏好契约生成；符号元数据供原生 Node Worker 使用，回归测试防止契约漂移。
import { Kind } from "@sinclair/typebox";
export default {
  additionalProperties: false,
  type: "object",
  required: [
    "defaultAgent",
    "defaultModel",
    "commitMessagePrompt",
    "taskTitlePrompt",
    "promptOptimizationPrompt",
    "defaultOpenAppId",
    "followUpBehavior",
    "pet",
  ],
  properties: {
    defaultAgent: {
      anyOf: [
        { const: "codex", type: "string", [Kind]: "Literal" },
        { const: "claude", type: "string", [Kind]: "Literal" },
      ],
      [Kind]: "Union",
    },
    defaultModel: {
      anyOf: [
        { minLength: 1, maxLength: 16384, type: "string", [Kind]: "String" },
        { type: "null", [Kind]: "Null" },
      ],
      [Kind]: "Union",
    },
    commitMessagePrompt: { maxLength: 4000, type: "string", [Kind]: "String" },
    taskTitlePrompt: { maxLength: 4000, type: "string", [Kind]: "String" },
    promptOptimizationPrompt: { maxLength: 4000, type: "string", [Kind]: "String" },
    defaultOpenAppId: {
      anyOf: [
        {
          anyOf: [
            { const: "visual-studio-code", type: "string", [Kind]: "Literal" },
            { const: "zed", type: "string", [Kind]: "Literal" },
            { const: "windsurf", type: "string", [Kind]: "Literal" },
            { const: "finder", type: "string", [Kind]: "Literal" },
            { const: "terminal", type: "string", [Kind]: "Literal" },
            { const: "ghostty", type: "string", [Kind]: "Literal" },
            { const: "xcode", type: "string", [Kind]: "Literal" },
            { const: "android-studio", type: "string", [Kind]: "Literal" },
            { const: "file-manager", type: "string", [Kind]: "Literal" },
            { const: "gnome-terminal", type: "string", [Kind]: "Literal" },
            { const: "konsole", type: "string", [Kind]: "Literal" },
            { const: "xfce-terminal", type: "string", [Kind]: "Literal" },
            { const: "explorer", type: "string", [Kind]: "Literal" },
            { const: "windows-terminal", type: "string", [Kind]: "Literal" },
            { const: "command-prompt", type: "string", [Kind]: "Literal" },
          ],
          [Kind]: "Union",
        },
        { const: "iterm2", type: "string", [Kind]: "Literal" },
        { type: "null", [Kind]: "Null" },
      ],
      [Kind]: "Union",
    },
    followUpBehavior: {
      anyOf: [
        { const: "queue", type: "string", [Kind]: "Literal" },
        { const: "steer", type: "string", [Kind]: "Literal" },
      ],
      [Kind]: "Union",
    },
    pet: {
      anyOf: [
        {
          additionalProperties: false,
          type: "object",
          required: ["enabled", "selectedPetId"],
          properties: {
            enabled: { const: false, type: "boolean", [Kind]: "Literal" },
            selectedPetId: {
              anyOf: [
                { maxLength: 16384, type: "string", [Kind]: "String" },
                { type: "null", [Kind]: "Null" },
              ],
              [Kind]: "Union",
            },
          },
          [Kind]: "Object",
        },
        {
          additionalProperties: false,
          type: "object",
          required: ["enabled", "selectedPetId"],
          properties: {
            enabled: { const: true, type: "boolean", [Kind]: "Literal" },
            selectedPetId: { minLength: 1, maxLength: 16384, type: "string", [Kind]: "String" },
          },
          [Kind]: "Object",
        },
      ],
      [Kind]: "Union",
    },
  },
  [Kind]: "Object",
};
