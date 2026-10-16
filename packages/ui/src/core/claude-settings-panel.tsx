import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  DEFAULT_CLAUDE_SETTINGS,
  type AgentEngineProfile,
  type ClaudeSettings,
  type ConfigureCustomProviderRequest,
} from "@codexly/protocol";
import type { engineChinese } from "@codexly/frontend-core/engine-labels";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { Textarea } from "./textarea.js";
import { Checkbox } from "./checkbox.js";
import { ClaudePermissionSelector } from "./agent-engine-controls.js";

export type ClaudeSettingsClient = Readonly<{
  getEngineProfile: (engine: "claude") => Promise<AgentEngineProfile>;
  configureEngine: (engine: "claude", input: ConfigureCustomProviderRequest) => Promise<unknown>;
  disconnectEngine: (engine: "claude") => Promise<unknown>;
  getClaudeSettings: () => Promise<ClaudeSettings>;
  updateClaudeSettings: (settings: ClaudeSettings) => Promise<ClaudeSettings>;
}>;
type Labels = Readonly<Record<keyof typeof engineChinese, string>>;
type GroupProps = Readonly<{ children: ReactNode; title: string; description?: string }>;
type FieldProps = Readonly<{
  children: ReactNode;
  label: string;
  description?: string;
  alignStart?: boolean;
}>;

/** 业务表单两端共用，设置页容器由宿主注入，保持现有密度、响应式布局和主题。 */
export function ClaudeSettingsPanel({
  client,
  labels,
  Group,
  Field,
}: Readonly<{
  client: ClaudeSettingsClient;
  labels: Labels;
  Group: ComponentType<GroupProps>;
  Field: ComponentType<FieldProps>;
}>) {
  const id = useId();
  const lock = useRef(false);
  const dirty = useRef({ connection: false, defaults: false });
  const [allowedTools, setAllowedTools] = useState("");
  const [disallowedTools, setDisallowedTools] = useState("");
  const [profile, setProfile] = useState<AgentEngineProfile>();
  const [settings, setSettings] = useState<ClaudeSettings>(DEFAULT_CLAUDE_SETTINGS);
  const [baseUrl, setBaseUrl] = useState("https://api.anthropic.com"),
    [apiKey, setApiKey] = useState(""),
    [customModel, setCustomModel] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    let loading = false;
    const refresh = () => {
      if (!active || loading || lock.current || dirty.current.connection || dirty.current.defaults)
        return;
      loading = true;
      void Promise.allSettled([client.getEngineProfile("claude"), client.getClaudeSettings()])
        .then(([profile, settings]) => {
          if (!active || lock.current || dirty.current.connection || dirty.current.defaults) return;
          setError(undefined);
          if (profile.status === "fulfilled") {
            setProfile(profile.value);
            setCustomModel(
              (profile.value.configuredModels ?? []).map((model) => model.id).join("\n"),
            );
            setBaseUrl(profile.value.connection.customBaseUrl ?? "https://api.anthropic.com");
          } else
            setError(
              profile.reason instanceof Error ? profile.reason.message : "Engine unavailable",
            );
          if (settings.status === "fulfilled") {
            setSettings(settings.value);
            setAllowedTools(settings.value.allowedTools.join("\n"));
            setDisallowedTools(settings.value.disallowedTools.join("\n"));
            setLoaded(true);
          } else
            setError(
              settings.reason instanceof Error ? settings.reason.message : "Settings unavailable",
            );
        })
        .finally(() => {
          loading = false;
        });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    // 回到设置页时按需读取本机变更，不轮询；表单有未保存内容时保留用户输入。
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client]);
  const perform = async (
    operation: () => Promise<void>,
    form: "connection" | "defaults" = "connection",
  ) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await operation();
      dirty.current[form] = false;
      window.dispatchEvent(new Event("codexly:engine-settings-changed"));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Settings update failed");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const tools = (value: string) => [
    ...new Set(
      value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  return (
    <section id="settings-panel-claude" className="space-y-6">
      <h1 className="mb-6 text-xl font-semibold">Claude Agent</h1>
      <form
        onChangeCapture={() => {
          dirty.current.connection = true;
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            await client.configureEngine("claude", {
              baseUrl: baseUrl.trim(),
              ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
              models: [
                ...new Set(
                  customModel
                    .split("\n")
                    .map((id) => id.trim())
                    .filter(Boolean),
                ),
              ].map((id) => ({
                id,
                name: profile?.configuredModels?.find((model) => model.id === id)?.name ?? id,
              })),
            });
            setApiKey("");
            setProfile(await client.getEngineProfile("claude"));
          });
        }}
      >
        <Group title={labels.connection} description={labels.description}>
          <Field label={labels.endpoint}>
            <Input
              aria-label={labels.endpoint}
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value);
              }}
              required
              disabled={busy}
            />
          </Field>
          <Field label="API Key">
            <Input
              aria-label="Claude API Key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
              }}
              placeholder={profile?.connection.state === "connected" ? labels.keepKey : ""}
              disabled={busy}
            />
          </Field>
          <Field label={labels.customModel}>
            <Textarea
              rows={2}
              aria-label={labels.customModel}
              value={customModel}
              onChange={(event) => {
                setCustomModel(event.target.value);
              }}
              placeholder={labels.discoverModels}
              disabled={busy}
            />
          </Field>
          <div className="flex justify-end gap-2 py-3">
            {profile?.connection.mode === "custom" ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void perform(async () => {
                    await client.disconnectEngine("claude");
                    setProfile(await client.getEngineProfile("claude"));
                    setApiKey("");
                  });
                }}
              >
                {labels.disconnect}
              </Button>
            ) : null}
            <Button type="submit" disabled={busy}>
              {busy ? labels.saving : labels.save}
            </Button>
          </div>
        </Group>
      </form>
      <form
        className="space-y-6"
        onChangeCapture={() => {
          dirty.current.defaults = true;
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            setSettings(
              await client.updateClaudeSettings({
                ...settings,
                allowedTools: tools(allowedTools),
                disallowedTools: tools(disallowedTools),
              }),
            );
          }, "defaults");
        }}
      >
        <Group title={labels.defaults}>
          <Field label={labels.model}>
            <Input
              aria-label={labels.model}
              value={settings.model}
              list={`${id}-models`}
              onChange={(event) => {
                setSettings({ ...settings, model: event.target.value });
              }}
              disabled={busy || !loaded}
            />
            <datalist id={`${id}-models`}>
              {profile?.models.data.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </datalist>
          </Field>
          <Field label={labels.effort}>
            <Input
              aria-label={labels.effort}
              value={settings.reasoningEffort}
              placeholder={labels.automatic}
              onChange={(event) => {
                setSettings({
                  ...settings,
                  reasoningEffort: event.target.value as ClaudeSettings["reasoningEffort"],
                });
              }}
              disabled={busy || !loaded}
              list={`${id}-effort`}
            />
            <datalist id={`${id}-effort`}>
              {["low", "medium", "high", "xhigh", "max"].map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </Field>
          <Field label={labels.permissions}>
            <ClaudePermissionSelector
              label={labels.permissions}
              disabled={busy || !loaded}
              value={settings.permissionMode}
              labels={{
                default: labels.permissionDefault,
                acceptEdits: labels.permissionEdits,
                plan: labels.permissionPlan,
                dontAsk: labels.permissionDeny,
                bypassPermissions: labels.permissionBypass,
              }}
              onChange={(permissionMode) => {
                dirty.current.defaults = true;
                setSettings({ ...settings, permissionMode });
              }}
            />
          </Field>
        </Group>
        <Group title={labels.instructions}>
          <Field label={labels.instructions} alignStart>
            <Textarea
              aria-label={labels.instructions}
              value={settings.instructions}
              onChange={(event) => {
                setSettings({ ...settings, instructions: event.target.value });
              }}
              disabled={busy || !loaded}
              rows={5}
            />
          </Field>
          <Field label={labels.projectSettings} description={labels.projectSettingsDescription}>
            <Checkbox
              aria-label={labels.projectSettings}
              checked={settings.loadProjectSettings}
              onCheckedChange={(value) => {
                dirty.current.defaults = true;
                setSettings({ ...settings, loadProjectSettings: value === true });
              }}
              disabled={busy || !loaded}
            />
          </Field>
        </Group>
        <Group title={labels.tools} description={labels.toolsDescription}>
          <Field label={labels.allowedTools} alignStart>
            <Textarea
              aria-label={labels.allowedTools}
              value={allowedTools}
              onChange={(event) => {
                setAllowedTools(event.target.value);
              }}
              disabled={busy || !loaded}
            />
          </Field>
          <Field label={labels.deniedTools} alignStart>
            <Textarea
              aria-label={labels.deniedTools}
              value={disallowedTools}
              onChange={(event) => {
                setDisallowedTools(event.target.value);
              }}
              disabled={busy || !loaded}
            />
          </Field>
        </Group>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !loaded}>
            {busy ? labels.saving : labels.saveDefaults}
          </Button>
        </div>
      </form>
      {error ? (
        <p role="alert" className="break-words text-body-small text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
