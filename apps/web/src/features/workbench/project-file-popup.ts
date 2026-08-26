import type { MessageFileReference } from "../../shared/components/agent/message.js";
import { classifyProjectFileReference } from "./project-file-reference.js";

export type ProjectFilePopupSearch = Readonly<{
  lineNumber: number | null;
  path: string;
  previewKind: "image" | "source";
  rootPath?: string;
}>;

type OpenProjectFileInNewWindowOptions = Readonly<{
  onOpenSystemDefault: (path: string) => void;
  projectId: string;
  reference: MessageFileReference;
  rootPath?: string;
}>;

const PROJECT_FILE_POPUP_TARGET = "codexly-project-file-popup";
const PROJECT_FILE_POPUP_FEATURES = "popup,width=1100,height=800,resizable=yes,scrollbars=yes";

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
  if (typeof path !== "string" || path.length === 0) {
    throw new TypeError("Project file popup path is required");
  }
  if (previewKind !== "image" && previewKind !== "source") {
    throw new TypeError("Project file popup previewKind is invalid");
  }
  if (rootPath !== undefined && typeof rootPath !== "string") {
    throw new TypeError("Project file popup rootPath is invalid");
  }

  return {
    lineNumber: parseLineNumber(search["lineNumber"]),
    path,
    previewKind,
    ...(rootPath === undefined ? {} : { rootPath }),
  };
}

export function buildProjectFilePopupUrl(
  locationHref: string,
  projectId: string,
  reference: MessageFileReference,
  rootPath?: string,
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
  return url.href;
}

export function openProjectFileInNewWindow({
  onOpenSystemDefault,
  projectId,
  reference,
  rootPath,
}: OpenProjectFileInNewWindowOptions): void {
  if (classifyProjectFileReference(reference.path) === "system") {
    // 不支持内部预览的格式继续交给宿主系统，保持原有打开边界。
    onOpenSystemDefault(reference.path);
    return;
  }

  const url = buildProjectFilePopupUrl(window.location.href, projectId, reference, rootPath);
  // 命名窗口配合明确尺寸，避免浏览器把仅含 popup 提示的请求降级为新标签页。
  window.open(url, PROJECT_FILE_POPUP_TARGET, PROJECT_FILE_POPUP_FEATURES);
}
