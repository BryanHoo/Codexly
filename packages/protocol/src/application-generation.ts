import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/** 交付层授权工作目录并读取偏好；调用方只能提交用途与有界素材。 */
export const ApplicationGenerationRequestSchema = Type.Union([
  Type.Object(
    {
      purpose: Type.Union([Type.Literal("title"), Type.Literal("optimize")]),
      text: Type.String({ minLength: 1, maxLength: 32_000, pattern: "\\S" }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      purpose: Type.Literal("commit"),
      text: Type.String({ minLength: 1, maxLength: 524_288, pattern: "\\S" }),
    },
    { additionalProperties: false },
  ),
]);
export type ApplicationGenerationRequest = Static<typeof ApplicationGenerationRequestSchema>;
export const isApplicationGenerationRequest = (
  value: unknown,
): value is ApplicationGenerationRequest => Value.Check(ApplicationGenerationRequestSchema, value);
