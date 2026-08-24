import { Type, type Static } from "@sinclair/typebox";

const SemanticVersionSchema = Type.String({
  pattern:
    "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-(?:(?:0|[1-9][0-9]*)|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:(?:0|[1-9][0-9]*)|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$",
});

export const AppUpdateStatusSchema = Type.Union([
  Type.Literal("current"),
  Type.Literal("available"),
  Type.Literal("restart-required"),
  Type.Literal("check-failed"),
]);
export type AppUpdateStatus = Static<typeof AppUpdateStatusSchema>;

export const AppInfoResponseSchema = Type.Object(
  {
    appVersion: SemanticVersionSchema,
    codexVersion: SemanticVersionSchema,
    latestVersion: Type.Union([SemanticVersionSchema, Type.Null()]),
    releaseNotes: Type.Union([Type.String({ maxLength: 32_768 }), Type.Null()]),
    status: AppUpdateStatusSchema,
    updateAvailable: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type AppInfoResponse = Readonly<Static<typeof AppInfoResponseSchema>>;

export const InstallAppUpdateRequestSchema = Type.Object(
  { version: SemanticVersionSchema },
  { additionalProperties: false },
);
export type InstallAppUpdateRequest = Readonly<Static<typeof InstallAppUpdateRequestSchema>>;

export const InstallAppUpdateResponseSchema = Type.Object(
  {
    appVersion: SemanticVersionSchema,
    codexVersion: SemanticVersionSchema,
    latestVersion: SemanticVersionSchema,
    releaseNotes: Type.Null(),
    status: Type.Literal("restart-required"),
    updateAvailable: Type.Literal(false),
  },
  { additionalProperties: false },
);
export type InstallAppUpdateResponse = Readonly<Static<typeof InstallAppUpdateResponseSchema>>;
