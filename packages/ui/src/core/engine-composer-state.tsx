import { useSelectedEngines } from "./engine-selection.js";
import { useCallback, useEffect, useState } from "react";
import type { AgentEngine, AgentEngineProfile } from "@codexly/protocol";
import { resolveComposerEngine } from "@codexly/frontend-core/engine-composer";

function readDraftEngine(scope: string, fallback: AgentEngine = "codex"): AgentEngine {
  try {
    const saved = localStorage.getItem(`codexly:engine-draft:v1:${scope}`);
    return saved === "claude" || saved === "codex" ? saved : fallback;
  } catch {
    return fallback;
  }
}

/** 两端复用草稿选择与异步隔离；宿主只提供各自 HTTP/IPC 的能力读取函数。 */
export function useEngineComposerState(
  input: Readonly<{
    scope: string;
    profileScope?: string;
    cachedProfile?: AgentEngineProfile | undefined;
    invalidateProfile?: () => void;
    taskId: string | undefined;
    taskEngine: AgentEngine | undefined;
    initialEngine?: AgentEngine;
    codexConfigured: boolean | undefined;
    claudeSupported?: boolean;
    load: (engine: AgentEngine) => Promise<AgentEngineProfile>;
  }>,
) {
  const selectedEngines = useSelectedEngines();
  const preferredEngine = selectedEngines?.[0] ?? "codex";
  const [selection, setSelection] = useState(() => ({
    scope: input.scope,
    engine: input.initialEngine ?? readDraftEngine(input.scope, preferredEngine),
  }));
  const [submitting, setSubmitting] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => {
      input.invalidateProfile?.();
      setRevision((value) => value + 1);
    };
    window.addEventListener("codexly:engine-settings-changed", refresh);
    return () => {
      window.removeEventListener("codexly:engine-settings-changed", refresh);
    };
  }, [input.invalidateProfile]);
  const [result, setResult] = useState<{
    key: string;
    profile?: AgentEngineProfile;
    error?: Error;
  }>();
  const draftEngine =
    selection.scope === input.scope
      ? selection.engine
      : (input.initialEngine ?? readDraftEngine(input.scope, preferredEngine));
  const claudeSupported =
    input.claudeSupported !== false && (selectedEngines?.includes("claude") ?? true);
  const codexEnabled = selectedEngines?.includes("codex") ?? true;
  const key = JSON.stringify([input.profileScope ?? input.scope, claudeSupported, revision]);
  const profile = result?.key === key ? result.profile : input.cachedProfile;
  const claudeConfigured = claudeSupported && profile?.connection.state === "connected";
  const codexConfigured = codexEnabled && input.codexConfigured === true;
  const resolvedEngine = resolveComposerEngine(
    input.taskId,
    input.taskEngine === undefined ? undefined : { engine: input.taskEngine },
    draftEngine,
    { codex: codexConfigured, claude: claudeConfigured },
    input.initialEngine !== undefined ||
      (input.taskId === undefined && claudeSupported && profile === undefined),
  );
  // 配置发现期间，新草稿仍使用已启用的引擎；历史任务和定时任务保留原引擎。
  const engine =
    input.taskId === undefined &&
    input.initialEngine === undefined &&
    selectedEngines &&
    !selectedEngines.includes(resolvedEngine)
      ? preferredEngine
      : resolvedEngine;
  useEffect(() => {
    if (!claudeSupported) return;
    let active = true;
    // 只探测明确启用的引擎；设置页启用成功后再发现配置，禁止后台探测触发隐式下载。
    void input.load("claude").then(
      (profile) => {
        if (active) setResult({ key, profile });
      },
      (error: unknown) => {
        if (active)
          setResult({
            key,
            error: error instanceof Error ? error : new Error("Engine unavailable"),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [claudeSupported, input.load, key]);
  const select = useCallback(
    (engine: AgentEngine) => {
      if (input.taskId !== undefined || submitting || !codexConfigured || !claudeConfigured) return;
      setSelection({ scope: input.scope, engine });
      try {
        localStorage.setItem(`codexly:engine-draft:v1:${input.scope}`, engine);
      } catch {
        /* 存储不可用时仍保留当前草稿内的选择。 */
      }
    },
    [input.scope, input.taskId, submitting, codexConfigured, claudeConfigured],
  );
  return {
    engine,
    codexConfigured,
    claudeConfigured,
    select,
    locked: input.taskId !== undefined,
    submitting,
    setSubmitting,
    profile,
    error: result?.key === key ? result.error : undefined,
    // 引擎归属确认后，已就绪的 Codex 不再等待 Claude；归属未确定时仍阻止误用引擎。
    pending:
      (codexEnabled && input.taskId === undefined && input.codexConfigured === undefined) ||
      (claudeSupported &&
        profile === undefined &&
        result?.key !== key &&
        (engine === "claude" || !codexConfigured)),
    refresh: () => {
      input.invalidateProfile?.();
      setRevision((value) => value + 1);
    },
  };
}
