import { useEffect } from "react";

import { useProjectData } from "../../projects/project-context-state.js";
import type { ProjectFilePopupSearch } from "../project-file-popup.js";
import { ProjectSourcePanel } from "./project-source-panel.js";

export function ProjectFilePopupPage({
  projectId,
  search,
}: Readonly<{ projectId: string; search: ProjectFilePopupSearch }>) {
  const { client } = useProjectData();
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
        previewKind={search.previewKind}
        projectId={projectId}
        reference={{ lineNumber: search.lineNumber, path: search.path }}
        {...(search.rootPath === undefined ? {} : { rootPath: search.rootPath })}
      />
    </main>
  );
}
