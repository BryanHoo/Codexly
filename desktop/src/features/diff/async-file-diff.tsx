import { useEffect, useState } from "react";
import { useTranslation } from "../../i18n/i18n.js";
import { actionErrorMessage } from "../notifications/action-notifications.js";
import type { AgentFileChange } from "./file-change.js";
import { FileDiffPanel } from "./file-diff-panel.js";

export function AsyncFileDiff({ change, loadDiff }: Readonly<{
  change: AgentFileChange;
  loadDiff: (change: AgentFileChange) => Promise<AgentFileChange>;
}>) {
  const { t } = useTranslation("workbench");
  const [result, setResult] = useState<{ source: AgentFileChange; change?: AgentFileChange; error?: Error }>();
  useEffect(() => {
    let active = true;
    void loadDiff(change).then(
      (loaded) => { if (active) setResult({ source: change, change: loaded }); },
      (error: unknown) => { if (active) setResult({ source: change, error: error instanceof Error ? error : new Error(String(error)) }); },
    );
    // 快速切换文件时只更新当前文件，迟到响应不得覆盖新选择。
    return () => { active = false; };
  }, [change, loadDiff]);
  if (result?.source !== change) return <p className="p-3 text-label text-muted-foreground" role="status">{t("diff.loading")}</p>;
  if (result.error) return <p className="p-3 text-label text-danger" role="alert">{actionErrorMessage(result.error)}</p>;
  return result.change ? <FileDiffPanel change={result.change} /> : null;
}
