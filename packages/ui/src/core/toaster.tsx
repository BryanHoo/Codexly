import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import type { ToastEntry } from "@codexly/frontend-core/toast-store";
import { notificationStore, toast } from "./notifications.js";

const icons = { success: CircleCheck, error: CircleAlert, warning: TriangleAlert, info: Info };

/** 只订阅轻量通知快照；正常文档流负责堆叠，不测量高度、不使用逐帧调度。 */
export function Toaster({
  containerAriaLabel = "通知",
  closeButtonAriaLabel = "关闭通知",
}: Readonly<{ containerAriaLabel?: string; closeButtonAriaLabel?: string }>) {
  const entries = useSyncExternalStore(
    notificationStore.subscribe,
    notificationStore.getSnapshot,
    notificationStore.getSnapshot,
  );
  useEffect(() => {
    const restore = () => {
      notificationStore.sweep();
    };
    const visibility = () => {
      if (document.hidden) notificationStore.releaseInteractions();
      else restore();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", restore);
    window.addEventListener("pageshow", restore);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", restore);
      window.removeEventListener("pageshow", restore);
      notificationStore.dismiss();
    };
  }, []);
  return (
    <section className="app-toaster" aria-label={containerAriaLabel}>
      {entries.map((entry) => (
        <ToastCard key={entry.id} entry={entry} closeLabel={closeButtonAriaLabel} />
      ))}
    </section>
  );
}

function ToastCard({ entry, closeLabel }: Readonly<{ entry: ToastEntry; closeLabel: string }>) {
  const Icon = icons[entry.type];
  return (
    <div
      data-toast=""
      data-type={entry.type}
      data-floating-surface=""
      className="app-toast"
      role={entry.type === "error" ? "alert" : "status"}
      aria-atomic="true"
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") notificationStore.pause(entry.id, "pointer");
      }}
      onPointerLeave={() => {
        notificationStore.resume(entry.id, "pointer");
      }}
      onFocusCapture={() => {
        notificationStore.pause(entry.id, "focus");
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          notificationStore.resume(entry.id, "focus");
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          toast.dismiss(entry.id);
        }
      }}
    >
      <Icon className="app-toast__icon" aria-hidden="true" />
      <div className="app-toast__content">
        <span className="app-toast__message">{entry.message}</span>
        {entry.description ? (
          <span className="app-toast__description">{entry.description}</span>
        ) : null}
      </div>
      {entry.action ? (
        <button
          className="app-toast__action"
          type="button"
          onClick={() => {
            toast.dismiss(entry.id);
            entry.action?.onClick();
          }}
        >
          {entry.action.label}
        </button>
      ) : null}
      <button
        aria-label={closeLabel}
        className="app-toast__close"
        type="button"
        onClick={() => {
          toast.dismiss(entry.id);
        }}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
