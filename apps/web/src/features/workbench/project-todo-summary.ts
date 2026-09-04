import { serializePromptSkillContent } from "./components/prompt-skill-editor.js";
import type { ProjectTodoRecord } from "./project-todo-store.js";

export function getProjectTodoSummary(todo: ProjectTodoRecord, attachmentFallback: string): string {
  return serializePromptSkillContent(todo.draft.content).trim() || attachmentFallback;
}
