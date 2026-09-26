import type { AgentFileChange } from "../../diff/file-change.js";
import type { MessageFileReference } from "../../../shared/components/agent/message.js";
import type { ProjectGitCommit } from "@codexly/protocol";

export type InspectorDocument =
  | Readonly<{
      id: string;
      kind: "source" | "image";
      reference: MessageFileReference;
      change?: AgentFileChange;
      projectId?: string;
      rootPath?: string;
    }>
  | Readonly<{ id: string; kind: "diff"; change: AgentFileChange }>
  | Readonly<{ id: string; kind: "review"; changes: readonly AgentFileChange[] }>
  | Readonly<{ id: string; kind: "commit"; commit: ProjectGitCommit; repository?: string }>;

export function fileDocumentId(kind: "source" | "image" | "diff", path: string): string {
  return `${kind}:${path.replaceAll("\\", "/")}`;
}

export function documentTabId(id: string): `document:${string}` {
  return `document:${encodeURIComponent(id)}`;
}

export function closeInspectorDocument(
  documents: readonly InspectorDocument[],
  id: string,
): InspectorDocument[] {
  return documents.filter((document) => document.id !== id);
}
