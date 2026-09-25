export function isGitUnavailableError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "GIT_NOT_FOUND";
}

export function shouldRetryGitQuery(failureCount: number, error: Error): boolean {
  return !isGitUnavailableError(error) && failureCount < 1;
}
