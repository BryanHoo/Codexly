import { Type, type Static } from "@sinclair/typebox";

export const InstalledSkillSchema = Type.Object(
  {
    description: Type.String(),
    displayName: Type.String({ minLength: 1 }),
    enabled: Type.Boolean(),
    id: Type.String({ minLength: 1 }),
    marketplace: Type.Optional(
      Type.Object(
        {
          installedVersion: Type.String({ minLength: 1 }),
          owner: Type.String({ minLength: 1 }),
          slug: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    name: Type.String({ minLength: 1 }),
    path: Type.String({ minLength: 1 }),
    projectId: Type.Optional(Type.String({ minLength: 1 })),
    projectName: Type.Optional(Type.String({ minLength: 1 })),
    rootPath: Type.Optional(Type.String({ minLength: 1 })),
    scope: Type.Union([
      Type.Literal("user"),
      Type.Literal("repo"),
      Type.Literal("system"),
      Type.Literal("admin"),
    ]),
    source: Type.Union([Type.Literal("clawhub"), Type.Literal("local")]),
  },
  { additionalProperties: false },
);
export type InstalledSkill = Readonly<Static<typeof InstalledSkillSchema>>;

export const InstalledSkillPageSchema = Type.Object(
  { data: Type.Array(InstalledSkillSchema), nextCursor: Type.Null() },
  { additionalProperties: false },
);
export type InstalledSkillPage = Readonly<Static<typeof InstalledSkillPageSchema>>;

export const ConfiguredMcpServerSchema = Type.Object(
  { enabled: Type.Boolean(), name: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
export type ConfiguredMcpServer = Readonly<Static<typeof ConfiguredMcpServerSchema>>;

export const ConfiguredMcpServerPageSchema = Type.Object(
  { data: Type.Array(ConfiguredMcpServerSchema, { uniqueItems: true }) },
  { additionalProperties: false },
);
export type ConfiguredMcpServerPage = Readonly<Static<typeof ConfiguredMcpServerPageSchema>>;

export const ClawhubSkillSummarySchema = Type.Object(
  {
    canonicalUrl: Type.String({ minLength: 1 }),
    displayName: Type.String({ minLength: 1 }),
    downloads: Type.Integer({ minimum: 0 }),
    id: Type.String({ minLength: 1 }),
    latestVersion: Type.String({ minLength: 1 }),
    owner: Type.String({ minLength: 1 }),
    slug: Type.String({ minLength: 1 }),
    stars: Type.Integer({ minimum: 0 }),
    summary: Type.String(),
    topics: Type.Array(Type.String()),
    updatedAt: Type.Integer(),
    versionCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ClawhubSkillSummary = Readonly<Static<typeof ClawhubSkillSummarySchema>>;

export const ClawhubSkillPageSchema = Type.Object(
  {
    items: Type.Array(ClawhubSkillSummarySchema),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ClawhubSkillPage = Readonly<Static<typeof ClawhubSkillPageSchema>>;

export const ClawhubSkillVersionSchema = Type.Object(
  {
    changelog: Type.String(),
    createdAt: Type.Integer(),
    version: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const ClawhubSkillDetailSchema = Type.Object(
  {
    ...ClawhubSkillSummarySchema.properties,
    changelog: Type.String(),
    hasWarnings: Type.Boolean(),
    readme: Type.String(),
    scanStatus: Type.String({ minLength: 1 }),
    versions: Type.Array(ClawhubSkillVersionSchema),
  },
  { additionalProperties: false },
);
export type ClawhubSkillDetail = Readonly<Static<typeof ClawhubSkillDetailSchema>>;

export const SkillInstallScopeSchema = Type.Union([Type.Literal("project"), Type.Literal("user")]);
export type SkillInstallScope = Static<typeof SkillInstallScopeSchema>;

export const SkillInstallResultSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    status: Type.Union([
      Type.Literal("current"),
      Type.Literal("installed"),
      Type.Literal("updated"),
    ]),
    version: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type SkillInstallResult = Readonly<Static<typeof SkillInstallResultSchema>>;

export const SetSkillEnabledResponseSchema = Type.Object(
  { effectiveEnabled: Type.Boolean() },
  { additionalProperties: false },
);
export type SetSkillEnabledResponse = Readonly<Static<typeof SetSkillEnabledResponseSchema>>;

export const SetMcpServerEnabledResponseSchema = Type.Object(
  { enabled: Type.Boolean() },
  { additionalProperties: false },
);
export type SetMcpServerEnabledResponse = Readonly<
  Static<typeof SetMcpServerEnabledResponseSchema>
>;

export const OpenSkillDirectoryResponseSchema = Type.Object(
  { status: Type.Literal("opened") },
  { additionalProperties: false },
);
export type OpenSkillDirectoryResponse = Readonly<Static<typeof OpenSkillDirectoryResponseSchema>>;
