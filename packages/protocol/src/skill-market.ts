import { Type, type Static } from "@sinclair/typebox";

export const InstalledSkillSchema = Type.Object(
  {
    description: Type.String(),
    displayName: Type.String({ minLength: 1 }),
    enabled: Type.Boolean(),
    id: Type.String({ minLength: 1 }),
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
    mutable: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type ConfiguredMcpServer = Readonly<Static<typeof ConfiguredMcpServerSchema>>;

export const ConfiguredMcpServerPageSchema = Type.Object(
  { data: Type.Array(ConfiguredMcpServerSchema, { uniqueItems: true }) },
  { additionalProperties: false },
);
export type ConfiguredMcpServerPage = Readonly<Static<typeof ConfiguredMcpServerPageSchema>>;

const SetSkillEnabledResultProperties = { effectiveEnabled: Type.Boolean() };
export const SetSkillEnabledResultSchema = Type.Object(SetSkillEnabledResultProperties, {
  additionalProperties: false,
});
export type SetSkillEnabledResult = Readonly<Static<typeof SetSkillEnabledResultSchema>>;
export const SetSkillEnabledResponseSchema = Type.Object(
  { ...SetSkillEnabledResultProperties, installedSkills: InstalledSkillPageSchema },
  { additionalProperties: false },
);
export type SetSkillEnabledResponse = Readonly<Static<typeof SetSkillEnabledResponseSchema>>;

const SetMcpServerEnabledResultProperties = { enabled: Type.Boolean() };
export const SetMcpServerEnabledResultSchema = Type.Object(SetMcpServerEnabledResultProperties, {
  additionalProperties: false,
});
export type SetMcpServerEnabledResult = Readonly<Static<typeof SetMcpServerEnabledResultSchema>>;
export const SetMcpServerEnabledResponseSchema = Type.Object(
  { ...SetMcpServerEnabledResultProperties, servers: ConfiguredMcpServerPageSchema },
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

export const OfficialPluginAuthPolicySchema = Type.Union([
  Type.Literal("ON_INSTALL"),
  Type.Literal("ON_USE"),
]);

export const OfficialPluginSummarySchema = Type.Object(
  {
    authPolicy: OfficialPluginAuthPolicySchema,
    availability: Type.Union([Type.Literal("AVAILABLE"), Type.Literal("DISABLED_BY_ADMIN")]),
    description: Type.String(),
    developerName: Type.Union([Type.String(), Type.Null()]),
    disabledReason: Type.Union([Type.String(), Type.Null()]),
    displayName: Type.String({ minLength: 1 }),
    enabled: Type.Boolean(),
    id: Type.String({ minLength: 1 }),
    installPolicy: Type.Union([
      Type.Literal("NOT_AVAILABLE"),
      Type.Literal("AVAILABLE"),
      Type.Literal("INSTALLED_BY_DEFAULT"),
    ]),
    installed: Type.Boolean(),
    localVersion: Type.Union([Type.String(), Type.Null()]),
    logoUrl: Type.Union([Type.String(), Type.Null()]),
    marketplaceName: Type.String({ minLength: 1 }),
    marketplacePath: Type.Union([Type.String(), Type.Null()]),
    name: Type.String({ minLength: 1 }),
    pluginName: Type.String({ minLength: 1 }),
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
  { description: Type.String(), name: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

export const OfficialPluginAppSchema = Type.Object(
  {
    description: Type.String(),
    id: Type.String({ minLength: 1 }),
    installUrl: Type.Union([Type.String(), Type.Null()]),
    name: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type OfficialPluginApp = Readonly<Static<typeof OfficialPluginAppSchema>>;

export const OfficialPluginDetailSchema = Type.Object(
  {
    ...OfficialPluginSummarySchema.properties,
    apps: Type.Array(OfficialPluginAppSchema),
    hooks: Type.Array(Type.String()),
    mcpServers: Type.Array(Type.String()),
    skills: Type.Array(OfficialPluginAssetSchema),
    websiteUrl: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type OfficialPluginDetail = Readonly<Static<typeof OfficialPluginDetailSchema>>;

export const OfficialPluginInstallResultSchema = Type.Object(
  {
    appsNeedingAuth: Type.Array(OfficialPluginAppSchema),
    authPolicy: OfficialPluginAuthPolicySchema,
  },
  { additionalProperties: false },
);
export type OfficialPluginInstallResult = Readonly<
  Static<typeof OfficialPluginInstallResultSchema>
>;
export const OfficialPluginInstallResponseSchema = Type.Object(
  { ...OfficialPluginInstallResultSchema.properties, plugins: OfficialPluginPageSchema },
  { additionalProperties: false },
);
export type OfficialPluginInstallResponse = Readonly<
  Static<typeof OfficialPluginInstallResponseSchema>
>;

export const OfficialPluginUninstallResultSchema = Type.Object({}, { additionalProperties: false });
export type OfficialPluginUninstallResult = Readonly<
  Static<typeof OfficialPluginUninstallResultSchema>
>;
export const OfficialPluginUninstallResponseSchema = Type.Object(
  { plugins: OfficialPluginPageSchema },
  { additionalProperties: false },
);
export type OfficialPluginUninstallResponse = Readonly<
  Static<typeof OfficialPluginUninstallResponseSchema>
>;

export * from "./plugin-reconcile.js";
