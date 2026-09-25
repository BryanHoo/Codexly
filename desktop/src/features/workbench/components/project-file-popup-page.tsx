import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { TauriWorkspaceClient } from "../../../platform/tauri/workspace-client.js";
import type { ProjectFilePopupSearch } from "../project-file-popup.js";
import { ProjectSourcePanel } from "./project-source-panel.js";

// 独立窗口复用已启动的 Rust Runtime，只保留源码读取所需的最小 IPC 路径。
const projectFileClient = new TauriWorkspaceClient({
  ensureRuntime: () => Promise.resolve(),
});

export function ProjectFilePopupPage({
  projectId,
  search,
}: Readonly<{ projectId: string; search: ProjectFilePopupSearch }>) {
  const fileName = search.path.split(/[\\/]/u).at(-1) ?? search.path;

  useEffect(() => {
    document.title = fileName;
  }, [fileName]);

  return (
    <main className="h-full min-h-0 bg-raised">
      <ProjectSourcePanel
        client={projectFileClient}
        onClose={() => {
          void getCurrentWindow().close();
        }}
        previewKind={search.previewKind}
        projectId={projectId}
        reference={{ lineNumber: search.lineNumber, path: search.path }}
        {...(search.rootPath === undefined ? {} : { rootPath: search.rootPath })}
        {...(search.taskId === undefined ? {} : { taskId: search.taskId })}
      />
    </main>
  );
}
