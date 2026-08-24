import { Type, type Static } from "@sinclair/typebox";

import { AgentModelPageSchema } from "./agent-runtime.js";
import { DateTimeSchema } from "./project-files.js";

export const AgentProviderModeSchema = Type.Union([
  Type.Literal("official"),
  Type.Literal("custom"),
]);

export const AgentProviderConnectionStateSchema = Type.Union([
  Type.Literal("disconnected"),
  Type.Literal("pending"),
  Type.Literal("connected"),
  Type.Literal("failed"),
]);

export const AgentProviderAccountSchema = Type.Union([
  Type.Object(
    {
      email: Type.Union([Type.String({ maxLength: 320 }), Type.Null()]),
      planType: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
      type: Type.Literal("chatgpt"),
    },
    { additionalProperties: false },
  ),
  Type.Object({ type: Type.Literal("apiKey") }, { additionalProperties: false }),
]);

export const AgentProviderPendingLoginSchema = Type.Object(
  {
    error: Type.Union([Type.String({ maxLength: 1_000 }), Type.Null()]),
    loginId: Type.String({ maxLength: 256, minLength: 1 }),
    state: Type.Union([Type.Literal("pending"), Type.Literal("failed")]),
  },
  { additionalProperties: false },
);

export const AgentProviderConnectionStatusSchema = Type.Object(
  {
    account: Type.Union([AgentProviderAccountSchema, Type.Null()]),
    customBaseUrl: Type.Union([Type.String({ maxLength: 2_048, minLength: 1 }), Type.Null()]),
    mode: AgentProviderModeSchema,
    pendingLogin: Type.Union([AgentProviderPendingLoginSchema, Type.Null()]),
    state: AgentProviderConnectionStateSchema,
  },
  { additionalProperties: false },
);

export const StartOfficialProviderLoginRequestSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const StartOfficialProviderLoginResponseSchema = Type.Object(
  {
    authUrl: Type.String({ maxLength: 8_192, minLength: 1 }),
    loginId: Type.String({ maxLength: 256, minLength: 1 }),
    status: AgentProviderConnectionStatusSchema,
  },
  { additionalProperties: false },
);

export const ConfigureCustomProviderRequestSchema = Type.Object(
  {
    apiKey: Type.Optional(Type.String({ maxLength: 16_384, minLength: 1 })),
    baseUrl: Type.String({ maxLength: 2_048, minLength: 1 }),
    models: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: Type.String({ maxLength: 256, minLength: 1, pattern: ".*\\S.*" }),
            name: Type.String({ maxLength: 256, minLength: 1, pattern: ".*\\S.*" }),
          },
          { additionalProperties: false },
        ),
        { maxItems: 1_000 },
      ),
    ),
  },
  { additionalProperties: false },
);

export const ConfigureCustomProviderResponseSchema = Type.Object(
  {
    models: AgentModelPageSchema,
    status: AgentProviderConnectionStatusSchema,
  },
  { additionalProperties: false },
);

export const CancelProviderLoginRequestSchema = Type.Object(
  { loginId: Type.String({ maxLength: 256, minLength: 1 }) },
  { additionalProperties: false },
);

export const AgentProviderConnectionMutationResponseSchema = Type.Object(
  { status: AgentProviderConnectionStatusSchema },
  { additionalProperties: false },
);

export const AgentProviderConnectionRecordSchema = Type.Object(
  {
    customBaseUrl: Type.Union([Type.String({ maxLength: 2_048, minLength: 1 }), Type.Null()]),
    customModels: Type.Union([AgentModelPageSchema, Type.Null()]),
    mode: AgentProviderModeSchema,
    updatedAt: DateTimeSchema,
  },
  { additionalProperties: false },
);

export type AgentProviderMode = Readonly<Static<typeof AgentProviderModeSchema>>;
export type AgentProviderConnectionState = Readonly<
  Static<typeof AgentProviderConnectionStateSchema>
>;
export type AgentProviderAccount = Readonly<Static<typeof AgentProviderAccountSchema>>;
export type AgentProviderPendingLogin = Readonly<Static<typeof AgentProviderPendingLoginSchema>>;
export type AgentProviderConnectionStatus = Readonly<
  Static<typeof AgentProviderConnectionStatusSchema>
>;
export type StartOfficialProviderLoginRequest = Readonly<
  Static<typeof StartOfficialProviderLoginRequestSchema>
>;
export type StartOfficialProviderLoginResponse = Readonly<
  Static<typeof StartOfficialProviderLoginResponseSchema>
>;
export type ConfigureCustomProviderRequest = Readonly<
  Static<typeof ConfigureCustomProviderRequestSchema>
>;
export type ConfigureCustomProviderResponse = Readonly<
  Static<typeof ConfigureCustomProviderResponseSchema>
>;
export type CancelProviderLoginRequest = Readonly<Static<typeof CancelProviderLoginRequestSchema>>;
export type AgentProviderConnectionMutationResponse = Readonly<
  Static<typeof AgentProviderConnectionMutationResponseSchema>
>;
export type AgentProviderConnectionRecord = Readonly<
  Static<typeof AgentProviderConnectionRecordSchema>
>;

export function isAgentFastModeAvailable(status: AgentProviderConnectionStatus): boolean {
  return (
    status.mode === "official" && status.state === "connected" && status.account?.type === "chatgpt"
  );
}
