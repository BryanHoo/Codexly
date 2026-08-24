import type { McpElicitationField, PendingRequest, Project } from "@codexly/protocol";

import {
  CodexProtocolMappingError,
  expectBoolean,
  expectRecord,
  expectString,
  requestIdKey,
  type PendingCodexRequest,
} from "./codex-mapping-common.js";
import type { RpcServerRequest } from "./jsonl-rpc-client.js";

type ElicitationRequest = Extract<PendingRequest, { type: "mcp_elicitation" }>;
type FormElicitationRequest = Extract<ElicitationRequest, { mode: "form" }>;
type ElicitationContent = Readonly<Record<string, boolean | number | string | readonly string[]>>;
type ElicitationOption = Extract<
  McpElicitationField,
  { type: "multi_select" | "select" }
>["options"][number];
type ElicitationOptions = ElicitationOption[];

function expectNonEmptyString(value: unknown, context: string): string {
  const result = expectString(value, context);
  if (result.length === 0) {
    throw new CodexProtocolMappingError(`${context} must not be empty`);
  }
  return result;
}

function optionalString(value: unknown, context: string): string | null {
  return value === undefined ? null : expectString(value, context);
}

function optionalNumber(value: unknown, context: string): number | null {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CodexProtocolMappingError(`${context} must be a finite number`);
  }
  return value;
}

function optionalNonNegativeInteger(value: unknown, context: string): number | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new CodexProtocolMappingError(`${context} must be a non-negative integer`);
  }
  return Number(value);
}

function mapRequiredProperties(value: unknown, propertyIds: ReadonlySet<string>): Set<string> {
  if (value === undefined) return new Set();
  if (!Array.isArray(value)) {
    throw new CodexProtocolMappingError("MCP elicitation required must be an array");
  }
  const required = new Set(
    value.map((entry) => expectString(entry, "MCP elicitation required property")),
  );
  if (required.size !== value.length || [...required].some((id) => !propertyIds.has(id))) {
    throw new CodexProtocolMappingError("MCP elicitation required properties are invalid");
  }
  return required;
}

function mapConstOptions(value: unknown, context: string): ElicitationOptions {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CodexProtocolMappingError(`${context} must contain options`);
  }
  const options = value.map((entry) => {
    const option = expectRecord(entry, `${context} option`);
    return {
      label: expectNonEmptyString(option["title"], `${context} option title`),
      value: expectString(option["const"], `${context} option value`),
    };
  });
  if (new Set(options.map((option) => option.value)).size !== options.length) {
    throw new CodexProtocolMappingError(`${context} option values must be unique`);
  }
  return options;
}

function mapEnumOptions(values: unknown, names: unknown, context: string): ElicitationOptions {
  if (!Array.isArray(values) || values.length === 0) {
    throw new CodexProtocolMappingError(`${context} must contain options`);
  }
  const mappedValues = values.map((entry) => expectString(entry, `${context} value`));
  const mappedNames =
    names === undefined
      ? mappedValues
      : Array.isArray(names) && names.length === mappedValues.length
        ? names.map((entry) => expectString(entry, `${context} name`))
        : undefined;
  if (mappedNames === undefined || new Set(mappedValues).size !== mappedValues.length) {
    throw new CodexProtocolMappingError(`${context} options are invalid`);
  }
  return mappedValues.map((value, index) => ({ label: mappedNames[index] ?? value, value }));
}

function mapOptions(schema: Record<string, unknown>, context: string): ElicitationOptions | null {
  if (schema["oneOf"] !== undefined) return mapConstOptions(schema["oneOf"], context);
  if (schema["anyOf"] !== undefined) return mapConstOptions(schema["anyOf"], context);
  if (schema["enum"] !== undefined) {
    return mapEnumOptions(schema["enum"], schema["enumNames"], context);
  }
  return null;
}

function fieldIdentity(id: string, schema: Record<string, unknown>, required: ReadonlySet<string>) {
  return {
    description: optionalString(schema["description"], `MCP elicitation ${id} description`),
    id,
    required: required.has(id),
    title: optionalString(schema["title"], `MCP elicitation ${id} title`) ?? id,
  };
}

function mapDefaultString(
  value: unknown,
  options: ElicitationOptions | null,
  context: string,
): string | null {
  const defaultValue = optionalString(value, context);
  if (
    defaultValue !== null &&
    options !== null &&
    !options.some((option) => option.value === defaultValue)
  ) {
    throw new CodexProtocolMappingError(`${context} is not an available option`);
  }
  return defaultValue;
}

function mapStringField(
  id: string,
  schema: Record<string, unknown>,
  required: ReadonlySet<string>,
): McpElicitationField {
  const identity = fieldIdentity(id, schema, required);
  const options = mapOptions(schema, `MCP elicitation ${id}`);
  if (options !== null) {
    return {
      ...identity,
      defaultValue: mapDefaultString(schema["default"], options, `MCP elicitation ${id} default`),
      options,
      type: "select",
    };
  }
  const format = schema["format"] ?? null;
  if (
    format !== null &&
    format !== "email" &&
    format !== "uri" &&
    format !== "date" &&
    format !== "date-time"
  ) {
    throw new CodexProtocolMappingError(`MCP elicitation ${id} format is invalid`);
  }
  return {
    ...identity,
    defaultValue: mapDefaultString(schema["default"], null, `MCP elicitation ${id} default`),
    format,
    maxLength: optionalNonNegativeInteger(schema["maxLength"], `MCP elicitation ${id} maxLength`),
    minLength: optionalNonNegativeInteger(schema["minLength"], `MCP elicitation ${id} minLength`),
    type: "string",
  };
}

function mapMultiSelectField(
  id: string,
  schema: Record<string, unknown>,
  required: ReadonlySet<string>,
): McpElicitationField {
  const items = expectRecord(schema["items"], `MCP elicitation ${id} items`);
  const options = mapOptions(items, `MCP elicitation ${id} items`);
  if (options === null) {
    throw new CodexProtocolMappingError(`MCP elicitation ${id} items must contain options`);
  }
  const defaultValue = schema["default"] ?? [];
  if (
    !Array.isArray(defaultValue) ||
    defaultValue.some(
      (entry) => typeof entry !== "string" || !options.some((option) => option.value === entry),
    )
  ) {
    throw new CodexProtocolMappingError(`MCP elicitation ${id} default is invalid`);
  }
  const mappedDefaultValue = defaultValue.map((entry) =>
    expectString(entry, `MCP elicitation ${id} default entry`),
  );
  return {
    ...fieldIdentity(id, schema, required),
    defaultValue: mappedDefaultValue,
    maximum: optionalNonNegativeInteger(schema["maxItems"], `MCP elicitation ${id} maxItems`),
    minimum: optionalNonNegativeInteger(schema["minItems"], `MCP elicitation ${id} minItems`),
    options,
    type: "multi_select",
  };
}

function mapPrimitiveField(
  id: string,
  value: unknown,
  required: ReadonlySet<string>,
): McpElicitationField {
  if (id.length === 0) {
    throw new CodexProtocolMappingError("MCP elicitation property id must not be empty");
  }
  const schema = expectRecord(value, `MCP elicitation ${id} schema`);
  const type = expectString(schema["type"], `MCP elicitation ${id} type`);
  if (type === "string") return mapStringField(id, schema, required);
  if (type === "array") return mapMultiSelectField(id, schema, required);
  if (type === "boolean") {
    const defaultValue = schema["default"];
    return {
      ...fieldIdentity(id, schema, required),
      defaultValue:
        defaultValue === undefined
          ? null
          : expectBoolean(defaultValue, `MCP elicitation ${id} default`),
      type,
    };
  }
  if (type === "number" || type === "integer") {
    const defaultValue = optionalNumber(schema["default"], `MCP elicitation ${id} default`);
    if (type === "integer" && defaultValue !== null && !Number.isInteger(defaultValue)) {
      throw new CodexProtocolMappingError(`MCP elicitation ${id} default must be an integer`);
    }
    return {
      ...fieldIdentity(id, schema, required),
      defaultValue,
      maximum: optionalNumber(schema["maximum"], `MCP elicitation ${id} maximum`),
      minimum: optionalNumber(schema["minimum"], `MCP elicitation ${id} minimum`),
      type,
    };
  }
  throw new CodexProtocolMappingError(`MCP elicitation ${id} type is unsupported`);
}

function mapFormFields(value: unknown): FormElicitationRequest["fields"] {
  const schema = expectRecord(value, "MCP elicitation requestedSchema");
  if (schema["type"] !== "object") {
    throw new CodexProtocolMappingError("MCP elicitation requestedSchema must be an object");
  }
  const properties = expectRecord(schema["properties"], "MCP elicitation properties");
  const required = mapRequiredProperties(schema["required"], new Set(Object.keys(properties)));
  return Object.entries(properties).map(([id, field]) => mapPrimitiveField(id, field, required));
}

function mapSafeUrl(value: unknown): string {
  const url = expectString(value, "MCP elicitation URL");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CodexProtocolMappingError("MCP elicitation URL is invalid");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new CodexProtocolMappingError("MCP elicitation URL protocol is unsupported");
  }
  return url;
}

export function mapMcpServerElicitationRequest(
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
      ? { ...identity, fields: mapFormFields(params["requestedSchema"]), mode }
      : mode === "url"
        ? { ...identity, mode, url: mapSafeUrl(params["url"]) }
        : mode === "openai/form"
          ? { ...identity, mode: "unsupported" }
          : (() => {
              throw new CodexProtocolMappingError("MCP elicitation mode is unsupported");
            })();
  return { providerRequestId: serverRequest.id, request };
}

function stringFormatMatches(value: string, format: string | null): boolean {
  if (format === null) return true;
  if (format === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
  if (format === "date")
    return /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(value));
  if (format === "date-time") return !Number.isNaN(Date.parse(value));
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isStringField(
  field: McpElicitationField,
): field is Extract<McpElicitationField, { type: "string" }> {
  return field.type === "string";
}

function fieldValueMatches(field: McpElicitationField, value: unknown): boolean {
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "number" || field.type === "integer") {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (field.type === "number" || Number.isInteger(value)) &&
      (field.minimum === null || value >= field.minimum) &&
      (field.maximum === null || value <= field.maximum)
    );
  }
  if (field.type === "select") {
    return typeof value === "string" && field.options.some((option) => option.value === value);
  }
  if (field.type === "multi_select") {
    return (
      Array.isArray(value) &&
      value.every(
        (entry) =>
          typeof entry === "string" && field.options.some((option) => option.value === entry),
      ) &&
      new Set(value).size === value.length &&
      (field.minimum === null || value.length >= field.minimum) &&
      (field.maximum === null || value.length <= field.maximum)
    );
  }
  if (!isStringField(field) || typeof value !== "string") return false;
  const length = Array.from(value).length;
  return (
    (field.minLength === null || length >= field.minLength) &&
    (field.maxLength === null || length <= field.maxLength) &&
    stringFormatMatches(value, field.format)
  );
}

export function mcpElicitationContentMatchesRequest(
  request: ElicitationRequest,
  content: ElicitationContent,
): boolean {
  if (request.mode === "unsupported") return false;
  if (request.mode === "url") return Object.keys(content).length === 0;
  const fields = new Map(request.fields.map((field) => [field.id, field]));
  const entries = Object.entries(content);
  return (
    entries.every(([id, value]) => {
      const field = fields.get(id);
      return field !== undefined && fieldValueMatches(field, value);
    }) && request.fields.every((field) => !field.required || Object.hasOwn(content, field.id))
  );
}
