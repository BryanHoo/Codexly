import { Skeleton } from "@codexly/ui/core/skeleton";
import { useTranslation } from "../../../i18n/i18n.js";
import { lazy, Suspense } from "react";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";
export * from "./workbench-composer-contracts.js";
export * from "../composer-state.js";
const AcpComposer = lazy(() =>
  import("./workbench-acp-composer.js").then((module) => ({
    default: module.WorkbenchAcpComposer,
  })),
);
const LegacyComposer = lazy(() =>
  import("./workbench-legacy-composer.js").then((module) => ({
    default: module.LegacyWorkbenchComposer,
  })),
);
const AcpDraftComposer = lazy(() =>
  import("./workbench-acp-draft-composer.js").then((module) => ({
    default: module.WorkbenchAcpDraftComposer,
  })),
);
export function WorkbenchComposer(props: WorkbenchComposerProps) {
  const { t } = useTranslation("workbench");
  // 两种运行时按任务元数据分别加载，ACP 入口无需下载或查询旧引擎配置模块。
  return (
    <Suspense
      fallback={
        <div role="status" aria-busy="true" aria-label={t("composer.loading")}>
          <Skeleton className="h-24 rounded-panel" />
        </div>
      }
    >
      {props.taskId &&
      (props.capabilities?.runtime === "acp" || (props.runtime?.metadata?.runtime === "acp" || props.runtime?.metadata?.acpSession)) &&
      !props.onCaptureSubmission ? (
        <AcpComposer {...props} taskId={props.taskId} />
      ) : !props.taskId && props.capabilities?.runtime === "acp" && !props.onCaptureSubmission ? (
        <AcpDraftComposer {...props} />
      ) : props.settings ? (
        <LegacyComposer {...props} settings={props.settings} />
      ) : <Skeleton className="h-24 rounded-panel" />}
    </Suspense>
  );
}
