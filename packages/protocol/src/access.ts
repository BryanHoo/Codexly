import { Type, type Static } from "@sinclair/typebox";

export const AccessModeSchema = Type.Union([Type.Literal("local"), Type.Literal("lan")]);
export type AccessMode = Static<typeof AccessModeSchema>;

export const AccessStatusResponseSchema = Type.Object(
  {
    authenticated: Type.Boolean(),
    mode: AccessModeSchema,
    version: Type.Literal(1),
  },
  { additionalProperties: false },
);
export type AccessStatusResponse = Readonly<Static<typeof AccessStatusResponseSchema>>;

export const PairAccessRequestSchema = Type.Object(
  { code: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
export type PairAccessRequest = Readonly<Static<typeof PairAccessRequestSchema>>;

export const PairAccessResponseSchema = AccessStatusResponseSchema;
export type PairAccessResponse = AccessStatusResponse;

export const LogoutAccessResponseSchema = AccessStatusResponseSchema;
export type LogoutAccessResponse = AccessStatusResponse;
