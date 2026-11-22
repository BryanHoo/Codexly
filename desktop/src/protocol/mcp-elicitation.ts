import { Type, type Static } from "@sinclair/typebox";

import { McpElicitationFieldSchema } from "@codexly/protocol";

export { McpElicitationFieldSchema, McpElicitationOptionSchema } from "@codexly/protocol";

export const McpElicitationAcceptContentSchema = Type.Record(
  Type.String(),
  Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Array(Type.String())]),
);

const McpElicitationDismissResolutionSchema = Type.Object(
  { action: Type.Union([Type.Literal("decline"), Type.Literal("cancel")]) },
  { additionalProperties: false },
);

export const McpFormElicitationResolutionSchema = Type.Union([
  Type.Object(
    { action: Type.Literal("accept"), content: McpElicitationAcceptContentSchema },
    { additionalProperties: false },
  ),
  McpElicitationDismissResolutionSchema,
]);

export const McpUrlElicitationResolutionSchema = Type.Union([
  Type.Object({ action: Type.Literal("accept") }, { additionalProperties: false }),
  McpElicitationDismissResolutionSchema,
]);

export const McpElicitationResolutionSchema = Type.Union([
  McpFormElicitationResolutionSchema,
  McpUrlElicitationResolutionSchema,
]);

export type McpElicitationField = Readonly<Static<typeof McpElicitationFieldSchema>>;
export type McpFormElicitationResolution = Readonly<
  Static<typeof McpFormElicitationResolutionSchema>
>;
export type McpUrlElicitationResolution = Readonly<
  Static<typeof McpUrlElicitationResolutionSchema>
>;
export type McpElicitationResolution = Readonly<Static<typeof McpElicitationResolutionSchema>>;
