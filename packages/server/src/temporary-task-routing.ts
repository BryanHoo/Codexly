import { TEMPORARY_TASK_API_PATH, TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";

export function rewriteTemporaryTaskUrl(url: string): string {
  const queryIndex = url.indexOf("?");
  const pathname = queryIndex < 0 ? url : url.slice(0, queryIndex);
  const query = queryIndex < 0 ? "" : url.slice(queryIndex);
  if (!pathname.startsWith(TEMPORARY_TASK_API_PATH)) {
    return url;
  }
  const suffix = pathname.slice(TEMPORARY_TASK_API_PATH.length);
  const taskRoute = suffix === "/tasks" || suffix.startsWith("/tasks/");
  const attachmentRoute = suffix.startsWith("/attachments/");
  const streamedFileRoute = suffix === "/files/image" || suffix === "/files/source";
  const hostOpenRoute = suffix === "/open" || suffix === "/open-capabilities";
  if (
    !taskRoute &&
    !attachmentRoute &&
    !streamedFileRoute &&
    !hostOpenRoute &&
    suffix !== "/events" &&
    suffix !== "/skills"
  ) {
    return url;
  }
  return `/v1/projects/${TEMPORARY_TASK_SCOPE_ID}${suffix}${query}`;
}
