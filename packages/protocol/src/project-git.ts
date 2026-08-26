import { Type, type Static } from "@sinclair/typebox";

import {
  ProjectDirectoryPathSchema,
  ProjectFileReferencePathSchema,
  ProjectRelativePathSchema,
  ProjectSchema,
} from "./project-files.js";
import { ProjectRootPathSchema } from "./project-root.js";

export const AgentFileChangeSchema = Type.Object(
  {
    diff: Type.String(),
    kind: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")]),
    // Provider 历史可能保留绝对路径；只有 Project Git API 收紧为相对路径。
    path: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const GitSnapshotSchema = Type.String({ maxLength: 64, minLength: 64, pattern: "^[a-f0-9]{64}$" });
const GitBranchNameSchema = Type.String({ maxLength: 1_024, minLength: 1, pattern: "\\S" });
const GitChildRepositorySchema = Type.String({
  maxLength: 1_024,
  minLength: 1,
  pattern: "^(?!\\.{1,2}$)(?!.*[\\u0000\\r\\n])[^/\\\\]+$",
});
const SelectedGitPathsSchema = Type.Array(ProjectRelativePathSchema, {
  maxItems: 500,
  minItems: 1,
  uniqueItems: true,
});
const CommitMessageSchema = Type.String({ maxLength: 10_000, minLength: 1, pattern: "\\S" });
const ProjectGitFileChangeSchema = Type.Object(
  {
    diff: Type.String(),
    kind: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")]),
    path: ProjectRelativePathSchema,
  },
  { additionalProperties: false },
);

export const ProjectGitStatusSchema = Type.Object(
  {
    baseBranches: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    branch: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    branches: Type.Array(GitBranchNameSchema, { uniqueItems: true }),
    repositoryMode: Type.Union([
      Type.Literal("root"),
      Type.Literal("children"),
      Type.Literal("none"),
    ]),
    snapshot: GitSnapshotSchema,
    staged: Type.Array(ProjectGitFileChangeSchema),
    unstaged: Type.Array(ProjectGitFileChangeSchema),
  },
  { additionalProperties: false },
);

export type ProjectGitStatus = Readonly<Static<typeof ProjectGitStatusSchema>>;

export const ProjectGitStatusQuerySchema = Type.Object(
  {
    includeDiff: Type.Optional(Type.Boolean()),
    repository: Type.Optional(GitChildRepositorySchema),
    rootPath: ProjectRootPathSchema,
  },
  { additionalProperties: false },
);

export type ProjectGitStatusQuery = Readonly<Static<typeof ProjectGitStatusQuerySchema>>;

export const ProjectGitCommitSchema = Type.Object(
  {
    authoredAt: Type.String({ format: "date-time" }),
    authorEmail: Type.String({ maxLength: 320, minLength: 1 }),
    authorName: Type.String({ maxLength: 512, minLength: 1, pattern: "\\S" }),
    sha: Type.String({ maxLength: 64, minLength: 40, pattern: "^[a-f0-9]+$" }),
    title: Type.String({ maxLength: 10_000, minLength: 1, pattern: "\\S" }),
  },
  { additionalProperties: false },
);

export type ProjectGitCommit = Readonly<Static<typeof ProjectGitCommitSchema>>;

const GitHistoryCursorSchema = Type.String({ maxLength: 20, minLength: 1, pattern: "^[0-9]+$" });

export const ProjectGitHistoryQuerySchema = Type.Object(
  {
    cursor: Type.Optional(GitHistoryCursorSchema),
    repository: Type.Optional(ProjectRelativePathSchema),
    rootPath: ProjectRootPathSchema,
  },
  { additionalProperties: false },
);

export type ProjectGitHistoryQuery = Readonly<Static<typeof ProjectGitHistoryQuerySchema>>;

export const ProjectGitHistoryPageSchema = Type.Object(
  {
    branch: Type.Union([GitBranchNameSchema, Type.Null()]),
    commits: Type.Array(ProjectGitCommitSchema, { maxItems: 20 }),
    nextCursor: Type.Union([GitHistoryCursorSchema, Type.Null()]),
    repositories: Type.Array(ProjectRelativePathSchema, { maxItems: 256, uniqueItems: true }),
    repository: Type.Union([ProjectRelativePathSchema, Type.Null()]),
    repositoryMode: Type.Union([Type.Literal("root"), Type.Literal("children")]),
  },
  { additionalProperties: false },
);

export type ProjectGitHistoryPage = Readonly<Static<typeof ProjectGitHistoryPageSchema>>;

const GitCommitShaSchema = Type.String({ maxLength: 64, minLength: 40, pattern: "^[a-f0-9]+$" });
const GitCommitFilesCursorSchema = Type.String({
  maxLength: 20,
  minLength: 1,
  pattern: "^[0-9]+$",
});

export const ProjectGitCommitFilesQuerySchema = Type.Object(
  {
    cursor: Type.Optional(GitCommitFilesCursorSchema),
    repository: Type.Optional(ProjectRelativePathSchema),
    rootPath: ProjectRootPathSchema,
    sha: GitCommitShaSchema,
  },
  { additionalProperties: false },
);
export type ProjectGitCommitFilesQuery = Readonly<Static<typeof ProjectGitCommitFilesQuerySchema>>;

export const ProjectGitCommitFileSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")]),
    path: ProjectRelativePathSchema,
  },
  { additionalProperties: false },
);
export type ProjectGitCommitFile = Readonly<Static<typeof ProjectGitCommitFileSchema>>;

export const ProjectGitCommitFilesPageSchema = Type.Object(
  {
    files: Type.Array(ProjectGitCommitFileSchema, { maxItems: 100 }),
    nextCursor: Type.Union([GitCommitFilesCursorSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ProjectGitCommitFilesPage = Readonly<Static<typeof ProjectGitCommitFilesPageSchema>>;

export const ProjectGitCommitFileDiffQuerySchema = Type.Object(
  {
    path: ProjectRelativePathSchema,
    repository: Type.Optional(ProjectRelativePathSchema),
    rootPath: ProjectRootPathSchema,
    sha: GitCommitShaSchema,
  },
  { additionalProperties: false },
);
export type ProjectGitCommitFileDiffQuery = Readonly<
  Static<typeof ProjectGitCommitFileDiffQuerySchema>
>;

export const ProjectGitCommitFileDiffSchema = Type.Object(
  {
    diff: Type.String({ maxLength: 512 * 1024 }),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ProjectGitCommitFileDiff = Readonly<Static<typeof ProjectGitCommitFileDiffSchema>>;

export const SwitchProjectBranchRequestSchema = Type.Object(
  {
    branch: GitBranchNameSchema,
    expectedSnapshot: GitSnapshotSchema,
  },
  { additionalProperties: false },
);
export type SwitchProjectBranchRequest = Readonly<Static<typeof SwitchProjectBranchRequestSchema>>;

export const CreateProjectBranchRequestSchema = Type.Object(
  {
    branch: GitBranchNameSchema,
    expectedSnapshot: GitSnapshotSchema,
  },
  { additionalProperties: false },
);
export type CreateProjectBranchRequest = Readonly<Static<typeof CreateProjectBranchRequestSchema>>;

export const ProjectGitWorktreeSchema = Type.Object(
  {
    branch: Type.Union([GitBranchNameSchema, Type.Null()]),
    current: Type.Boolean(),
    path: ProjectDirectoryPathSchema,
  },
  { additionalProperties: false },
);
export type ProjectGitWorktree = Readonly<Static<typeof ProjectGitWorktreeSchema>>;

export const ProjectGitWorktreePageSchema = Type.Object(
  { worktrees: Type.Array(ProjectGitWorktreeSchema, { maxItems: 256 }) },
  { additionalProperties: false },
);
export type ProjectGitWorktreePage = Readonly<Static<typeof ProjectGitWorktreePageSchema>>;

export const CreateProjectWorktreeRequestSchema = Type.Object(
  {
    branch: GitBranchNameSchema,
    expectedSnapshot: GitSnapshotSchema,
  },
  { additionalProperties: false },
);
export type CreateProjectWorktreeRequest = Readonly<
  Static<typeof CreateProjectWorktreeRequestSchema>
>;

export const SwitchProjectWorktreeRequestSchema = Type.Object(
  { path: ProjectDirectoryPathSchema },
  { additionalProperties: false },
);
export type SwitchProjectWorktreeRequest = Readonly<
  Static<typeof SwitchProjectWorktreeRequestSchema>
>;

export const ProjectWorktreeMutationResponseSchema = Type.Object(
  { project: ProjectSchema, worktree: ProjectGitWorktreeSchema },
  { additionalProperties: false },
);
export type ProjectWorktreeMutationResponse = Readonly<
  Static<typeof ProjectWorktreeMutationResponseSchema>
>;

export const GenerateCommitMessageRequestSchema = Type.Object(
  {
    expectedSnapshot: GitSnapshotSchema,
    paths: SelectedGitPathsSchema,
    repository: Type.Optional(GitChildRepositorySchema),
  },
  { additionalProperties: false },
);
export type GenerateCommitMessageRequest = Readonly<
  Static<typeof GenerateCommitMessageRequestSchema>
>;

export const GenerateCommitMessageResponseSchema = Type.Object(
  { message: CommitMessageSchema, snapshot: GitSnapshotSchema },
  { additionalProperties: false },
);
export type GenerateCommitMessageResponse = Readonly<
  Static<typeof GenerateCommitMessageResponseSchema>
>;

export const CommitProjectChangesRequestSchema = Type.Object(
  {
    action: Type.Union([Type.Literal("commit"), Type.Literal("commit_and_push")]),
    expectedSnapshot: GitSnapshotSchema,
    message: CommitMessageSchema,
    paths: SelectedGitPathsSchema,
    repository: Type.Optional(GitChildRepositorySchema),
  },
  { additionalProperties: false },
);
export type CommitProjectChangesRequest = Readonly<
  Static<typeof CommitProjectChangesRequestSchema>
>;

export const CommitProjectChangesResponseSchema = Type.Object(
  {
    branch: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    commitSha: Type.String({ maxLength: 64, minLength: 7, pattern: "^[a-f0-9]+$" }),
    message: CommitMessageSchema,
    pushError: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    pushStatus: Type.Union([
      Type.Literal("not_requested"),
      Type.Literal("pushed"),
      Type.Literal("failed"),
      Type.Literal("not_configured"),
    ]),
  },
  { additionalProperties: false },
);
export type CommitProjectChangesResponse = Readonly<
  Static<typeof CommitProjectChangesResponseSchema>
>;

export const ProjectFileTreeEntrySchema = Type.Object(
  {
    path: ProjectRelativePathSchema,
    type: Type.Union([Type.Literal("directory"), Type.Literal("file")]),
  },
  { additionalProperties: false },
);

export type ProjectFileTreeEntry = Readonly<Static<typeof ProjectFileTreeEntrySchema>>;

export const ProjectFileTreeQuerySchema = Type.Object(
  {
    path: Type.Optional(ProjectRelativePathSchema),
    rootPath: Type.Optional(ProjectRootPathSchema),
  },
  { additionalProperties: false },
);

export type ProjectFileTreeQuery = Readonly<Static<typeof ProjectFileTreeQuerySchema>>;

export const ProjectFileTreeSchema = Type.Object(
  {
    entries: Type.Array(ProjectFileTreeEntrySchema),
    path: Type.Union([ProjectRelativePathSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export type ProjectFileTree = Readonly<Static<typeof ProjectFileTreeSchema>>;

export const ProjectFileNameSchema = Type.String({
  maxLength: 255,
  minLength: 1,
  pattern: "^(?!\\.\\.?$)[^/\\\\\\u0000\\r\\n]+$",
});

export const RenameProjectFileRequestSchema = Type.Object(
  {
    name: ProjectFileNameSchema,
    path: ProjectRelativePathSchema,
  },
  { additionalProperties: false },
);
export type RenameProjectFileRequest = Readonly<Static<typeof RenameProjectFileRequestSchema>>;

export const RenameProjectFileResponseSchema = Type.Object(
  { path: ProjectRelativePathSchema },
  { additionalProperties: false },
);
export type RenameProjectFileResponse = Readonly<Static<typeof RenameProjectFileResponseSchema>>;

export const DeleteProjectFileRequestSchema = Type.Object(
  { path: ProjectRelativePathSchema },
  { additionalProperties: false },
);
export type DeleteProjectFileRequest = Readonly<Static<typeof DeleteProjectFileRequestSchema>>;

export const DeleteProjectFileResponseSchema = Type.Object(
  {
    path: ProjectRelativePathSchema,
    status: Type.Literal("deleted"),
  },
  { additionalProperties: false },
);
export type DeleteProjectFileResponse = Readonly<Static<typeof DeleteProjectFileResponseSchema>>;

export const ProjectSourceFileQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.Integer({ minimum: 0 })),
    path: ProjectFileReferencePathSchema,
    rootPath: Type.Optional(ProjectRootPathSchema),
  },
  { additionalProperties: false },
);

export type ProjectSourceFileQuery = Readonly<Static<typeof ProjectSourceFileQuerySchema>>;

export const ProjectSourceFileSchema = Type.Object(
  {
    content: Type.String(),
    nextCursor: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    path: ProjectFileReferencePathSchema,
  },
  { additionalProperties: false },
);

export type ProjectSourceFile = Readonly<Static<typeof ProjectSourceFileSchema>>;
