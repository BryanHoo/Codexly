import { Type, type Static } from "@sinclair/typebox";
import { AgentEngineSchema, ClaudeSettingsSchema } from "./agent-engine.js";
import { AgentCapabilitiesSchema, AgentModelPageSchema } from "./agent-runtime.js";
import {
  ConfigureCustomProviderRequestSchema,
  AgentProviderConnectionStatusSchema,
} from "./provider-connection.js";

export const AgentCommandSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    description: Type.String(),
    argumentHint: Type.String(),
  },
  { additionalProperties: false },
);
export type AgentCommand = Static<typeof AgentCommandSchema>;

export const AgentEngineProfileSchema = Type.Object(
  {
    engine: AgentEngineSchema,
    authType: ConfigureCustomProviderRequestSchema.properties.authType,
    configuredModels: ConfigureCustomProviderRequestSchema.properties.models,
    settings: Type.Optional(ClaudeSettingsSchema),
    capabilities: AgentCapabilitiesSchema,
    models: AgentModelPageSchema,
    commands: Type.Array(AgentCommandSchema),
    connection: AgentProviderConnectionStatusSchema,
  },
  { additionalProperties: false },
);
export type AgentEngineProfile = Static<typeof AgentEngineProfileSchema>;
