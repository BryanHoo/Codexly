import { useTranslation } from "../../i18n/i18n.js";
import { PatchDiffViewer as SharedPatchDiffViewer, configureDiffLanguages } from "@codexly/ui/agent/patch-diff-viewer";

import {
  projectLanguageByExtension,
  projectLanguageByFileName,
} from "../../shared/components/agent/code-languages.js";
import type { AgentFileChange } from "./file-change.js";

configureDiffLanguages(projectLanguageByExtension, projectLanguageByFileName);

export default function PatchDiffViewer({ change }: Readonly<{ change: AgentFileChange }>) {
  // 桌面端预加载当前语言，避免首次挂载时高亮结果无法重放。
  const { t } = useTranslation("workbench");
  return <SharedPatchDiffViewer unavailableLabel={t("diff.previewUnavailable")} path={change.path} patch={change.diff} preloadLanguage />;
}
