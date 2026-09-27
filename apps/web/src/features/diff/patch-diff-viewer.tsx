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
  return <SharedPatchDiffViewer path={change.path} patch={normalizeFileChangePatch(change)} />;
}
