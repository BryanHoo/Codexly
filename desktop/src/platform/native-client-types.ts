import type {
  AgentAttachmentKind,
  AgentEvent,
  PendingRequest,
  ResolvePendingRequestRequest,
  ResyncRequired,
} from "@/protocol/index.js";

export type AgentEventConnectionState = "closed" | "connected" | "connecting" | "reconnecting";

export interface SubscribeAgentEventsOptions {
  afterSequence: number;
  onConnectionState?: (state: AgentEventConnectionState) => void;
  onError?: (error: Error) => void;
  onEvent: (event: AgentEvent) => void;
  onResyncRequired: (message: ResyncRequired) => void;
  projectId: string;
  reconnectDelayMs?: number;
  sessionId: string;
}

export type ReadOptions = Readonly<{ signal?: AbortSignal }>;
export type ProjectFileReadOptions = ReadOptions & Readonly<{ taskId?: string }>;
export type ReadTaskOptions = ReadOptions & Readonly<{ cursor?: string }>;
export type MutationOptions = Readonly<{ idempotencyKey?: string; signal?: AbortSignal }>;
export type ListTasksOptions = Readonly<{
  archived?: true;
  cursor?: string;
  limit?: number;
  pinned?: true;
  searchTerm?: string;
}>;
export type ListCompletedTasksOptions = Readonly<{
  cursor?: string;
  limit?: number;
  projectId?: string;
}>;
export type ListFilesystemEntriesOptions = ReadOptions & Readonly<{ includeHidden?: boolean }>;
export type AgentAttachmentUploadInput = Readonly<{
  content: Blob;
  kind: AgentAttachmentKind;
  name: string;
}>;
export type PendingRequestResolution<T extends PendingRequest> = Extract<
  ResolvePendingRequestRequest,
  { type: T["type"] }
>["resolution"];
