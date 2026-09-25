import { useEffect, useReducer, useRef, useState, type PointerEvent } from "react";
import { PictureInPicture2, X } from "lucide-react";
import { i18n, useTranslation } from "../../i18n/i18n.js";
import { taskWindow as english } from "../../i18n/locales/en/task-window.js";
import { taskWindow as chinese } from "../../i18n/locales/zh-CN/task-window.js";
import { acknowledgeTaskWindow, closeTaskWindow, connectTaskWindow, dragTaskWindow, restoreTaskWindow } from "../../platform/tauri/task-window-client.js";
import { applyTaskWindowPacket, emptyTaskWindowState } from "./task-window-model.js";
import { TaskWindowOutput } from "./task-window-output.js";
import "./task-window.css";

export async function prepareTaskWindow() {
  const params = new URLSearchParams(window.location.search);
  const theme = params.get("theme");
  if (theme === "dark" || theme === "light") document.documentElement.dataset["theme"] = theme;
  const language = params.get("language") === "en" ? "en" : "zh-CN";
  document.documentElement.lang = language;
  // 小窗不初始化整份存储：外观只接收经过原生归一化的两个标量。
  await i18n.changeLanguage(language);
  return TaskWindow;
}

export function TaskWindow() {
  const { t, i18n } = useTranslation("workbench");
  // 专用窗口文案跟随动态入口加载，不扩大工作台首屏词典。
  const labels = (i18n.resolvedLanguage ?? i18n.language).startsWith("zh") ? chinese : english;
  const [state, dispatch] = useReducer(applyTaskWindowPacket, emptyTaskWindowState);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    void connectTaskWindow((packet) => { if (active) dispatch(packet); }).then((cleanup) => {
      if (active) dispose = cleanup;
      else cleanup();
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; dispose?.(); };
  }, [retry]);

  useEffect(() => {
    if (state.sequence === 0) return;
    // 确认放到下一帧：每帧最多接收一个包，后台帧暂停时原生只保留最新有界状态。
    const frame = requestAnimationFrame(() => {
      void acknowledgeTaskWindow(state.sequence).catch(() => setError(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [state.sequence]);

  const run = (action: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError(false);
    void action().catch(() => setError(true)).finally(() => {
      actionLock.current = false;
      setBusy(false);
    });
  };
  const startPointer = (event: PointerEvent<HTMLElement>) => {
    // 内容区留给滚动条和触控板；标题栏、底栏仍可拖窗，内容双击仍可返回任务。
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, .task-window-output")) return;
    pointer.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePointer = (event: PointerEvent<HTMLElement>) => {
    const start = pointer.current;
    if (!start) return;
    if (!(event.buttons & 1)) { pointer.current = null; return; }
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
    pointer.current = null;
    // 达到拖动阈值才进入原生拖拽，保留原地双击；AppKit 接管前必须释放 pointer capture。
    event.currentTarget.releasePointerCapture(event.pointerId);
    void dragTaskWindow().catch(() => setError(true));
  };
  const status = state.status === "running" ? t("pet.status.running")
    : state.status === "waiting" ? t("pet.status.waiting")
    : state.status === "failed" || state.status === "disconnected" ? labels.disconnected
    : state.status === "removed" ? labels.removed : t("pet.status.completed");

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- 原生拖动与双击作用于整个窗体；等价操作提供独立键盘可达按钮。
    <main className="task-window" onPointerDown={startPointer} onPointerMove={movePointer}
      onPointerUp={() => { pointer.current = null; }} onPointerCancel={() => { pointer.current = null; }}
      onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest("button")) run(restoreTaskWindow); }}>
      <header className="task-window-header">
        <span className="task-window-indicator" data-status={state.status} />
        <span className="task-window-title">{state.title || t("taskWindow.open")}</span>
        <button className="task-window-restore" aria-label={labels.restore} title={labels.restore} disabled={busy} onClick={() => run(restoreTaskWindow)}><PictureInPicture2 size={14} /></button>
        <button className="task-window-close" aria-label={t("actions.close")} title={t("actions.close")} disabled={busy} onClick={() => run(closeTaskWindow)}><X size={14} /></button>
      </header>
      {error ? <div className="task-window-error" role="alert">{t("taskWindow.failed")} <button onClick={() => { setError(false); setRetry((value) => value + 1); }}>{t("actions.retry")}</button></div> : null}
      <TaskWindowOutput rows={state.rows} labels={labels} empty={labels.empty} />
      <footer className="task-window-footer">
        <span className="task-window-status">{state.sequence === 0 ? labels.loading : status}</span>
        <span>{labels.hint}</span>
      </footer>
    </main>
  );
}
