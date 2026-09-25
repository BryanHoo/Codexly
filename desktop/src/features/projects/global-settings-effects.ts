const TASK_DEFAULT_FIELDS = new Set([
  "approvalPolicy",
  "approvalsReviewer",
  "fastMode",
  "model",
  "reasoningEffort",
  "sandboxMode",
]);

export function shouldRefreshTaskDefaults(changedFields: readonly string[] = []): boolean {
  return changedFields.some((field) => TASK_DEFAULT_FIELDS.has(field));
}
