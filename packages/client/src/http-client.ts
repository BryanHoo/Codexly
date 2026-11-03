import { OptimizePromptResponseSchema } from "@codexly/protocol";
import {
  SavedPromptsSchema,
  type SavedPromptsRequest,
  type SharedSavedPrompt,
} from "@codexly/protocol";
import {
  DiagnosticsResponseSchema,
  SaveDiagnosticsResponseSchema,
  type DiagnosticsResponse,
  type SaveDiagnosticsRequest,
  type SaveDiagnosticsResponse,
} from "@codexly/protocol";
import type { ReadOptions } from "./http-client-options.js";
export { buildProjectPdfFileUrl } from "./project-pdf-url.js";
export {
  CodexlyHttpError,
  CodexlyMutationError,
  CodexlyResponseError,
  buildProjectAttachmentUrl,
  buildProjectFileDownloadUrl,
  buildProjectImageFileUrl,
  buildTaskAttachmentUrl,
  buildWorkbenchPetAssetUrl,
  type AgentAttachmentUploadInput,
  type CodexlyClientOptions,
  type CodexlyRequestTimeouts,
  type ListTasksOptions,
  type MutationOptions,
  type PendingRequestResolution,
  type ReadOptions,
  type ReadTaskOptions,
  type UnauthorizedListener,
} from "./http-client-transport.js";
export { ProjectHttpClient, type ListFilesystemEntriesOptions } from "./http-client-projects.js";
export { SkillMarketHttpClient } from "./http-client-skill-market.js";
export { TaskHttpClient } from "./http-client-tasks.js";
export { ScheduledTaskHttpClient } from "./http-client-scheduled-tasks.js";

import { AsyncQuestionHttpClient } from "./http-client-async-questions.js";

export class CodexlyClient extends AsyncQuestionHttpClient {
  public optimizePrompt(projectId: string, text: string): Promise<{ text: string }> {
    return this.request(
      `/v1/projects/${encodeURIComponent(projectId)}/prompt-optimization`,
      OptimizePromptResponseSchema,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ text }),
      },
      undefined,
      { timeoutMs: 150_000 },
    );
  }

  public syncSavedPrompts(input: SavedPromptsRequest): Promise<SharedSavedPrompt[]> {
    return this.request("/v1/saved-prompts", SavedPromptsSchema, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    });
  }

  public saveDiagnostics(input: SaveDiagnosticsRequest): Promise<SaveDiagnosticsResponse> {
    return this.request(
      "/v1/diagnostics/codex",
      SaveDiagnosticsResponseSchema,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      undefined,
      { timeoutMs: 150_000 },
    );
  }

  public diagnosticsDownloadUrl(downloadId: string): string {
    return `${this.baseUrl}/v1/diagnostics/downloads/${encodeURIComponent(downloadId)}`;
  }

  public async getDiagnostics(options: ReadOptions = {}): Promise<DiagnosticsResponse> {
    return this.read("/v1/diagnostics", DiagnosticsResponseSchema, options);
  }
}
