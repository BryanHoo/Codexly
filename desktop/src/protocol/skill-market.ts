import { Type, type Static } from "@sinclair/typebox";

export const InstalledSkillSchema = Type.Object(
  {
    description: Type.String(),
    displayName: Type.String(),
    enabled: Type.Boolean(),
    id: Type.String(),
    name: Type.String(),
    path: Type.String(),
    projectId: Type.Optional(Type.String()),
    projectName: Type.Optional(Type.String()),
    rootPath: Type.Optional(Type.String()),
    scope: Type.String(),
    source: Type.Literal("local"),
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
  {
    enabled: Type.Boolean(),
    name: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type ConfiguredMcpServer = Readonly<Static<typeof ConfiguredMcpServerSchema>>;

export const ConfiguredMcpServerPageSchema = Type.Object(
  { data: Type.Array(ConfiguredMcpServerSchema, { uniqueItems: true }) },
  { additionalProperties: false },
);
export type ConfiguredMcpServerPage = Readonly<Static<typeof ConfiguredMcpServerPageSchema>>;

export const OfficialPluginSummarySchema = Type.Object(
  {
    authPolicy: Type.Union([Type.Literal("ON_INSTALL"), Type.Literal("ON_USE")]),
    availability: Type.Union([
      Type.Literal("AVAILABLE"),
      Type.Literal("DISABLED_BY_ADMIN"),
    ]),
    description: Type.String(),
    developerName: Type.Union([Type.String(), Type.Null()]),
    disabledReason: Type.Union([Type.String(), Type.Null()]),
    displayName: Type.String(),
    enabled: Type.Boolean(),
    id: Type.String(),
    installPolicy: Type.Union([
      Type.Literal("NOT_AVAILABLE"),
      Type.Literal("AVAILABLE"),
      Type.Literal("INSTALLED_BY_DEFAULT"),
    ]),
    installed: Type.Boolean(),
    localVersion: Type.Union([Type.String(), Type.Null()]),
    logoUrl: Type.Union([Type.String(), Type.Null()]),
    marketplaceName: Type.String(),
    marketplacePath: Type.Union([Type.String(), Type.Null()]),
    name: Type.String(),
    pluginName: Type.String(),
    version: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type OfficialPluginSummary = Readonly<Static<typeof OfficialPluginSummarySchema>>;

export const OfficialPluginPageSchema = Type.Object(
  { data: Type.Array(OfficialPluginSummarySchema) },
  { additionalProperties: false },
);
export type OfficialPluginPage = Readonly<Static<typeof OfficialPluginPageSchema>>;

export const OfficialPluginAssetSchema = Type.Object(
  { description: Type.String(), name: Type.String() },
  { additionalProperties: false },
);

export const OfficialPluginAppSchema = Type.Object(
  {
    description: Type.String(),
    id: Type.String(),
    installUrl: Type.Union([Type.String(), Type.Null()]),
    name: Type.String(),
  },
  { additionalProperties: false },
);

export const OfficialPluginDetailSchema = Type.Intersect([
  OfficialPluginSummarySchema,
  Type.Object(
    {
      apps: Type.Array(OfficialPluginAppSchema),
      hooks: Type.Array(Type.String()),
      mcpServers: Type.Array(Type.String()),
      skills: Type.Array(OfficialPluginAssetSchema),
      websiteUrl: Type.Union([Type.String(), Type.Null()]),
    },
    { additionalProperties: false },
  ),
]);
export type OfficialPluginDetail = Readonly<Static<typeof OfficialPluginDetailSchema>>;

export const OfficialPluginInstallResultSchema = Type.Object(
  {
    appsNeedingAuth: Type.Array(OfficialPluginAppSchema),
    authPolicy: Type.Union([Type.Literal("ON_INSTALL"), Type.Literal("ON_USE")]),
  },
  { additionalProperties: false },
);
export type OfficialPluginInstallResult = Readonly<
  Static<typeof OfficialPluginInstallResultSchema>
>;
