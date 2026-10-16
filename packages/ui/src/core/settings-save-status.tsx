import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SettingsSaveStatus as SaveStatus } from "@codexly/frontend-core/settings-autosave";
import { Button } from "./button.js";

type Feedback = Readonly<{
  status: SaveStatus;
  labels: Readonly<{ saving: string; saved: string; saveError: string; retry: string }>;
  onRetry: () => void;
  beforeLeave?: () => Promise<boolean>;
}>;
const FeedbackContext = createContext<((id: string, value?: Feedback) => void) | null>(null);

/** 页面只显示一个保存提示；失败优先，其次在途保存，防止独立字段的提示相互遮挡。 */
export function SettingsSaveFeedbackProvider({
  children,
  onBack,
}: Readonly<{
  children: ReactNode | ((requestBack: () => void) => ReactNode);
  onBack?: () => void;
}>) {
  const [entries, setEntries] = useState<ReadonlyMap<string, Feedback>>(new Map());
  const leaving = useRef(false);
  const sources = useRef(new Map<string, Feedback>());
  const report = useCallback((id: string, value?: Feedback) => {
    if (value) sources.current.set(id, value);
    else sources.current.delete(id);
    setEntries((current) => {
      const next = new Map(current);
      next.delete(id);
      if (value && value.status !== "idle") next.set(id, value);
      return next;
    });
  }, []);
  const values = [...entries.values()].reverse();
  const active =
    values.find((value) => value.status === "error") ??
    values.find((value) => value.status === "saving") ??
    values[0];
  const requestBack = () => {
    if (leaving.current) return;
    leaving.current = true;
    // 返回动作等待当前表单补存；失败仍留在原页，让重试入口和草稿保持可用。
    void Promise.all(
      [...sources.current.values()].map(
        (source) => source.beforeLeave?.() ?? Promise.resolve(source.status !== "error"),
      ),
    )
      .then((results) => {
        if (results.every(Boolean)) onBack?.();
      })
      .finally(() => {
        leaving.current = false;
      });
  };
  return (
    <FeedbackContext value={report}>
      {typeof children === "function" ? children(requestBack) : children}
      {active ? <SaveStatusView {...active} /> : null}
    </FeedbackContext>
  );
}

/** 提交状态通过上下文汇总；独立渲染的表单也使用相同的浮层、文案和重试按钮。 */
export function SettingsSaveStatus(props: Feedback) {
  const report = useContext(FeedbackContext);
  const id = useId();
  const retryRef = useRef(props.onRetry);
  retryRef.current = props.onRetry;
  const beforeLeaveRef = useRef(props.beforeLeave);
  beforeLeaveRef.current = props.beforeLeave;
  const hasBeforeLeave = props.beforeLeave !== undefined;
  const { status, labels } = props;
  useEffect(() => {
    report?.(id, {
      status,
      labels,
      onRetry: () => {
        retryRef.current();
      },
      ...(hasBeforeLeave
        ? { beforeLeave: () => beforeLeaveRef.current?.() ?? Promise.resolve(true) }
        : {}),
    });
  }, [
    report,
    id,
    status,
    labels.saving,
    labels.saved,
    labels.saveError,
    labels.retry,
    hasBeforeLeave,
  ]);
  useEffect(
    () => () => {
      report?.(id);
    },
    [report, id],
  );
  return report ? null : <SaveStatusView {...props} />;
}
function SaveStatusView({ status, labels, onRetry }: Feedback) {
  if (status === "idle") return null;
  return (
    <div
      role={status === "error" ? "alert" : "status"}
      data-floating-surface
      className={`fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-2.5rem)] items-center gap-3 rounded-control border border-separator bg-panel px-3 py-2 text-body-small shadow-control ${status === "error" ? "text-danger" : "text-muted-foreground"}`}
    >
      <span>
        {status === "error" ? labels.saveError : status === "saving" ? labels.saving : labels.saved}
      </span>
      {status === "error" ? (
        <Button type="button" variant="ghost" className="h-8 px-3" onClick={onRetry}>
          {labels.retry}
        </Button>
      ) : null}
    </div>
  );
}
