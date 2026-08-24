const GRANULAR_FIELDS = [
  "mcp_elicitations",
  "request_permissions",
  "rules",
  "sandbox_approval",
  "skill_approval",
];

function parseGranularApprovalPolicy(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Stored approval policy is invalid");
  }
  const outerKeys = Object.keys(value);
  const granular = value.granular;
  if (
    outerKeys.length !== 1 ||
    outerKeys[0] !== "granular" ||
    typeof granular !== "object" ||
    granular === null ||
    Array.isArray(granular) ||
    Object.keys(granular).length !== GRANULAR_FIELDS.length ||
    GRANULAR_FIELDS.some((field) => typeof granular[field] !== "boolean")
  ) {
    throw new Error("Stored granular approval policy is invalid");
  }
  return { granular: Object.fromEntries(GRANULAR_FIELDS.map((field) => [field, granular[field]])) };
}

export function deserializeApprovalPolicy(serialized, scope) {
  if (serialized === "on-request" || serialized === "never") {
    return serialized;
  }
  if (scope === "turn" && serialized === "untrusted") {
    return serialized;
  }
  if (typeof serialized !== "string" || !serialized.startsWith("{")) {
    throw new Error(`Stored ${scope} approval policy is invalid`);
  }
  try {
    return parseGranularApprovalPolicy(JSON.parse(serialized));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Stored ${scope} approval policy JSON is invalid`, { cause: error });
    }
    throw error;
  }
}

export function serializeApprovalPolicy(policy) {
  return typeof policy === "string" ? policy : JSON.stringify(parseGranularApprovalPolicy(policy));
}
