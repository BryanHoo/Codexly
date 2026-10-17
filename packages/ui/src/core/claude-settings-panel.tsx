import { validEndpoint, type ConnectionDraft } from "@codexly/frontend-core/claude-configuration";
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
import { ClaudeConnectionFields } from "./claude-connection-fields.js";
import { PersonalizationInstructionsEditor } from "./personalization-instructions-editor.js";

export type ClaudeSettingsClient = Readonly<{
  getEngineProfile: (engine: "claude") => Promise<AgentEngineProfile>;
  configureEngine: (engine: "claude", input: ConfigureCustomProviderRequest) => Promise<unknown>;
  disconnectEngine: (engine: "claude") => Promise<unknown>;
  getClaudeSettings: () => Promise<ClaudeSettings>;
  updateClaudeSettings: (settings: ClaudeSettings) => Promise<ClaudeSettings>;
}>;
/** 三个菜单共享草稿；凭据明确提交，普通偏好使用防抖与串行保存队列。 */
export function ClaudeSettingsPanel({
  client,
  labels,
  Group,
  Field,
  Select,
  section,
  title,
  onConnected,
  continueLabel,
}: ClaudeSettingsControls &
  Readonly<{
    client: ClaudeSettingsClient;
    section: ClaudeSettingsSectionId;
    title: string;
    onConnected?: (() => void) | undefined;
    continueLabel?: string | undefined;
  }>) {
  const [profile, setProfile] = useState<AgentEngineProfile>();
  const [settings, setSettings] = useState<ClaudeSettings>(DEFAULT_CLAUDE_SETTINGS);
  const settingsRef = useRef(settings);
  const baseline = useRef<ClaudeSettings | undefined>(undefined);
  const pendingPatch = useRef<Partial<ClaudeSettings>>({});
  const [connection, setConnection] = useState<ConnectionDraft>({
    baseUrl: "https://api.anthropic.com",
    apiKey: "",
  });
  const connectionRef = useRef(connection);
  const connectionDirty = useRef(false);
  const revision = useRef({ connection: 0, preferences: 0 });
  const [loaded, setLoaded] = useState(false);
  // 能力发现失败不能锁死修复入口；原生设置可读时仍允许重新填写连接。
  const connectionUnavailable = !profile && !loaded;
  const [error, setError] = useState<string>();
  const [profileError, setProfileError] = useState(false);
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
    if (changed.modelAliases) {
      // 映射变化后重新读取真实能力，避免继续展示旧目标模型的思考档位。
      // 配置已落盘，后续能力探测失败不能误报“保存失败”并重复写入。
      const savedRevision = revision.current.preferences;
      void client
        .getEngineProfile("claude")
        .then((refreshed) => {
          if (mounted.current && revision.current.preferences === savedRevision) {
            setProfile(refreshed);
            setProfileError(false);
          }
        })
        .catch(() => {
          if (mounted.current && revision.current.preferences === savedRevision)
            setProfileError(true);
        });
    }
    window.dispatchEvent(new Event("codexly:engine-settings-changed"));
  });
  const provider = useSettingsAutosave<ConnectionDraft>(async (value) => {
    await client.configureEngine("claude", {
      baseUrl: value.baseUrl.trim(),
      authType: "auto",
      ...(value.apiKey.trim() ? { apiKey: value.apiKey.trim() } : {}),
      // 连接表单不再编辑模型白名单；省略字段以保留已有原生模型配置。
    });
    const next = await client.getEngineProfile("claude");
    if (mounted.current) {
      setProfile(next);
      setProfileError(false);
      if (next.connection.state === "connected") onConnected?.();
      else if (onConnected) setError(labels.notConnected);
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
    let loadingSettings = false;
    let loadingProfile = false;
    mounted.current = true;
    const refresh = () => {
      if (!active) return;
      const started = { ...revision.current };
      // 配置读取独立完成，不能等待 SDK 的模型/MCP 探测，否则未连接时无法修复连接。
      if (!loadingSettings) {
        loadingSettings = true;
        void client
          .getClaudeSettings()
          .then((value) => {
            if (!active) return;
            if (
              !Object.keys(pendingPatch.current).length &&
              revision.current.preferences === started.preferences &&
              preferences.queue.status !== "saving"
            ) {
              baseline.current = value;
              settingsRef.current = value;
              setSettings(value);
              setLoaded(true);
              setError(undefined);
            }
          })
          .catch(() => {
            if (active) setError(labels.loadError);
          })
          .finally(() => {
            loadingSettings = false;
          });
      }
      // 个性化不需要模型信息；跨菜单保留草稿，但不启动无关的引擎探测。
      if (section === "claude-personalization" || loadingProfile) return;
      loadingProfile = true;
      void client
        .getEngineProfile("claude")
        .then((value) => {
          if (!active) return;
          setProfileError(false);
          setProfile(value);
          if (
            !connectionDirty.current &&
            revision.current.connection === started.connection &&
            provider.queue.status !== "saving"
          ) {
            connectionRef.current = {
              baseUrl: value.connection.customBaseUrl ?? "https://api.anthropic.com",
              apiKey: "",
            };
            setConnection(connectionRef.current);
            provider.queue.reset(connectionRef.current);
          }
        })
        .catch(() => {
          if (active) setProfileError(true);
        })
        .finally(() => {
          loadingProfile = false;
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
  }, [client, section, reload, labels.loadError, provider.queue, preferences.queue]);
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
    // 凭据只能由明确的保存动作提交，输入和失焦都不能向服务端发送半成品密钥。
  };
  const canReuseKey =
    profile?.connection.mode === "custom" &&
    profile.connection.state === "connected" &&
    profile.connection.customBaseUrl === connection.baseUrl.trim().replace(/\/+$/, "");
  return (
    <section
      id={`settings-panel-${section}`}
      className={section === "claude-personalization" ? "space-y-8" : "space-y-6"}
    >
      {!onConnected ? <h1 className="text-xl font-semibold">{title}</h1> : null}
      {!onConnected && settings.environmentOverrides?.length ? (
        <p
          role="status"
          className="rounded-control border border-separator p-3 text-body-small text-muted-foreground"
        >
          {labels.environmentOverrides} {settings.environmentOverrides.join(", ")}
        </p>
      ) : null}
      {!profile && !loaded && !error ? (
        <p role="status" className="text-body-small text-muted-foreground">
          {labels.loading}
        </p>
      ) : null}
      {section === "claude-provider" ? (
        <ClaudeConnectionFields
          setup={Boolean(onConnected)}
          labels={labels}
          connection={connection}
          disabled={connectionUnavailable}
          busy={provider.status === "saving"}
          canReuseKey={canReuseKey}
          actionLabel={continueLabel ?? labels.saveConnection}
          onChange={updateConnection}
          onSubmit={() => {
            if (!validEndpoint(connection.baseUrl)) {
              setError(labels.invalidEndpoint);
              return;
            }
            if (!connection.apiKey.trim() && !canReuseKey) {
              setError(labels.missingCredential);
              return;
            }
            setError(undefined);
            // 初始化的主按钮负责保存并前进，避免“先保存再继续”的重复操作。
            if (connectionDirty.current) provider.queue.save(connectionRef.current);
            else if (onConnected) {
              void client
                .getEngineProfile("claude")
                .then((value) => {
                  if (!mounted.current) return;
                  if (value.connection.state === "connected") onConnected();
                  else setError(labels.notConnected);
                })
                .catch(() => {
                  if (mounted.current) setError(labels.loadError);
                });
            }
          }}
        />
      ) : (
        <div
          className={section === "claude-personalization" ? "space-y-8" : "space-y-6"}
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
                updatePreferences(
                  {
                    model: next.model,
                    reasoningEffort: next.reasoningEffort,
                    permissionMode: next.permissionMode,
                    ...(next.modelAliases ? { modelAliases: next.modelAliases } : {}),
                  },
                  next.modelAliases !== settings.modelAliases,
                );
              }}
            />
          ) : (
            <>
              <PersonalizationInstructionsEditor
                id="claude-global-instructions"
                label={labels.instructions}
                description={labels.instructionsDescription}
                value={settings.instructions}
                onChange={(event) => {
                  updatePreferences({ instructions: event.currentTarget.value }, true);
                }}
                disabled={!loaded}
                maxLength={32_000}
              />
              <Group title={labels.projectConfiguration}>
                <Field
                  label={labels.projectSettings}
                  description={labels.projectSettingsDescription}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    role="switch"
                    aria-label={labels.projectSettings}
                    aria-checked={settings.loadProjectSettings}
                    className={`h-6 w-10 rounded-pill p-0.5 ${settings.loadProjectSettings ? "bg-brand hover:bg-brand" : "bg-control-hover"}`}
                    onClick={() => {
                      updatePreferences({ loadProjectSettings: !settings.loadProjectSettings });
                    }}
                    disabled={!loaded}
                  >
                    <span
                      className={`block size-5 rounded-full bg-white transition-transform motion-reduce:transition-none ${settings.loadProjectSettings ? "translate-x-2" : "-translate-x-2"}`}
                    />
                  </Button>
                </Field>
              </Group>
            </>
          )}
        </div>
      )}
      {profileError && section !== "claude-personalization" ? (
        <div
          role="status"
          className="flex items-center gap-3 text-body-small text-muted-foreground"
        >
          <p>
            {section === "claude-agent" ? labels.modelsUnavailable : labels.connectionUnavailable}
          </p>
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
        labels={{ ...labels, saving: labels.connecting, saveError: labels.connectionCheckFailed }}
        beforeLeave={() => {
          if (connectionDirty.current) {
            setError(labels.unsavedConnection);
            return Promise.resolve(false);
          }
          return provider.queue.flush();
        }}
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
