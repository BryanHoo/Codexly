// 由 ACP 计划契约生成；符号元数据供原生 Node Worker 使用，回归测试防止契约漂移。
import { Kind } from "@sinclair/typebox";
export default {
  additionalProperties: false,
  type: "object",
  required: ["name", "projectId", "engine", "values", "enabled", "prompt", "schedule"],
  properties: {
    name: { minLength: 1, maxLength: 120, type: "string", [Kind]: "String" },
    projectId: { minLength: 1, maxLength: 128, type: "string", [Kind]: "String" },
    engine: {
      anyOf: [
        { const: "codex", type: "string", [Kind]: "Literal" },
        { const: "claude", type: "string", [Kind]: "Literal" },
      ],
      [Kind]: "Union",
    },
    values: {
      additionalProperties: false,
      type: "object",
      patternProperties: {
        "^[\\s\\S]{1,256}$": {
          anyOf: [
            { maxLength: 16384, type: "string", [Kind]: "String" },
            { type: "boolean", [Kind]: "Boolean" },
          ],
          [Kind]: "Union",
        },
      },
      [Kind]: "Record",
    },
    enabled: { type: "boolean", [Kind]: "Boolean" },
    prompt: {
      anyOf: [
        {
          additionalProperties: false,
          type: "object",
          required: ["attachments", "skills", "text", "type"],
          properties: {
            attachments: {
              type: "array",
              items: {
                additionalProperties: false,
                type: "object",
                required: ["id"],
                properties: { id: { minLength: 1, type: "string", [Kind]: "String" } },
                [Kind]: "Object",
              },
              [Kind]: "Array",
            },
            skills: {
              type: "array",
              items: {
                additionalProperties: false,
                type: "object",
                required: ["id", "name"],
                properties: {
                  id: { minLength: 1, type: "string", [Kind]: "String" },
                  name: { minLength: 1, type: "string", [Kind]: "String" },
                },
                [Kind]: "Object",
              },
              [Kind]: "Array",
            },
            text: { maxLength: 100000, minLength: 1, type: "string", [Kind]: "String" },
            type: { const: "prompt", type: "string", [Kind]: "Literal" },
          },
          [Kind]: "Object",
        },
        {
          additionalProperties: false,
          type: "object",
          required: ["attachments", "skills", "text", "type"],
          properties: {
            attachments: {
              minItems: 1,
              type: "array",
              items: {
                additionalProperties: false,
                type: "object",
                required: ["id"],
                properties: { id: { minLength: 1, type: "string", [Kind]: "String" } },
                [Kind]: "Object",
              },
              [Kind]: "Array",
            },
            skills: {
              type: "array",
              items: {
                additionalProperties: false,
                type: "object",
                required: ["id", "name"],
                properties: {
                  id: { minLength: 1, type: "string", [Kind]: "String" },
                  name: { minLength: 1, type: "string", [Kind]: "String" },
                },
                [Kind]: "Object",
              },
              [Kind]: "Array",
            },
            text: { maxLength: 100000, type: "string", [Kind]: "String" },
            type: { const: "prompt", type: "string", [Kind]: "Literal" },
          },
          [Kind]: "Object",
        },
        {
          additionalProperties: false,
          type: "object",
          required: ["attachments", "skills", "text", "type"],
          properties: {
            attachments: {
              type: "array",
              items: {
                additionalProperties: false,
                type: "object",
                required: ["id"],
                properties: { id: { minLength: 1, type: "string", [Kind]: "String" } },
                [Kind]: "Object",
              },
              [Kind]: "Array",
            },
            skills: {
              minItems: 1,
              type: "array",
              items: {
                additionalProperties: false,
                type: "object",
                required: ["id", "name"],
                properties: {
                  id: { minLength: 1, type: "string", [Kind]: "String" },
                  name: { minLength: 1, type: "string", [Kind]: "String" },
                },
                [Kind]: "Object",
              },
              [Kind]: "Array",
            },
            text: { maxLength: 100000, type: "string", [Kind]: "String" },
            type: { const: "prompt", type: "string", [Kind]: "Literal" },
          },
          [Kind]: "Object",
        },
      ],
      [Kind]: "Union",
    },
    schedule: {
      anyOf: [
        {
          additionalProperties: false,
          type: "object",
          required: ["type", "atUnixMs"],
          properties: {
            type: { const: "once", type: "string", [Kind]: "Literal" },
            atUnixMs: {
              minimum: -9007199254740991,
              maximum: 9007199254740991,
              type: "integer",
              [Kind]: "Integer",
            },
          },
          [Kind]: "Object",
        },
        {
          additionalProperties: false,
          type: "object",
          required: ["type", "startAtUnixMs", "rrule", "timezone"],
          properties: {
            type: { const: "rrule", type: "string", [Kind]: "Literal" },
            startAtUnixMs: {
              minimum: -9007199254740991,
              maximum: 9007199254740991,
              type: "integer",
              [Kind]: "Integer",
            },
            rrule: { minLength: 1, maxLength: 2048, type: "string", [Kind]: "String" },
            timezone: { minLength: 1, maxLength: 128, type: "string", [Kind]: "String" },
          },
          [Kind]: "Object",
        },
      ],
      [Kind]: "Union",
    },
  },
  [Kind]: "Object",
};
