import type { ProjectDraftRecord } from "./project-draft-store.js";
import { serializePromptSkillContent } from "./components/prompt-skill-editor.js";

export function getProjectDraftSummary(
  draft: ProjectDraftRecord,
  attachmentFallback: string,
): string {
  return serializePromptSkillContent(draft.draft.content).trim() || attachmentFallback;
}
