import type { ProjectFileSearchEntry, ProjectOpenApp, ProjectOpenAppKind } from "@codexly/protocol";
import { Code2, ExternalLink, FolderOpen, Terminal, Wrench } from "lucide-react";

type ProjectOpenTargetType = "directory" | "file";

export const projectOpenAppKindIcons = {
  editor: Code2,
  "file-manager": FolderOpen,
  "system-default": ExternalLink,
  terminal: Terminal,
  tool: Wrench,
} as const satisfies Record<ProjectOpenAppKind, typeof Code2>;

export type ProjectOpenContextMenuTarget = Readonly<{
  absolutePath: string;
  path: string;
  relativePath: string;
  reference?: ProjectFileSearchEntry;
  type: ProjectOpenTargetType;
}>;

export function getProjectOpenAppsForTarget(
  apps: readonly ProjectOpenApp[],
  targetType: ProjectOpenTargetType,
): readonly ProjectOpenApp[] {
  return targetType === "file" ? apps : apps.filter((app) => app.kind !== "system-default");
}

export function getProjectFileManagerApp(
  apps: readonly ProjectOpenApp[],
): ProjectOpenApp | undefined {
  return apps.find((app) => app.kind === "file-manager");
}

export function getProjectTargetName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

export function getProjectTargetAbsolutePath(projectRootPath: string, targetPath: string): string {
  const usesWindowsSeparator = projectRootPath.includes("\\") && !projectRootPath.includes("/");
  const separator = usesWindowsSeparator ? "\\" : "/";
  const rootPath = projectRootPath.replace(/[\\/]+$/u, "");
  const relativePath = usesWindowsSeparator
    ? targetPath.replace(/\//gu, "\\").replace(/^\\+/u, "")
    : targetPath.replace(/\\/gu, "/").replace(/^\/+/u, "");

  return relativePath === ""
    ? rootPath || projectRootPath
    : `${rootPath}${separator}${relativePath}`;
}

export function copyProjectTargetText(text: string): void {
  // 菜单关闭不应等待系统剪贴板，失败时保留当前文件树状态。
  void navigator.clipboard.writeText(text).catch(() => undefined);
}
