import { appendQuery, projectPath } from "./http-client-transport.js";

export function buildProjectPdfFileUrl(
  baseUrl: string,
  projectId: string,
  path: string,
  rootPath?: string,
): string {
  const requestPath = appendQuery(`${projectPath(projectId)}/files/pdf`, {
    path,
    rootPath: rootPath === "" ? undefined : rootPath,
  });
  return `${baseUrl.replace(/\/$/u, "")}${requestPath}`;
}
