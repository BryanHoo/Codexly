import type { GitBranchError } from "../git-branch.js";
import { MutationHttpError } from "./context.js";

export function toGitBranchHttpError(error: GitBranchError): MutationHttpError {
  switch (error.code) {
    case "SNAPSHOT_MISMATCH":
      return new MutationHttpError("GIT_STATUS_CHANGED", "Git working tree changed", 409, true);
    case "ALREADY_ACTIVE":
      return new MutationHttpError("GIT_BRANCH_ALREADY_ACTIVE", error.message, 409, true);
    case "BRANCH_ALREADY_EXISTS":
      return new MutationHttpError("GIT_BRANCH_ALREADY_EXISTS", error.message, 409, true);
    case "BRANCH_NOT_FOUND":
      return new MutationHttpError("GIT_BRANCH_NOT_FOUND", error.message, 409, true);
    case "INVALID_BRANCH_NAME":
      return new MutationHttpError("GIT_BRANCH_INVALID", error.message, 400, false);
    case "REPOSITORY_READ_ONLY":
      return new MutationHttpError("GIT_REPOSITORY_READ_ONLY", error.message, 409, true);
    case "SWITCH_FAILED":
      return new MutationHttpError("GIT_BRANCH_SWITCH_FAILED", error.message, 502, true);
    case "CREATE_FAILED":
      return new MutationHttpError("GIT_BRANCH_CREATE_FAILED", error.message, 502, true);
  }
}
