import { Type, type Static } from "@sinclair/typebox";

export const PluginReconcileResultSchema = Type.Object(
  {
    changedPlugins: Type.Array(
      Type.Object(
        {
          id: Type.String({ minLength: 1 }),
          hasApps: Type.Boolean(),
          hasHooks: Type.Boolean(),
          hasMcps: Type.Boolean(),
          hasSkills: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
    failedRemotePluginIds: Type.Array(Type.String()),
    failedMaterializationRemotePluginIds: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

// 仅表示本次同步观察到的变化，不代表运行时已经就绪，也不作为累计变更缓存。
export type PluginReconcileResult = Readonly<Static<typeof PluginReconcileResultSchema>>;
