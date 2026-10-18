import type { AgentMutationError } from "@codexly/protocol";

export class CodexlyHttpError extends Error {
  public readonly status: number;

  public constructor(status: number, statusText: string, message?: string) {
    super(message ?? `Codexly request failed with ${String(status)} ${statusText}`.trim());
    this.name = "CodexlyHttpError";
    this.status = status;
  }
}

export class CodexlyMutationError extends CodexlyHttpError {
  public readonly code: AgentMutationError["code"];
  public readonly retryable: boolean;

  public constructor(status: number, statusText: string, error: AgentMutationError) {
    super(status, statusText, error.message);
    this.name = "CodexlyMutationError";
    this.code = error.code;
    this.retryable = error.retryable;
  }
}

export class CodexlyResponseError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexlyResponseError";
  }
}
