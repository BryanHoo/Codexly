import { EngineSelectionProvider } from "./engine-selection-provider.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, LoaderCircle } from "lucide-react";
import type { AgentEngine } from "@codexly/protocol";
import { ENGINE_SETUP_KEY, readEngineSetup } from "@codexly/frontend-core/engine-setup";
import { browserSetupStorage, type SetupStorage } from "./engine-selection.js";
import {
  recoverEngineSetup,
  prepareSelectedEngines,
} from "@codexly/frontend-core/engine-setup-workflow";
import { Button } from "./button.js";

const copy = {
  zh: {
    choose: "选择编程助手",
    prepare: "正在准备",
    configure: "连接",
    both: "同时使用",
    start: "继续",
    next: "连接并继续",
    finish: "连接并开始使用",
    back: "返回",
    retry: "重试",
    done: "已就绪",
    failed: "准备失败，请重试",
    disconnected: "未连接，请检查连接配置",
    loading: "正在读取配置…",
    loadError: "无法读取已有配置",
    newConnection: "设置新连接",
  },
  en: {
    choose: "Choose your assistant",
    prepare: "Getting ready",
    configure: "Connect",
    both: "Use both",
    start: "Continue",
    next: "Connect and continue",
    finish: "Connect and get started",
    back: "Back",
    retry: "Retry",
    done: "Ready",
    failed: "Couldn't prepare. Try again.",
    disconnected: "Not connected. Check your settings.",
    loading: "Loading settings…",
    loadError: "Couldn't read existing settings",
    newConnection: "Set up a new connection",
  },
};

/** 首次使用只连接服务；既有配置独立恢复，升级或暂时离线都不能重置完成标记。 */
export function EngineSetupGate({
  children,
  storage = browserSetupStorage,
  language,
  claudeSupported = true,
  prepare,
  check,
  discover,
  renderConfiguration,
}: Readonly<{
  children: ReactNode | ((engines: readonly AgentEngine[]) => ReactNode);
  storage?: SetupStorage;
  language: string;
  claudeSupported?: boolean;
  prepare: (engine: AgentEngine, report: (message: string) => void) => Promise<void>;
  check: (engine: AgentEngine) => Promise<boolean>;
  discover: () => Promise<readonly AgentEngine[]>;
  renderConfiguration: (
    engine: AgentEngine,
    actions: Readonly<{ onConnected: () => void; continueLabel: string }>,
  ) => ReactNode;
}>) {
  const labels = language.startsWith("zh") ? copy.zh : copy.en;
  const [saved] = useState(() => readEngineSetup(storage.getItem(ENGINE_SETUP_KEY)));
  const [engines, setEngines] = useState<AgentEngine[]>(
    saved?.engines.filter((engine) => engine === "codex" || claudeSupported) ?? [],
  );
  const [phase, setPhase] = useState<"loading" | "choose" | "prepare" | "configure" | "complete">(
    saved?.complete && engines.length ? "complete" : "loading",
  );
  const [ready, setReady] = useState<AgentEngine[]>([]);
  const [active, setActive] = useState<AgentEngine>();
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string>();
  const [index, setIndex] = useState(0);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const discoverRef = useRef(discover);
  discoverRef.current = discover;
  useEffect(() => {
    let active = true;
    setError(undefined);
    void recoverEngineSetup(saved, () => discoverRef.current())
      .then((result) => {
        if (!active) return;
        const restored =
          result?.engines.filter((engine) => engine === "codex" || claudeSupported) ?? [];
        if (result?.complete && restored.length) {
          storage.setItem(ENGINE_SETUP_KEY, JSON.stringify({ engines: restored, complete: true }));
          setEngines(restored);
          setPhase("complete");
        } else setPhase("choose");
      })
      .catch(() => {
        if (active) setError(labels.loadError);
      });
    return () => {
      active = false;
    };
  }, [saved, storage, claudeSupported, reload, labels.loadError]);
  const begin = async () => {
    if (inFlight.current || !engines.length) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    setPhase("prepare");
    storage.setItem(ENGINE_SETUP_KEY, JSON.stringify({ engines, complete: false }));
    try {
      await prepareSelectedEngines(engines, async (engine) => {
        if (ready.includes(engine)) return;
        setActive(engine);
        setProgress("");
        await prepare(engine, setProgress);
        setReady((current) => [...new Set([...current, engine])]);
      });
      setIndex(0);
      setPhase("configure");
    } catch {
      setError(labels.failed);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const next = async () => {
    const engine = engines[index];
    if (!engine || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (!(await check(engine))) {
        setError(labels.disconnected);
        return;
      }
      if (index + 1 < engines.length) setIndex(index + 1);
      else {
        storage.setItem(ENGINE_SETUP_KEY, JSON.stringify({ engines, complete: true }));
        setPhase("complete");
      }
    } catch {
      setError(labels.disconnected);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  if (phase === "complete")
    return (
      <EngineSelectionProvider engines={engines} storage={storage}>
        {typeof children === "function" ? children(engines) : children}
      </EngineSelectionProvider>
    );
  const engine = engines[index] ?? "claude";
  const title =
    phase === "choose"
      ? labels.choose
      : phase === "configure"
        ? `${labels.configure} ${engine === "claude" ? "Claude" : "Codex"}`
        : phase === "loading"
          ? (error ?? labels.loading)
          : labels.prepare;
  return (
    <main className="flex h-full min-h-0 flex-col overflow-y-auto bg-window px-5 py-10 sm:py-16">
      <div className="m-auto w-full max-w-[30rem] space-y-8">
        <header className="space-y-5 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-surface border border-separator bg-panel shadow-control">
            <img src="/brand/codexly-mark.svg" alt="" className="size-8" />
          </div>
          <div className="space-y-2">
            <p className="text-body-small font-medium text-muted-foreground">Codexly</p>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          </div>
        </header>
        <div className="rounded-surface border border-separator bg-panel p-5 shadow-control sm:p-7">
          {phase === "loading" ? (
            <div className="flex flex-col items-center gap-4 py-5">
              {!error ? (
                <LoaderCircle
                  aria-label={labels.loading}
                  className="size-5 motion-safe:animate-spin text-muted-foreground"
                />
              ) : (
                <>
                  <Button
                    onClick={() => {
                      setReload((value) => value + 1);
                    }}
                  >
                    {labels.retry}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setError(undefined);
                      setPhase("choose");
                    }}
                  >
                    {labels.newConnection}
                  </Button>
                </>
              )}
            </div>
          ) : phase === "choose" ? (
            <div className="space-y-5">
              <div className="space-y-2" role="group" aria-label={labels.choose}>
                {[
                  {
                    title: "Claude",
                    detail: "Anthropic",
                    engines: ["claude"] as AgentEngine[],
                    allowed: claudeSupported,
                  },
                  {
                    title: "Codex",
                    detail: "OpenAI",
                    engines: ["codex"] as AgentEngine[],
                    allowed: true,
                  },
                  {
                    title: labels.both,
                    detail: "Claude + Codex",
                    engines: ["codex", "claude"] as AgentEngine[],
                    allowed: claudeSupported,
                  },
                ]
                  .filter((choice) => choice.allowed)
                  .map((choice) => (
                    <button
                      key={choice.title}
                      type="button"
                      aria-pressed={choice.engines.join() === engines.join()}
                      onClick={() => {
                        setEngines(choice.engines);
                      }}
                      className={`flex w-full items-center justify-between gap-4 rounded-control border px-4 py-4 text-left transition-colors hover:bg-control-hover focus-visible:shadow-focus focus-visible:outline-none ${choice.engines.join() === engines.join() ? "border-brand bg-control" : "border-separator"}`}
                    >
                      <span>
                        <span className="block text-body font-semibold">{choice.title}</span>
                        <span className="mt-1 block text-label text-muted-foreground">
                          {choice.detail}
                        </span>
                      </span>
                      <span
                        className="grid size-5 shrink-0 place-items-center rounded-full border border-separator-strong"
                        aria-hidden="true"
                      >
                        {choice.engines.join() === engines.join() ? (
                          <Check className="size-3.5 text-brand" />
                        ) : null}
                      </span>
                    </button>
                  ))}
              </div>
              <Button
                className="h-10 w-full"
                disabled={!engines.length}
                onClick={() => void begin()}
              >
                {labels.start}
              </Button>
            </div>
          ) : phase === "prepare" ? (
            <div className="space-y-5" aria-live="polite">
              {engines.map((item) => (
                <div key={item} className="flex items-center gap-3 text-body-small">
                  {ready.includes(item) ? (
                    <Check aria-hidden="true" className="size-4 text-brand" />
                  ) : (
                    <LoaderCircle
                      aria-hidden="true"
                      className={`size-4 text-muted-foreground ${active === item && busy ? "motion-safe:animate-spin" : ""}`}
                    />
                  )}
                  <span className="font-medium">{item === "claude" ? "Claude" : "Codex"}</span>
                  <span className="ml-auto text-muted-foreground">
                    {ready.includes(item) ? labels.done : active === item ? progress : ""}
                  </span>
                </div>
              ))}
              {!busy ? (
                <Button className="w-full" onClick={() => void begin()}>
                  {labels.retry}
                </Button>
              ) : null}
            </div>
          ) : (
            <div key={engine}>
              {engines.length > 1 ? (
                <p className="mb-5 text-label text-muted-foreground">
                  {index + 1} / {engines.length}
                </p>
              ) : null}
              {renderConfiguration(engine, {
                onConnected: () => {
                  void next();
                },
                continueLabel: index + 1 < engines.length ? labels.next : labels.finish,
              })}
            </div>
          )}
          {error ? (
            <p role="alert" className="mt-4 text-body-small text-danger">
              {error}
            </p>
          ) : null}
        </div>
        {phase === "configure" || (phase === "prepare" && !busy) ? (
          <div className="text-center">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPhase("choose");
                setError(undefined);
              }}
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
              {labels.back}
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
