import { Type, type Static } from "@sinclair/typebox";

const SemanticVersionSchema = Type.String({
  pattern:
    "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-(?:(?:0|[1-9][0-9]*)|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:(?:0|[1-9][0-9]*)|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$",
});

export const AppUpdateStatusSchema = Type.Union([
  Type.Literal("current"),
  Type.Literal("available"),
  Type.Literal("check-failed"),
  Type.Literal("connection-failed"),
]);
export type AppUpdateStatus = Static<typeof AppUpdateStatusSchema>;

export const AppInfoResponseSchema = Type.Object(
  {
    appVersion: SemanticVersionSchema,
    changelogUrl: Type.String({ maxLength: 256, pattern: "^https://github\\.com/" }),
    codexVersion: SemanticVersionSchema,
    latestVersion: Type.Union([SemanticVersionSchema, Type.Null()]),
    releaseNotes: Type.String({ maxLength: 32_768 }),
    releaseNotesVersion: SemanticVersionSchema,
    repositoryUrl: Type.String({ maxLength: 256, pattern: "^https://github\\.com/" }),
    status: AppUpdateStatusSchema,
    updateAvailable: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type AppInfoResponse = Readonly<Static<typeof AppInfoResponseSchema>>;

export type AppUpdateInstallProgress = Readonly<{
  downloadedBytes: number;
  sequence: number;
  totalBytes: number | null;
}>;
