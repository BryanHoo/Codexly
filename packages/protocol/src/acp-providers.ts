import { Type, type Static } from "@sinclair/typebox";

const Id = Type.String({ minLength: 1, maxLength: 256 });
export const AcpProviderConfigSchema = Type.Object(
  {
    providerId: Id,
    apiType: Id,
    baseUrl: Type.String({ minLength: 1, maxLength: 16384 }),
    headers: Type.Optional(
      Type.Record(Type.String(), Type.String({ maxLength: 16384 }), { maxProperties: 128 }),
    ),
  },
  { additionalProperties: false },
);
/** 公开状态明确排除 headers 与扩展元数据，凭据只在私有记录及 ACP 请求中使用。 */
export const AcpProviderPageSchema = Type.Object(
  {
    providers: Type.Array(
      Type.Object(
        {
          providerId: Id,
          supported: Type.Array(Id),
          required: Type.Boolean(),
          current: Type.Optional(
            Type.Union([Type.Object({ apiType: Id, baseUrl: Type.String() }), Type.Null()]),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    restartRequired: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type AcpProviderConfig = Static<typeof AcpProviderConfigSchema>;
export type AcpProviderPage = Static<typeof AcpProviderPageSchema>;
