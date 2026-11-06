import { classifyProjectFileReference } from "@codexly/frontend-core/project-file-reference";
import { useEffect, useState } from "react";

import { useProjectData } from "../../projects/project-context-state.js";
import type { ProjectFilePopupSearch } from "../project-file-popup.js";
import { ProjectSourcePanel } from "./project-source-panel.js";

export function ProjectFilePopupPage({
  projectId,
  search: initialSearch,
}: Readonly<{ projectId: string; search: ProjectFilePopupSearch }>) {
  const { client } = useProjectData();
  const [search, setSearch] = useState(initialSearch);
  // 命名窗口会被再次打开；路由传入新文件时同步目标，避免继续显示上次内部跳转的文件。
  useEffect(() => {
    setSearch(initialSearch);
  }, [initialSearch]);
  const fileName = search.path.split(/[\\/]/u).at(-1) ?? search.path;

  useEffect(() => {
    document.title = fileName;
  }, [fileName]);

  return (
    <main className="h-full min-h-0 bg-raised">
      <ProjectSourcePanel
        client={client}
        onClose={() => {
          window.close();
        }}
        onOpenProjectFile={(path) => {
          const previewKind = classifyProjectFileReference(path);
          if (previewKind !== "system")
            setSearch({ ...search, path, previewKind, lineNumber: null });
        }}
        previewKind={search.previewKind}
        projectId={projectId}
        reference={{ lineNumber: search.lineNumber, path: search.path }}
        {...(search.rootPath === undefined ? {} : { rootPath: search.rootPath })}
      />
    </main>
  );
}
