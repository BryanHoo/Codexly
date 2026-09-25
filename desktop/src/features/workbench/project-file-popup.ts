import type { MessageFileReference } from "../../shared/components/agent/message.js";
import { invoke } from "../../platform/tauri/native-invoke.js";
import { recordFrontendDiagnostic } from "../../platform/tauri/diagnostics.js";
import { classifyProjectFileReference } from "./project-file-reference.js";

export type ProjectFilePopupSearch = Readonly<{
  lineNumber: number | null;
  path: string;
  previewKind: "image" | "source";
  rootPath?: string;
  taskId?: string;
}>;

type OpenProjectFileInNewWindowOptions = Readonly<{
  onOpenSystemDefault: (path: string) => void;
  projectId: string;
  reference: MessageFileReference;
  rootPath?: string;
  taskId?: string;
}>;

function parseLineNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const lineNumber = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(lineNumber) || lineNumber < 1) {
    throw new TypeError("Project file popup lineNumber must be a positive integer");
  }
  return lineNumber;
}

export function parseProjectFilePopupSearch(
  search: Record<string, unknown>,
): ProjectFilePopupSearch {
  const path = search["path"];
  const previewKind = search["previewKind"];
  const rootPath = search["rootPath"];
  const taskId = search["taskId"];
  if (typeof path !== "string" || path.length === 0) {
    throw new TypeError("Project file popup path is required");
  }
  if (previewKind !== "image" && previewKind !== "source") {
    throw new TypeError("Project file popup previewKind is invalid");
  }
  if (rootPath !== undefined && typeof rootPath !== "string") {
    throw new TypeError("Project file popup rootPath is invalid");
  }
  if (taskId !== undefined && typeof taskId !== "string") {
    throw new TypeError("Project file popup taskId is invalid");
  }

  return {
    lineNumber: parseLineNumber(search["lineNumber"]),
    path,
    previewKind,
    ...(rootPath === undefined ? {} : { rootPath }),
    ...(taskId === undefined ? {} : { taskId }),
  };
}

export function buildProjectFilePopupUrl(
  locationHref: string,
  projectId: string,
  reference: MessageFileReference,
  rootPath?: string,
  taskId?: string,
): string {
  const previewKind = classifyProjectFileReference(reference.path);
  if (previewKind === "system") {
    throw new TypeError("System-default files do not have an internal popup URL");
  }

  const url = new URL(`/p/${encodeURIComponent(projectId)}/file`, locationHref);
  url.searchParams.set("path", reference.path);
  url.searchParams.set("previewKind", previewKind);
  if (reference.lineNumber !== null) {
    url.searchParams.set("lineNumber", String(reference.lineNumber));
  }
  if (rootPath !== undefined) {
    url.searchParams.set("rootPath", rootPath);
  }
  if (taskId !== undefined) {
    url.searchParams.set("taskId", taskId);
  }
  url.searchParams.set("window", "project-file");
  return url.href;
}

export function openProjectFileInNewWindow({
  onOpenSystemDefault,
  projectId,
  reference,
  rootPath,
  taskId,
}: OpenProjectFileInNewWindowOptions): void {
  if (classifyProjectFileReference(reference.path) === "system") {
    // 不支持内部预览的格式继续交给宿主系统，保持原有打开边界。
    onOpenSystemDefault(reference.path);
    return;
  }

  const url = buildProjectFilePopupUrl(
    window.location.href,
    projectId,
    reference,
    rootPath,
    taskId,
  );
  const parsedUrl = new URL(url);
  const route = `${parsedUrl.pathname.replace(/^\/+/u, "")}${parsedUrl.search}`;
  // Tauri WebView 不处理浏览器 popup，统一由受限原生命令创建独立窗口。
  void invoke<void>("open_project_file_window", { route }).catch((error: unknown) => {
    recordFrontendDiagnostic({
      context: {},
      errorMessage: error instanceof Error ? error.message : String(error),
      event: "project_file_window_open_failed",
      level: "error",
      stack: error instanceof Error ? (error.stack ?? null) : null,
    });
  });
}
