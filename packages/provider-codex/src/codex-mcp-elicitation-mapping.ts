import type { PendingRequest, Project } from "@codexly/protocol";
import {
  mapMcpElicitationFormFields,
  mapMcpElicitationSafeUrl,
  McpElicitationMappingError,
} from "@codexly/core";
export { mcpElicitationContentMatchesRequest } from "@codexly/core";
import {
  CodexProtocolMappingError,
  expectRecord,
  expectString,
  requestIdKey,
  type PendingCodexRequest,
} from "./codex-mapping-common.js";
import type { RpcServerRequest } from "./jsonl-rpc-client.js";
type ElicitationRequest = Extract<PendingRequest, { type: "mcp_elicitation" }>;
function expectNonEmptyString(value: unknown, context: string): string {
  const result = expectString(value, context);
  if (result.length === 0) {
    throw new CodexProtocolMappingError(`${context} must not be empty`);
  }
  return result;
}

function mapRequest(
  serverRequest: RpcServerRequest,
  project: Pick<Project, "id">,
): PendingCodexRequest {
  const params = expectRecord(serverRequest.params, "MCP elicitation request params");
  const requestId = requestIdKey(serverRequest.id);
  const taskId = expectNonEmptyString(params["threadId"], "MCP elicitation threadId");
  const nativeTurnId = params["turnId"];
  const turnId =
    nativeTurnId === null || nativeTurnId === undefined
      ? `mcp-elicitation:${requestId}`
      : expectNonEmptyString(nativeTurnId, "MCP elicitation turnId");
  const identity = {
    createdAt: new Date().toISOString(),
    expiresAt: null,
    itemId: `mcp-elicitation:${requestId}`,
    message: expectNonEmptyString(params["message"], "MCP elicitation message"),
    projectId: project.id,
    requestId,
    serverName: expectNonEmptyString(params["serverName"], "MCP elicitation serverName"),
    status: "pending" as const,
    taskId,
    turnId,
    type: "mcp_elicitation" as const,
  };
  const mode = expectString(params["mode"], "MCP elicitation mode");
  const request: ElicitationRequest & { status: "pending" } =
    mode === "form"
      ? { ...identity, fields: mapMcpElicitationFormFields(params["requestedSchema"]), mode }
      : mode === "url"
        ? { ...identity, mode, url: mapMcpElicitationSafeUrl(params["url"]) }
        : mode === "openai/form" || mode === "openaiForm"
          ? { ...identity, mode: "unsupported" }
          : (() => {
              throw new CodexProtocolMappingError("MCP elicitation mode is unsupported");
            })();
  return { providerRequestId: serverRequest.id, request };
}

export function mapMcpServerElicitationRequest(
  serverRequest: RpcServerRequest,
  project: Pick<Project, "id">,
): PendingCodexRequest {
  try {
    return mapRequest(serverRequest, project);
  } catch (error) {
    if (error instanceof McpElicitationMappingError)
      throw new CodexProtocolMappingError(error.message);
    throw error;
  }
}
