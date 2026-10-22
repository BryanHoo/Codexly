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
import { toast } from "./notifications.js";

type Feedback = Readonly<{
  status: SaveStatus;
  labels: Readonly<{ saving: string; saved: string; saveError: string; retry: string }>;
  onRetry: () => void;
  beforeLeave?: () => Promise<boolean>;
}>;
const FeedbackContext = createContext<((id: string, value?: Feedback) => void) | null>(null);

/** 汇总保存状态并保留离页保护；视觉反馈统一交给全局通知容器。 */
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
    const pendingSources = [...sources.current.values()];
    // 返回动作等待当前表单补存；失败仍留在原页，让重试入口和草稿保持可用。
    void Promise.all(
      pendingSources.map(
        (source) => source.beforeLeave?.() ?? Promise.resolve(source.status !== "error"),
      ),
    )
      .then((results) => {
        if (results.every(Boolean)) onBack?.();
        else {
          // 错误通知可以按时消失，但返回被阻止时必须重新给出原因和可用的重试入口。
          const failed = pendingSources[results.findIndex((saved) => !saved)];
          if (failed)
            toast.error(failed.labels.saveError, {
              id: "settings-save",
              action: { label: failed.labels.retry, onClick: failed.onRetry },
            });
        }
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
function isEditingText() {
  const element = document.activeElement;
  return (
    element instanceof HTMLElement &&
    (element.isContentEditable ||
      element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement &&
        !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file"].includes(
          element.type,
        )))
  );
}

function SaveStatusView({ status, labels, onRetry }: Feedback) {
  const [editing, setEditing] = useState(false);
  const retry = useRef(onRetry);
  retry.current = onRetry;
  const previous = useRef<SaveStatus>("idle");
  const deferred = useRef(false);
  useEffect(() => {
    const update = () => {
      setEditing(isEditingText());
    };
    const input = () => {
      if (!isEditingText()) return;
      if (
        document.activeElement instanceof HTMLInputElement &&
        document.activeElement.type === "search"
      )
        return;
      // 开始新一轮输入立即撤下旧回执；保存仍照常进行，结果留到编辑器失焦后再通知。
      toast.dismiss("settings-save");
      deferred.current = true;
      setEditing(true);
    };
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    document.addEventListener("input", input);
    update();
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      document.removeEventListener("input", input);
    };
  }, []);
  useEffect(() => {
    if (status === "idle" || status === "saving") {
      previous.current = status;
      if (status === "saving" && !editing && !isEditingText()) {
        // 快速保存无需展示中间态；较慢的请求只更新同一个通知，不叠加“保存中”。
        const timer = setTimeout(() => toast.info(labels.saving, { id: "settings-save" }), 700);
        return () => {
          clearTimeout(timer);
        };
      }
      return;
    }
    if (editing || isEditingText()) {
      if (previous.current !== status) deferred.current = true;
      return;
    }
    if (previous.current === status && !deferred.current) return;
    previous.current = status;
    deferred.current = false;
    if (status === "error") {
      toast.error(labels.saveError, {
        id: "settings-save",
        action: {
          label: labels.retry,
          onClick: () => {
            retry.current();
          },
        },
      });
    } else {
      toast.success(labels.saved, { id: "settings-save" });
    }
  }, [status, editing, labels.saving, labels.saved, labels.saveError, labels.retry]);
  return null;
}
