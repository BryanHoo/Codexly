import type { PendingRequest, ResolvePendingRequestRequest } from "@codexly/protocol";
import { v4 as createUuid } from "uuid";

export type PendingRequestResolution = ResolvePendingRequestRequest["resolution"];

export type PendingRequestResolutionAttempt = Readonly<{
  fingerprint: string;
  key: string;
}>;

export type PendingRequestResolveHandler = (
  request: PendingRequest,
  resolution: PendingRequestResolution,
  idempotencyKey: string,
) => Promise<void>;

export function resolvePendingRequestAttempt(
  attempt: PendingRequestResolutionAttempt | undefined,
  resolution: PendingRequestResolution,
  createKey: () => string = createUuid,
): PendingRequestResolutionAttempt {
  const fingerprint = JSON.stringify(resolution);
  return attempt?.fingerprint === fingerprint ? attempt : { fingerprint, key: createKey() };
}
