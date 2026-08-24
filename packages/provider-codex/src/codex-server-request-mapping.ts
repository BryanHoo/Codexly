import type { PendingApprovalDecision, PendingRequest, Project } from "@codexly/protocol";

import {
  CodexProtocolMappingError,
  expectBoolean,
  expectRecord,
  expectString,
  mapUserInputQuestions,
  requestIdKey,
  type PendingCodexRequest,
} from "./codex-mapping-common.js";
import type { RpcServerRequest } from "./jsonl-rpc-client.js";
import { mapMcpServerElicitationRequest } from "./codex-mcp-elicitation-mapping.js";

type NetworkAccess = NonNullable<
  Extract<PendingRequest, { type: "command_approval" }>["networkAccess"]
>;
type PermissionRequest = Extract<PendingRequest, { type: "permissions_approval" }>;
type PublicPermissionProfile = PermissionRequest["permissions"];
type PublicFileSystemPermissions = NonNullable<PermissionRequest["permissions"]["fileSystem"]>;

function optionalNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : expectString(value, "optional string");
}

function requiredNullableString(value: unknown, context: string): string | null {
  return value === null ? null : expectString(value, context);
}

function toDateTimeMs(value: unknown, context: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CodexProtocolMappingError(`${context} must be a Unix timestamp in milliseconds`);
  }
  return new Date(value).toISOString();
}

function mapApprovalDecisions(value: unknown): {
  availableDecisions: PendingApprovalDecision[];
  denyDecision: "cancel" | "decline";
} {
  const nativeDecisions = Array.isArray(value)
    ? value.filter((decision): decision is string => typeof decision === "string")
    : ["accept", "acceptForSession", "decline"];
  const availableDecisions: PendingApprovalDecision[] = [];
  if (nativeDecisions.includes("accept")) availableDecisions.push("allow");
  if (nativeDecisions.includes("acceptForSession")) {
    availableDecisions.push("allow_for_session");
  }
  if (nativeDecisions.includes("decline") || nativeDecisions.includes("cancel")) {
    availableDecisions.push("deny");
  }
  if (availableDecisions.length === 0) {
    throw new CodexProtocolMappingError("Codex approval has no supported decisions");
  }
  return {
    availableDecisions,
    denyDecision: nativeDecisions.includes("decline") ? "decline" : "cancel",
  };
}

function isNetworkApprovalProtocol(value: unknown): value is NetworkAccess["protocol"] {
  return value === "http" || value === "https" || value === "socks5Tcp" || value === "socks5Udp";
}

function mapNetworkApprovalContext(value: unknown): NetworkAccess | null {
  if (value === null || value === undefined) return null;
  const context = expectRecord(value, "Codex network approval context");
  const host = expectString(context["host"], "Codex network approval host");
  const protocol = context["protocol"];
  if (host.length === 0) {
    throw new CodexProtocolMappingError("Codex network approval host must not be empty");
  }
  if (!isNetworkApprovalProtocol(protocol)) {
    throw new CodexProtocolMappingError("Codex network approval protocol is invalid");
  }
  return { host, protocol };
}

function mapNullableStringList(value: unknown, context: string): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) {
    throw new CodexProtocolMappingError(`${context} must be an array or null`);
  }
  return value.map((entry) => expectString(entry, `${context} entry`));
}

function mapSpecialPath(value: unknown): {
  native: Record<string, unknown>;
  public: Extract<PublicFileSystemPermissions["entries"][number]["path"], { type: "special" }>;
} {
  const special = expectRecord(value, "Codex filesystem special path");
  const kind = expectString(special["kind"], "Codex filesystem special path kind");
  if (
    kind !== "root" &&
    kind !== "minimal" &&
    kind !== "project_roots" &&
    kind !== "tmpdir" &&
    kind !== "slash_tmp" &&
    kind !== "unknown"
  ) {
    throw new CodexProtocolMappingError("Codex filesystem special path kind is invalid");
  }
  const subpath =
    kind === "project_roots" || kind === "unknown"
      ? requiredNullableString(special["subpath"], "Codex filesystem special path subpath")
      : null;
  const path =
    kind === "unknown" ? expectString(special["path"], "Codex filesystem special path") : null;
  return {
    native: {
      kind,
      ...(kind === "unknown" ? { path, subpath } : {}),
      ...(kind === "project_roots" ? { subpath } : {}),
    },
    public: { kind, path, subpath, type: "special" },
  };
}

function mapFileSystemPath(value: unknown): {
  native: Record<string, unknown>;
  public: PublicFileSystemPermissions["entries"][number]["path"];
} {
  const path = expectRecord(value, "Codex filesystem path");
  const type = expectString(path["type"], "Codex filesystem path type");
  if (type === "path") {
    const mappedPath = expectString(path["path"], "Codex filesystem path");
    return { native: { path: mappedPath, type }, public: { type, value: mappedPath } };
  }
  if (type === "glob_pattern") {
    const pattern = expectString(path["pattern"], "Codex filesystem glob pattern");
    return {
      native: { pattern, type },
      public: { type: "glob", value: pattern },
    };
  }
  if (type === "special") {
    const mapped = mapSpecialPath(path["value"]);
    return { native: { type, value: mapped.native }, public: mapped.public };
  }
  throw new CodexProtocolMappingError("Codex filesystem path type is invalid");
}

function mapFileSystemPermissions(value: unknown): {
  native: Record<string, unknown> | null;
  public: PublicFileSystemPermissions | null;
} {
  if (value === null) return { native: null, public: null };
  const permissions = expectRecord(value, "Codex filesystem permissions");
  const read = mapNullableStringList(permissions["read"], "Codex filesystem read permissions");
  const write = mapNullableStringList(permissions["write"], "Codex filesystem write permissions");
  const globScanMaxDepthValue = permissions["globScanMaxDepth"];
  if (
    globScanMaxDepthValue !== undefined &&
    (!Number.isInteger(globScanMaxDepthValue) || Number(globScanMaxDepthValue) < 0)
  ) {
    throw new CodexProtocolMappingError("Codex filesystem globScanMaxDepth is invalid");
  }
  const nativeEntriesValue = permissions["entries"];
  if (nativeEntriesValue !== undefined && !Array.isArray(nativeEntriesValue)) {
    throw new CodexProtocolMappingError("Codex filesystem entries must be an array");
  }
  const mappedEntries = (nativeEntriesValue ?? []).map((value) => {
    const entry = expectRecord(value, "Codex filesystem entry");
    const access = expectString(entry["access"], "Codex filesystem entry access");
    if (access !== "read" && access !== "write" && access !== "deny") {
      throw new CodexProtocolMappingError("Codex filesystem entry access is invalid");
    }
    const path = mapFileSystemPath(entry["path"]);
    const publicEntry: PublicFileSystemPermissions["entries"][number] = {
      access,
      path: path.public,
    };
    return {
      native: { access, path: path.native },
      public: publicEntry,
    };
  });
  const depth = globScanMaxDepthValue === undefined ? null : Number(globScanMaxDepthValue);
  return {
    native: {
      read,
      write,
      ...(globScanMaxDepthValue === undefined ? {} : { globScanMaxDepth: depth }),
      ...(nativeEntriesValue === undefined
        ? {}
        : { entries: mappedEntries.map((entry) => entry.native) }),
    },
    public: {
      entries: mappedEntries.map((entry) => entry.public),
      globScanMaxDepth: depth,
      read,
      write,
    },
  };
}

function mapNetworkPermissions(value: unknown): {
  native: { enabled: boolean | null } | null;
  public: { enabled: boolean | null } | null;
} {
  if (value === null) return { native: null, public: null };
  const permissions = expectRecord(value, "Codex network permissions");
  const enabledValue = permissions["enabled"];
  if (enabledValue !== null && typeof enabledValue !== "boolean") {
    throw new CodexProtocolMappingError("Codex network permissions enabled is invalid");
  }
  const mapped = { enabled: enabledValue };
  return { native: mapped, public: mapped };
}

function mapPermissionProfile(
  value: unknown,
  context: string,
): {
  native: {
    fileSystem: Record<string, unknown> | null;
    network: { enabled: boolean | null } | null;
  };
  public: PublicPermissionProfile;
} {
  const permissions = expectRecord(value, context);
  const fileSystem = mapFileSystemPermissions(permissions["fileSystem"]);
  const network = mapNetworkPermissions(permissions["network"]);
  return {
    native: { fileSystem: fileSystem.native, network: network.native },
    public: { fileSystem: fileSystem.public, network: network.public },
  };
}

function mapPermissionRequest(
  serverRequest: RpcServerRequest,
  params: Record<string, unknown>,
  project: Pick<Project, "id">,
): PendingCodexRequest {
  const permissions = mapPermissionProfile(params["permissions"], "Codex requested permissions");
  const taskId = expectString(params["threadId"], "Codex permission request threadId");
  const turnId = expectString(params["turnId"], "Codex permission request turnId");
  return {
    nativePermissionProfile: permissions.native,
    providerRequestId: serverRequest.id,
    request: {
      createdAt: toDateTimeMs(params["startedAtMs"], "Codex permission request startedAtMs"),
      cwd: expectString(params["cwd"], "Codex permission request cwd"),
      environmentId: requiredNullableString(
        params["environmentId"],
        "Codex permission request environmentId",
      ),
      expiresAt: null,
      itemId: expectString(params["itemId"], "Codex permission request itemId"),
      permissions: permissions.public,
      projectId: project.id,
      reason: optionalNullableString(params["reason"]),
      requestId: requestIdKey(serverRequest.id),
      status: "pending",
      taskId,
      turnId,
      type: "permissions_approval",
    },
  };
}

export function mapCodexServerRequest(
  serverRequest: RpcServerRequest,
  project: Pick<Project, "id">,
): PendingCodexRequest | undefined {
  if (serverRequest.method === "mcpServer/elicitation/request") {
    return mapMcpServerElicitationRequest(serverRequest, project);
  }
  if (serverRequest.method === "item/permissions/requestApproval") {
    return mapPermissionRequest(
      serverRequest,
      expectRecord(serverRequest.params, "Codex permission request params"),
      project,
    );
  }
  if (
    serverRequest.method !== "item/commandExecution/requestApproval" &&
    serverRequest.method !== "item/fileChange/requestApproval" &&
    serverRequest.method !== "item/tool/requestUserInput"
  ) {
    return undefined;
  }
  const params = expectRecord(serverRequest.params, `Codex ${serverRequest.method} params`);
  const taskId = expectString(params["threadId"], `Codex ${serverRequest.method} threadId`);
  const turnId = expectString(params["turnId"], `Codex ${serverRequest.method} turnId`);
  const itemId = expectString(params["itemId"], `Codex ${serverRequest.method} itemId`);
  const requestId = requestIdKey(serverRequest.id);

  if (serverRequest.method === "item/tool/requestUserInput") {
    expectBoolean(params["isBlocking"], "Codex user input isBlocking");
    const autoResolutionMs = params["autoResolutionMs"] ?? null;
    if (
      autoResolutionMs !== null &&
      (typeof autoResolutionMs !== "number" ||
        !Number.isInteger(autoResolutionMs) ||
        autoResolutionMs < 0)
    ) {
      throw new CodexProtocolMappingError("Codex user input autoResolutionMs is invalid");
    }
    const createdAtMs = Date.now();
    return {
      providerRequestId: serverRequest.id,
      request: {
        createdAt: new Date(createdAtMs).toISOString(),
        expiresAt:
          autoResolutionMs === null ? null : new Date(createdAtMs + autoResolutionMs).toISOString(),
        itemId,
        projectId: project.id,
        questions: mapUserInputQuestions(params["questions"]),
        requestId,
        status: "pending",
        taskId,
        turnId,
        type: "user_input",
      },
    };
  }

  const decisions = mapApprovalDecisions(params["availableDecisions"]);
  const identity = {
    createdAt: toDateTimeMs(params["startedAtMs"], `Codex ${serverRequest.method} startedAtMs`),
    expiresAt: null,
    itemId,
    projectId: project.id,
    requestId,
    status: "pending" as const,
    taskId,
    turnId,
  };
  if (serverRequest.method === "item/commandExecution/requestApproval") {
    const additionalPermissions =
      params["additionalPermissions"] === null || params["additionalPermissions"] === undefined
        ? null
        : mapPermissionProfile(
            params["additionalPermissions"],
            "Codex command additional permissions",
          ).public;
    return {
      denyDecision: decisions.denyDecision,
      providerRequestId: serverRequest.id,
      request: {
        ...identity,
        additionalPermissions,
        availableDecisions: decisions.availableDecisions,
        command: optionalNullableString(params["command"]),
        cwd: optionalNullableString(params["cwd"]),
        networkAccess: mapNetworkApprovalContext(params["networkApprovalContext"]),
        reason: optionalNullableString(params["reason"]),
        type: "command_approval",
      },
    };
  }
  return {
    denyDecision: decisions.denyDecision,
    providerRequestId: serverRequest.id,
    request: {
      ...identity,
      availableDecisions: decisions.availableDecisions,
      grantRoot: optionalNullableString(params["grantRoot"]),
      reason: optionalNullableString(params["reason"]),
      type: "file_change_approval",
    },
  };
}
