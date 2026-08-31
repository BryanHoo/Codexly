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

export const AppUpdateProgressPhaseSchema = Type.Union([
  Type.Literal("checking"),
  Type.Literal("backing-up"),
  Type.Literal("downloading"),
  Type.Literal("installing"),
  Type.Literal("rolling-back"),
  Type.Literal("completed"),
]);
export type AppUpdateProgressPhase = Static<typeof AppUpdateProgressPhaseSchema>;

export const AppUpdateProgressSchema = Type.Object(
  {
    percent: Type.Integer({ maximum: 100, minimum: 0 }),
    phase: AppUpdateProgressPhaseSchema,
  },
  { additionalProperties: false },
);
export type AppUpdateProgress = Readonly<Static<typeof AppUpdateProgressSchema>>;

export const AppUpdateProgressResponseSchema = Type.Object(
  { progress: Type.Union([AppUpdateProgressSchema, Type.Null()]) },
  { additionalProperties: false },
);
export type AppUpdateProgressResponse = Readonly<Static<typeof AppUpdateProgressResponseSchema>>;

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
