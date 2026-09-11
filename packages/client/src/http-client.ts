export {
  CodexlyHttpError,
  CodexlyMutationError,
  CodexlyResponseError,
  buildProjectAttachmentUrl,
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

import { PersonalizationHttpClient } from "./http-client-personalization.js";

export class CodexlyClient extends PersonalizationHttpClient {}
