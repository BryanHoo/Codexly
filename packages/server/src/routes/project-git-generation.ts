import { readGenerationDefaults } from "@codexly/core";
import type { AgentProvider } from "@codexly/core";
import type { GenerateCommitMessageRequest, ProjectGitStatus } from "@codexly/protocol";
import { buildCommitMessageContext } from "../git-commit-message.js";
import { generateAcpApplicationText } from "./acp-application-generation.js";
import { MutationHttpError, type ServerRouteContext } from "./context.js";

export async function generateProjectCommitMessage(
  context: ServerRouteContext,
  provider: AgentProvider,
  rootPath: string,
  status: ProjectGitStatus,
  request: GenerateCommitMessageRequest,
  signal: AbortSignal,
): Promise<string> {
  // 根目录与快照已由 Git 路由授权；请求中的旧 engine 不参与 ACP 引擎选择。
  const acp = await generateAcpApplicationText(
    context,
    rootPath,
    { purpose: "commit", text: buildCommitMessageContext(status, request) },
    signal,
  );
  if (acp !== undefined) return acp;
  const stored = await context.settingsRepository.readGlobalSettings();
  const generation = await readGenerationDefaults(context.provider, stored);
  const prompt = context.buildCommitMessagePrompt(
    status,
    request,
    stored?.commitMessagePrompt ?? "",
  );
  if (generation.defaultAgent === "claude") {
    const service = context.provider.engines?.claude;
    if (!service?.generateCommitMessage)
      throw new MutationHttpError("PROVIDER_ERROR", "Claude engine is unavailable", 503);
    return service.generateCommitMessage(prompt, generation.defaultModel);
  }
  return context.generateCommitMessageWithCodex(provider, prompt, {
    approvalPolicy: "never",
    approvalsReviewer: "user",
    model: generation.defaultModel,
    reasoningEffort: "",
    sandboxMode: "read-only",
  });
}
