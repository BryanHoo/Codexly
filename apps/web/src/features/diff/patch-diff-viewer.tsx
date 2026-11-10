import { useTranslation } from "../../i18n/i18n.js";
import {
  PatchDiffViewer as SharedPatchDiffViewer,
  configureDiffLanguages,
} from "@codexly/ui/agent/patch-diff-viewer";

import {
  projectLanguageByExtension,
  projectLanguageByFileName,
} from "../../shared/components/agent/code-languages.js";
import type { AgentFileChange } from "./file-change.js";
import { normalizeFileChangePatch } from "./file-change.js";

configureDiffLanguages(projectLanguageByExtension, projectLanguageByFileName);

export default function PatchDiffViewer({ change }: Readonly<{ change: AgentFileChange }>) {
  const { t } = useTranslation("workbench");
  return (
    <SharedPatchDiffViewer
      unavailableLabel={t("diff.previewUnavailable")}
      emptyLabel={t("diff.noTextChanges")}
      path={change.path}
      patch={change.diff === "" ? "" : normalizeFileChangePatch(change)}
    />
  );
}
