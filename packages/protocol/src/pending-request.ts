import { Type, type Static } from "@sinclair/typebox";

import { DateTimeSchema, NullableDateTimeSchema } from "./project-files.js";
import { McpElicitationFieldSchema, McpElicitationResolutionSchema } from "./mcp-elicitation.js";

export const PendingRequestStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("resolved"),
  Type.Literal("expired"),
]);

export const PendingApprovalDecisionSchema = Type.Union([
  Type.Literal("allow"),
  Type.Literal("allow_for_session"),
  Type.Literal("deny"),
]);

const PendingNetworkAccessSchema = Type.Object(
  {
    host: Type.String({ minLength: 1 }),
    protocol: Type.Union([
      Type.Literal("http"),
      Type.Literal("https"),
      Type.Literal("socks5Tcp"),
      Type.Literal("socks5Udp"),
    ]),
  },
  { additionalProperties: false },
);

const PendingRequestIdentityProperties = {
  createdAt: DateTimeSchema,
  expiresAt: NullableDateTimeSchema,
  itemId: Type.String({ minLength: 1 }),
  projectId: Type.String({ minLength: 1 }),
  requestId: Type.String({ minLength: 1 }),
  status: PendingRequestStatusSchema,
  taskId: Type.String({ minLength: 1 }),
  turnId: Type.String({ minLength: 1 }),
};

const PendingRequestResolutionIdentityProperties = {
  itemId: Type.String({ minLength: 1 }),
  projectId: Type.String({ minLength: 1 }),
  taskId: Type.String({ minLength: 1 }),
  turnId: Type.String({ minLength: 1 }),
};

export const PendingUserInputOptionSchema = Type.Object(
  {
    description: Type.String(),
    label: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const PendingUserInputQuestionProperties = {
  header: Type.String({ minLength: 1 }),
  id: Type.String({ minLength: 1 }),
  isSecret: Type.Boolean(),
  prompt: Type.String({ minLength: 1 }),
};

export const PendingUserInputQuestionSchema = Type.Union([
  Type.Object(
    {
      ...PendingUserInputQuestionProperties,
      isOther: Type.Boolean(),
      options: Type.Array(PendingUserInputOptionSchema, { minItems: 1 }),
      type: Type.Literal("choice"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...PendingUserInputQuestionProperties,
      isOther: Type.Literal(true),
      options: Type.Array(PendingUserInputOptionSchema, { maxItems: 0 }),
      type: Type.Literal("choice"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...PendingUserInputQuestionProperties,
      isOther: Type.Literal(false),
      options: Type.Array(PendingUserInputOptionSchema, { maxItems: 2, minItems: 2 }),
      type: Type.Literal("confirmation"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...PendingUserInputQuestionProperties,
      isOther: Type.Boolean(),
      options: Type.Array(PendingUserInputOptionSchema, { maxItems: 0 }),
      type: Type.Literal("short_text"),
    },
    { additionalProperties: false },
  ),
]);

export const FileChangeApprovalPendingRequestSchema = Type.Object(
  {
    ...PendingRequestIdentityProperties,
    availableDecisions: Type.Array(PendingApprovalDecisionSchema, { minItems: 1 }),
    grantRoot: Type.Union([Type.String(), Type.Null()]),
    reason: Type.Union([Type.String(), Type.Null()]),
    type: Type.Literal("file_change_approval"),
  },
  { additionalProperties: false },
);

export const PendingPermissionCategorySchema = Type.Union([
  Type.Literal("network"),
  Type.Literal("file_system"),
]);

const PendingPermissionAccessSchema = Type.Union([
  Type.Literal("read"),
  Type.Literal("write"),
  Type.Literal("deny"),
]);

const PendingPermissionPathSchema = Type.Union([
  Type.Object(
    { type: Type.Literal("path"), value: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("glob"), value: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Union([
        Type.Literal("root"),
        Type.Literal("minimal"),
        Type.Literal("project_roots"),
        Type.Literal("tmpdir"),
        Type.Literal("slash_tmp"),
        Type.Literal("unknown"),
      ]),
      path: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
      subpath: Type.Union([Type.String(), Type.Null()]),
      type: Type.Literal("special"),
    },
    { additionalProperties: false },
  ),
]);

const PendingFileSystemPermissionsSchema = Type.Object(
  {
    entries: Type.Array(
      Type.Object(
        { access: PendingPermissionAccessSchema, path: PendingPermissionPathSchema },
        { additionalProperties: false },
      ),
    ),
    globScanMaxDepth: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    read: Type.Union([Type.Array(Type.String({ minLength: 1 })), Type.Null()]),
    write: Type.Union([Type.Array(Type.String({ minLength: 1 })), Type.Null()]),
  },
  { additionalProperties: false },
);

const PendingPermissionProfileSchema = Type.Object(
  {
    fileSystem: Type.Union([PendingFileSystemPermissionsSchema, Type.Null()]),
    network: Type.Union([
      Type.Object(
        { enabled: Type.Union([Type.Boolean(), Type.Null()]) },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export const CommandApprovalPendingRequestSchema = Type.Object(
  {
    ...PendingRequestIdentityProperties,
    additionalPermissions: Type.Optional(Type.Union([PendingPermissionProfileSchema, Type.Null()])),
    availableDecisions: Type.Array(PendingApprovalDecisionSchema, { minItems: 1 }),
    command: Type.Union([Type.String(), Type.Null()]),
    cwd: Type.Union([Type.String(), Type.Null()]),
    kind: Type.Union([Type.Literal("command"), Type.Literal("write_stdin")]),
    networkAccess: Type.Union([PendingNetworkAccessSchema, Type.Null()]),
    reason: Type.Union([Type.String(), Type.Null()]),
    type: Type.Literal("command_approval"),
  },
  { additionalProperties: false },
);

export const PermissionApprovalPendingRequestSchema = Type.Object(
  {
    ...PendingRequestIdentityProperties,
    cwd: Type.String({ minLength: 1 }),
    environmentId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    permissions: PendingPermissionProfileSchema,
    reason: Type.Union([Type.String(), Type.Null()]),
    type: Type.Literal("permissions_approval"),
  },
  { additionalProperties: false },
);

export const UserInputPendingRequestSchema = Type.Object(
  {
    ...PendingRequestIdentityProperties,
    questions: Type.Array(PendingUserInputQuestionSchema, { minItems: 1, maxItems: 3 }),
    type: Type.Literal("user_input"),
  },
  { additionalProperties: false },
);

const McpElicitationPendingRequestProperties = {
  ...PendingRequestIdentityProperties,
  message: Type.String({ minLength: 1 }),
  serverName: Type.String({ minLength: 1 }),
  type: Type.Literal("mcp_elicitation"),
};

const McpFormElicitationPendingRequestSchema = Type.Object(
  {
    ...McpElicitationPendingRequestProperties,
    fields: Type.Array(McpElicitationFieldSchema),
    mode: Type.Literal("form"),
  },
  { additionalProperties: false },
);

const McpUrlElicitationPendingRequestSchema = Type.Object(
  {
    ...McpElicitationPendingRequestProperties,
    mode: Type.Literal("url"),
    url: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const McpUnsupportedElicitationPendingRequestSchema = Type.Object(
  {
    ...McpElicitationPendingRequestProperties,
    mode: Type.Literal("unsupported"),
  },
  { additionalProperties: false },
);

export const McpElicitationPendingRequestSchema = Type.Union([
  McpFormElicitationPendingRequestSchema,
  McpUrlElicitationPendingRequestSchema,
  McpUnsupportedElicitationPendingRequestSchema,
]);

export const PendingRequestSchema = Type.Union([
  CommandApprovalPendingRequestSchema,
  FileChangeApprovalPendingRequestSchema,
  PermissionApprovalPendingRequestSchema,
  UserInputPendingRequestSchema,
  McpElicitationPendingRequestSchema,
]);

function createPendingRequestStatusSchema<TStatus extends "expired" | "pending" | "resolved">(
  status: TStatus,
) {
  return Type.Union([
    Type.Object(
      { ...CommandApprovalPendingRequestSchema.properties, status: Type.Literal(status) },
      { additionalProperties: false },
    ),
    Type.Object(
      { ...FileChangeApprovalPendingRequestSchema.properties, status: Type.Literal(status) },
      { additionalProperties: false },
    ),
    Type.Object(
      { ...PermissionApprovalPendingRequestSchema.properties, status: Type.Literal(status) },
      { additionalProperties: false },
    ),
    Type.Object(
      { ...UserInputPendingRequestSchema.properties, status: Type.Literal(status) },
      { additionalProperties: false },
    ),
    Type.Object(
      { ...McpFormElicitationPendingRequestSchema.properties, status: Type.Literal(status) },
      { additionalProperties: false },
    ),
    Type.Object(
      { ...McpUrlElicitationPendingRequestSchema.properties, status: Type.Literal(status) },
      { additionalProperties: false },
    ),
    Type.Object(
      { ...McpUnsupportedElicitationPendingRequestSchema.properties, status: Type.Literal(status) },
      { additionalProperties: false },
    ),
  ]);
}

export const ActivePendingRequestSchema = createPendingRequestStatusSchema("pending");
export const ResolvedPendingRequestSchema = createPendingRequestStatusSchema("resolved");
export const ExpiredPendingRequestSchema = createPendingRequestStatusSchema("expired");

export type PendingRequest = Readonly<Static<typeof PendingRequestSchema>>;
export type PendingApprovalDecision = Static<typeof PendingApprovalDecisionSchema>;

const ApprovalResolutionSchema = Type.Object(
  { decision: PendingApprovalDecisionSchema },
  { additionalProperties: false },
);
const UserInputResolutionSchema = Type.Object(
  {
    answers: Type.Record(
      Type.String(),
      Type.Array(Type.String({ minLength: 1 }), { maxItems: 1, minItems: 1 }),
    ),
  },
  { additionalProperties: false },
);
const PermissionApprovalResolutionSchema = Type.Object(
  {
    grantedPermissions: Type.Array(PendingPermissionCategorySchema, {
      maxItems: 2,
      uniqueItems: true,
    }),
    scope: Type.Union([Type.Literal("turn"), Type.Literal("session")]),
  },
  { additionalProperties: false },
);

export const ResolvePendingRequestRequestSchema = Type.Union([
  Type.Object(
    {
      ...PendingRequestResolutionIdentityProperties,
      resolution: ApprovalResolutionSchema,
      type: Type.Literal("command_approval"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...PendingRequestResolutionIdentityProperties,
      resolution: ApprovalResolutionSchema,
      type: Type.Literal("file_change_approval"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...PendingRequestResolutionIdentityProperties,
      resolution: PermissionApprovalResolutionSchema,
      type: Type.Literal("permissions_approval"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...PendingRequestResolutionIdentityProperties,
      resolution: UserInputResolutionSchema,
      type: Type.Literal("user_input"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...PendingRequestResolutionIdentityProperties,
      resolution: McpElicitationResolutionSchema,
      type: Type.Literal("mcp_elicitation"),
    },
    { additionalProperties: false },
  ),
]);

export type ResolvePendingRequestRequest = Readonly<
  Static<typeof ResolvePendingRequestRequestSchema>
>;

export const ResolvePendingRequestResponseSchema = Type.Object(
  { request: PendingRequestSchema },
  { additionalProperties: false },
);

export type ResolvePendingRequestResponse = Readonly<
  Static<typeof ResolvePendingRequestResponseSchema>
>;
export type PermissionApprovalPendingRequest = Readonly<
  Static<typeof PermissionApprovalPendingRequestSchema>
>;
export type PermissionApprovalResolution = Readonly<
  Static<typeof PermissionApprovalResolutionSchema>
>;
