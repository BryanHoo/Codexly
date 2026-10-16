import {
  ClaudeRuntimeSettingsFields,
  type ClaudeSettingsControls,
} from "./claude-runtime-settings-fields.js";
import type { ClaudeSettingsSectionId } from "@codexly/frontend-core/settings-navigation";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_CLAUDE_SETTINGS,
  type AgentEngineProfile,
  type ClaudeSettings,
  type ConfigureCustomProviderRequest,
} from "@codexly/protocol";
import { useSettingsAutosave } from "./use-settings-autosave.js";
import { SettingsSaveStatus } from "./settings-save-status.js";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { Textarea } from "./textarea.js";
import { Checkbox } from "./checkbox.js";

export type ClaudeSettingsClient = Readonly<{
  getEngineProfile: (engine: "claude") => Promise<AgentEngineProfile>;
  configureEngine: (engine: "claude", input: ConfigureCustomProviderRequest) => Promise<unknown>;
  disconnectEngine: (engine: "claude") => Promise<unknown>;
  getClaudeSettings: () => Promise<ClaudeSettings>;
  updateClaudeSettings: (settings: ClaudeSettings) => Promise<ClaudeSettings>;
}>;
interface ConnectionDraft {
  baseUrl: string;
  apiKey: string;
  models: string;
}
const toolRules = (value: string) => [
  ...new Set(
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  ),
];
const validEndpoint = (value: string) => {
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/** 共用设置控件和保存队列；三个菜单共享草稿，文本防抖保存、选项立即保存。 */
export function ClaudeSettingsPanel({
  client,
  labels,
  Group,
  Field,
  Select,
  section,
  title,
}: ClaudeSettingsControls &
  Readonly<{
    client: ClaudeSettingsClient;
    section: ClaudeSettingsSectionId;
    title: string;
  }>) {
  const [profile, setProfile] = useState<AgentEngineProfile>();
  const [settings, setSettings] = useState<ClaudeSettings>(DEFAULT_CLAUDE_SETTINGS);
  const settingsRef = useRef(settings);
  const baseline = useRef<ClaudeSettings | undefined>(undefined);
  const pendingPatch = useRef<Partial<ClaudeSettings>>({});
  const [connection, setConnection] = useState<ConnectionDraft>({
    baseUrl: "https://api.anthropic.com",
    apiKey: "",
    models: "",
  });
  const connectionRef = useRef(connection);
  const connectionDirty = useRef(false);
  const revision = useRef({ connection: 0, preferences: 0 });
  const [loaded, setLoaded] = useState(false);
  const [allowedTools, setAllowedTools] = useState("");
  const [disallowedTools, setDisallowedTools] = useState("");
  const [error, setError] = useState<string>();
  const [disconnecting, setDisconnecting] = useState(false);
  const [reload, setReload] = useState(0);
  const mounted = useRef(true);
  const preferences = useSettingsAutosave<Partial<ClaudeSettings>>(async (patch) => {
    // 完整配置接口写入前只合并尚未保存的字段，避免覆盖其他菜单和外部修改。
    const changed = Object.fromEntries(
      Object.entries(patch).filter(
        ([key, value]) =>
          JSON.stringify(value) !== JSON.stringify(baseline.current?.[key as keyof ClaudeSettings]),
      ),
    ) as Partial<ClaudeSettings>;
    if (!Object.keys(changed).length) {
      // 选项未变或已撤回输入时移除伪草稿，允许后续焦点刷新同步本机修改。
      pendingPatch.current = Object.fromEntries(
        Object.entries(pendingPatch.current).filter(
          ([key, value]) =>
            JSON.stringify(value) !==
            JSON.stringify(baseline.current?.[key as keyof ClaudeSettings]),
        ),
      );
      return;
    }
    const latest = await client.getClaudeSettings();
    const saved = await client.updateClaudeSettings({ ...latest, ...changed });
    baseline.current = saved;
    pendingPatch.current = Object.fromEntries(
      Object.entries(pendingPatch.current).filter(
        ([key, value]) =>
          JSON.stringify(value) !== JSON.stringify(saved[key as keyof ClaudeSettings]),
      ),
    );
    if (mounted.current) {
      // 在途输入继续保留，使用新基线补存，不能被较早请求的响应覆盖。
      settingsRef.current = { ...saved, ...pendingPatch.current };
      setSettings(settingsRef.current);
    }
    window.dispatchEvent(new Event("codexly:engine-settings-changed"));
  });
  const provider = useSettingsAutosave<ConnectionDraft>(async (value) => {
    await client.configureEngine("claude", {
      baseUrl: value.baseUrl.trim(),
      ...(value.apiKey.trim() ? { apiKey: value.apiKey.trim() } : {}),
      models: toolRules(value.models).map((id) => ({
        id,
        name: profile?.configuredModels?.find((model) => model.id === id)?.name ?? id,
      })),
    });
    const next = await client.getEngineProfile("claude");
    if (mounted.current) {
      setProfile(next);
      if (connectionRef.current === value) {
        connectionDirty.current = false;
        connectionRef.current = { ...value, apiKey: "" };
        setConnection(connectionRef.current);
        provider.queue.reset(connectionRef.current);
      }
    }
    window.dispatchEvent(new Event("codexly:engine-settings-changed"));
  });
  useEffect(() => {
    let active = true;
    let loading = false;
    mounted.current = true;
    const refresh = () => {
      if (!active || loading) return;
      loading = true;
      const started = { ...revision.current };
      void Promise.allSettled([client.getEngineProfile("claude"), client.getClaudeSettings()])
        .then(([profileResult, settingsResult]) => {
          if (!active) return;
          setError(undefined);
          if (
            profileResult.status === "fulfilled" &&
            !connectionDirty.current &&
            revision.current.connection === started.connection &&
            provider.queue.status !== "saving"
          ) {
            const value = profileResult.value;
            setProfile(value);
            connectionRef.current = {
              baseUrl: value.connection.customBaseUrl ?? "https://api.anthropic.com",
              apiKey: "",
              models: (value.configuredModels ?? []).map((model) => model.id).join("\n"),
            };
            setConnection(connectionRef.current);
            provider.queue.reset(connectionRef.current);
          } else if (profileResult.status === "rejected") setError(labels.loadError);
          if (
            settingsResult.status === "fulfilled" &&
            !Object.keys(pendingPatch.current).length &&
            revision.current.preferences === started.preferences &&
            preferences.queue.status !== "saving"
          ) {
            baseline.current = settingsResult.value;
            settingsRef.current = settingsResult.value;
            setSettings(settingsResult.value);
            setAllowedTools(settingsResult.value.allowedTools.join("\n"));
            setDisallowedTools(settingsResult.value.disallowedTools.join("\n"));
            setLoaded(true);
          } else if (settingsResult.status === "rejected") setError(labels.loadError);
        })
        .finally(() => {
          loading = false;
        });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      mounted.current = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client, reload, labels.loadError, provider.queue, preferences.queue]);
  const updatePreferences = (patch: Partial<ClaudeSettings>, text = false) => {
    revision.current.preferences += 1;
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    settingsRef.current = { ...settingsRef.current, ...patch };
    setSettings(settingsRef.current);
    if (text) preferences.queue.schedule(pendingPatch.current);
    else preferences.queue.save(pendingPatch.current);
  };
  const updateConnection = (patch: Partial<ConnectionDraft>) => {
    revision.current.connection += 1;
    connectionRef.current = { ...connectionRef.current, ...patch };
    connectionDirty.current = true;
    setConnection(connectionRef.current);
    // 地址尚未完整时不发送请求；补齐后提交同一份最新凭据与模型草稿。
    if (validEndpoint(connectionRef.current.baseUrl))
      provider.queue.schedule(connectionRef.current);
    else provider.queue.cancelScheduled();
  };
  return (
    <section id={`settings-panel-${section}`} className="space-y-6">
      <h1 className="mb-6 text-xl font-semibold">{title}</h1>
      {!profile && !loaded && !error ? (
        <p role="status" className="text-body-small text-muted-foreground">
          {labels.loading}
        </p>
      ) : null}
      {section === "claude-provider" ? (
        <div
          onBlur={() => {
            if (validEndpoint(connectionRef.current.baseUrl)) void provider.queue.flush();
          }}
        >
          <Group title={labels.connection} description={labels.description}>
            <Field label={labels.endpoint}>
              <Input
                variant="outline"
                className="h-8 sm:h-8 text-body-small"
                type="url"
                aria-label={labels.endpoint}
                value={connection.baseUrl}
                onChange={(event) => {
                  updateConnection({ baseUrl: event.target.value });
                }}
                required
                disabled={!profile || disconnecting}
              />
            </Field>
            <Field label={labels.apiKey}>
              <Input
                variant="outline"
                className="h-8 sm:h-8 text-body-small"
                aria-label={labels.apiKey}
                type="password"
                autoComplete="off"
                value={connection.apiKey}
                onChange={(event) => {
                  updateConnection({ apiKey: event.target.value });
                }}
                placeholder={profile?.connection.state === "connected" ? labels.keepKey : ""}
                disabled={!profile || disconnecting}
              />
            </Field>
            <Field label={labels.customModel} alignStart>
              <Textarea
                className="border border-separator-strong bg-panel text-body-small"
                rows={2}
                aria-label={labels.customModel}
                value={connection.models}
                onChange={(event) => {
                  updateConnection({ models: event.target.value });
                }}
                placeholder={labels.discoverModels}
                disabled={!profile || disconnecting}
              />
            </Field>
            {profile?.connection.mode === "custom" ? (
              <div className="flex justify-end py-3">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={disconnecting || provider.status === "saving"}
                  onClick={() => {
                    setDisconnecting(true);
                    void provider.queue
                      .flush()
                      .then(async (saved) => {
                        if (!saved) return;
                        await client.disconnectEngine("claude");
                        connectionDirty.current = false;
                        if (mounted.current) setReload((value) => value + 1);
                        window.dispatchEvent(new Event("codexly:engine-settings-changed"));
                      })
                      .catch(() => {
                        if (mounted.current) setError(labels.saveError);
                      })
                      .finally(() => {
                        if (mounted.current) setDisconnecting(false);
                      });
                  }}
                >
                  {labels.disconnect}
                </Button>
              </div>
            ) : null}
          </Group>
        </div>
      ) : (
        <div
          className="space-y-6"
          onBlur={() => {
            void preferences.queue.flush();
          }}
        >
          {section === "claude-agent" ? (
            <ClaudeRuntimeSettingsFields
              settings={settings}
              models={profile?.models.data ?? []}
              disabled={!loaded}
              labels={labels}
              Group={Group}
              Field={Field}
              Select={Select}
              onChange={(next) => {
                updatePreferences({
                  model: next.model,
                  reasoningEffort: next.reasoningEffort,
                  permissionMode: next.permissionMode,
                });
              }}
            />
          ) : (
            <>
              <Group title={labels.instructions}>
                <Field label={labels.instructions} alignStart>
                  <Textarea
                    className="border border-separator-strong bg-panel text-body-small"
                    aria-label={labels.instructions}
                    value={settings.instructions}
                    onChange={(event) => {
                      updatePreferences({ instructions: event.target.value }, true);
                    }}
                    disabled={!loaded}
                    rows={5}
                    maxLength={32_000}
                  />
                </Field>
                <Field
                  label={labels.projectSettings}
                  description={labels.projectSettingsDescription}
                >
                  <Checkbox
                    aria-label={labels.projectSettings}
                    checked={settings.loadProjectSettings}
                    onCheckedChange={(value) => {
                      updatePreferences({ loadProjectSettings: value === true });
                    }}
                    disabled={!loaded}
                  />
                </Field>
              </Group>
              <Group title={labels.tools} description={labels.toolsDescription}>
                <Field label={labels.allowedTools} alignStart>
                  <Textarea
                    className="border border-separator-strong bg-panel text-body-small"
                    aria-label={labels.allowedTools}
                    value={allowedTools}
                    onChange={(event) => {
                      setAllowedTools(event.target.value);
                      updatePreferences({ allowedTools: toolRules(event.target.value) }, true);
                    }}
                    disabled={!loaded}
                  />
                </Field>
                <Field label={labels.deniedTools} alignStart>
                  <Textarea
                    className="border border-separator-strong bg-panel text-body-small"
                    aria-label={labels.deniedTools}
                    value={disallowedTools}
                    onChange={(event) => {
                      setDisallowedTools(event.target.value);
                      updatePreferences({ disallowedTools: toolRules(event.target.value) }, true);
                    }}
                    disabled={!loaded}
                  />
                </Field>
              </Group>
            </>
          )}
        </div>
      )}
      {error ? (
        <div role="alert" className="text-body-small text-danger">
          <p>{error}</p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setReload((value) => value + 1);
            }}
          >
            {labels.retry}
          </Button>
        </div>
      ) : null}
      <SettingsSaveStatus
        status={provider.status}
        labels={labels}
        beforeLeave={() => provider.queue.flush()}
        onRetry={() => {
          void provider.queue.retry();
        }}
      />
      <SettingsSaveStatus
        status={preferences.status}
        labels={labels}
        beforeLeave={() => preferences.queue.flush()}
        onRetry={() => {
          void preferences.queue.retry();
        }}
      />
    </section>
  );
}
