import { ApplicationPreferencesService, generateApplicationText } from "@codexly/core";
import type { ApplicationGenerationRequest } from "@codexly/protocol/application-generation";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { originalErrorMessage } from "../error-message.js";

/** undefined 仅代表旧运行时；ACP 配置或执行失败必须直接交付错误。 */
export async function generateAcpApplicationText(
  context: ServerRouteContext,
  cwd: string,
  request: ApplicationGenerationRequest,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (context.capabilities.runtime !== "acp") return undefined;
  if (!context.localCatalogStore || !context.provider.generateText)
    throw new MutationHttpError("PROVIDER_ERROR", "ACP generation is unavailable", 503);
  const generate = context.provider.generateText.bind(context.provider);
  try {
    const preferences = await new ApplicationPreferencesService(context.localCatalogStore, () =>
      context.settingsRepository.readGlobalSettings(),
    ).read();
    return await generateApplicationText(preferences, cwd, request, signal, generate);
  } catch (error) {
    throw new MutationHttpError(
      "PROVIDER_ERROR",
      originalErrorMessage(error, "ACP generation failed"),
      502,
    );
  }
}
