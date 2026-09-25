import { Type, type Static } from "@sinclair/typebox";

const NullableStringSchema = Type.Union([Type.String(), Type.Null()]);
const NullableNumberSchema = Type.Union([Type.Number(), Type.Null()]);

const McpElicitationFieldProperties = {
  description: NullableStringSchema,
  id: Type.String({ minLength: 1 }),
  required: Type.Boolean(),
  title: Type.String({ minLength: 1 }),
};

export const McpElicitationOptionSchema = Type.Object(
  {
    label: Type.String({ minLength: 1 }),
    value: Type.String(),
  },
  { additionalProperties: false },
);

export const McpElicitationFieldSchema = Type.Union([
  Type.Object(
    {
      ...McpElicitationFieldProperties,
      defaultValue: Type.Union([Type.String(), Type.Null()]),
      format: Type.Union([
        Type.Literal("email"),
        Type.Literal("uri"),
        Type.Literal("date"),
        Type.Literal("date-time"),
        Type.Null(),
      ]),
      maxLength: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      minLength: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      type: Type.Literal("string"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...McpElicitationFieldProperties,
      defaultValue: Type.Union([Type.String(), Type.Null()]),
      options: Type.Array(McpElicitationOptionSchema, { minItems: 1 }),
      type: Type.Literal("select"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...McpElicitationFieldProperties,
      defaultValue: Type.Array(Type.String()),
      maximum: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      minimum: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      options: Type.Array(McpElicitationOptionSchema, { minItems: 1 }),
      type: Type.Literal("multi_select"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...McpElicitationFieldProperties,
      defaultValue: NullableNumberSchema,
      maximum: NullableNumberSchema,
      minimum: NullableNumberSchema,
      type: Type.Union([Type.Literal("number"), Type.Literal("integer")]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...McpElicitationFieldProperties,
      defaultValue: Type.Union([Type.Boolean(), Type.Null()]),
      type: Type.Literal("boolean"),
    },
    { additionalProperties: false },
  ),
]);

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
