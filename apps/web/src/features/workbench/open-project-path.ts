import { buildProjectFileDownloadUrl } from "@codexly/client";
import type { OpenProjectRequest } from "@codexly/protocol";
import { toast } from "sonner";

import { i18n } from "../../i18n/i18n.js";
import type { CodexlyWorkbenchClient } from "../projects/project-query-contracts.js";

type OpenProjectPathOptions = Readonly<{
  isLanAccess: boolean;
  projectId: string;
  request: OpenProjectRequest;
  rootPath?: string;
  signal?: AbortSignal;
}>;

export async function openProjectPath(
  client: Pick<CodexlyWorkbenchClient, "openProject">,
  { isLanAccess, projectId, request, rootPath, signal }: OpenProjectPathOptions,
): Promise<void> {
  signal?.throwIfAborted();
  if (isLanAccess && request.appId === "system-default" && request.path !== undefined) {
    const path = request.path;
    // 浏览器无法把服务端路径交给访问者的系统应用；只在用户确认下载时传输文件。
    toast.info(i18n.t("openMenu.remoteFileTitle", { ns: "workbench" }), {
      id: JSON.stringify(["remote-file-open", projectId, rootPath, path]),
      description: i18n.t("openMenu.remoteFileDescription", { ns: "workbench" }),
      duration: 12_000,
      action: {
        label: i18n.t("openMenu.download", { ns: "workbench" }),
        onClick: () => {
          const link = document.createElement("a");
          link.href = buildProjectFileDownloadUrl("", projectId, path, rootPath);
          link.download = path.split(/[\\/]/u).at(-1) ?? path;
          // 使用浏览器原生下载，避免把大型 Office、媒体或压缩文件整体读入前端内存。
          document.body.append(link);
          link.click();
          link.remove();
        },
      },
    });
    return;
  }

  await client.openProject(projectId, rootPath, request, signal === undefined ? {} : { signal });
}
