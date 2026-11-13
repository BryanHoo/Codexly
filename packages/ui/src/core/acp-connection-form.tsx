import { SettingsDropdown } from "./settings-dropdown.js";
import { useEffect, useRef, useState } from "react";
import type { AcpAgentProfile, AcpProviderPage } from "@codexly/protocol";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { SettingsSaveStatus } from "./settings-save-status.js";

export interface AcpConnectionDraft {
  mode: "custom" | "native";
  providerId: string;
  apiType: string;
  baseUrl: string;
  apiKey: string;
  methodId: string;
}
export function connectionDraft(
  profile: AcpAgentProfile,
  providers: readonly AcpProviderPage["providers"][number][],
): AcpConnectionDraft {
  const provider =
    providers.find((item) => item.providerId === profile.connection?.providerId) ?? providers[0];
  return {
    mode: profile.connection?.baseUrl ? "custom" : "native",
    providerId: provider?.providerId ?? "",
    apiType:
      profile.connection?.apiType ?? provider?.current?.apiType ?? provider?.supported[0] ?? "",
    baseUrl: profile.connection?.baseUrl ?? provider?.current?.baseUrl ?? "",
    apiKey: "",
    methodId:
      profile.authMethods.find(
        (method) => method.id === (profile.authStatus?.kind === "api_key" ? "api-key" : "chat-gpt"),
      )?.id ??
      profile.authMethods.find((method) => method.type !== "terminal")?.id ??
      "",
  };
}
const methodName = (id: string, name: string, chinese: boolean) =>
  id === "api-key"
    ? "API Key"
    : id === "chat-gpt"
      ? "ChatGPT"
      : id === "gateway"
        ? chinese
          ? "自定义 API"
          : "Custom API"
        : name;
const protocolName = (id: string) =>
  ({
    openai: "OpenAI Responses",
    "openai-chat-completions": "OpenAI Chat Completions",
    anthropic: "Anthropic Messages",
    bedrock: "AWS Bedrock",
  })[id] ?? id;

/** 表单只持有本轮输入的密钥；留空复用宿主已有凭据，成功、取消和卸载后不保留秘密。 */
export function AcpConnectionForm({
  profile,
  providers,
  language,
  submit,
  refresh,
}: Readonly<{
  profile: AcpAgentProfile;
  providers: readonly AcpProviderPage["providers"][number][];
  language: "zh-CN" | "en";
  submit: (draft: AcpConnectionDraft, signal: AbortSignal) => Promise<void>;
  refresh: () => Promise<unknown>;
}>) {
  const chinese = language === "zh-CN";
  const [draft, setDraft] = useState(() => connectionDraft(profile, providers));
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [failure, setFailure] = useState("");
  const active = useRef<{ controller?: AbortController; pending?: Promise<boolean> }>({});
  const form = useRef<HTMLFormElement>(null);
  const labels = {
    saving: chinese ? "正在保存连接…" : "Saving connection…",
    saved: chinese ? "连接已保存" : "Connection saved",
    saveError: chinese ? "请先保存或取消连接修改" : "Save or cancel connection changes first",
    retry: chinese ? "重试" : "Retry",
  };
  useEffect(() => () => active.current.controller?.abort(), []);
  useEffect(() => {
    if (!dirty) setDraft(connectionDraft(profile, providers));
  }, [profile, providers, dirty]);
  const change = (patch: Partial<AcpConnectionDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setStatus("idle");
    setFailure("");
  };
  const run = () => {
    if (active.current.pending || !form.current?.reportValidity()) return;
    const controller = new AbortController();
    active.current.controller = controller;
    const input = { ...draft };
    setStatus("saving");
    setFailure("");
    active.current.pending = submit(input, controller.signal)
      .then(
        () => {
          if (controller.signal.aborted) return false;
          setDraft((current) => ({ ...current, apiKey: "" }));
          setDirty(false);
          setStatus("saved");
          return true;
        },
        () => {
          if (!controller.signal.aborted) {
            setStatus("error");
            setFailure(
              chinese
                ? "连接未保存，请检查地址、凭据和网络后重试。"
                : "Connection was not saved. Check the address, credentials and network.",
            );
          }
          return false;
        },
      )
      .finally(() => {
        delete active.current.controller;
        delete active.current.pending;
      });
  };
  const provider = providers.find((item) => item.providerId === draft.providerId);
  const methods = profile.authMethods.filter(
    (method) =>
      method.type !== "terminal" && method.id !== "gateway" && method.id !== "gateway-bedrock",
  );
  const apiKeyMethod = draft.methodId === "api-key";
  const busy = status === "saving";
  const field =
    "grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(0,22rem)] sm:items-center sm:gap-6";
  const configured = profile.connection?.hasCredentials;
  return (
    <form
      ref={form}
      onSubmit={(event) => {
        event.preventDefault();
        run();
      }}
      className="min-w-0"
    >
      <SettingsSaveStatus
        status={status}
        labels={labels}
        onRetry={run}
        beforeLeave={async () => {
          if (draft.mode === "native" && active.current.controller) {
            active.current.controller.abort();
            await active.current.pending;
            return true;
          }
          return active.current.pending ?? true;
        }}
      />
      <fieldset disabled={busy} className="min-w-0 divide-y divide-separator">
        <div className={field}>
          <span className="text-body-small font-medium">
            {chinese ? "配置来源" : "Configuration source"}
          </span>
          <span className="text-body-small text-muted-foreground">
            {profile.connection?.source === "application"
              ? chinese
                ? "应用内配置"
                : "App configuration"
              : chinese
                ? "全局配置"
                : "Global configuration"}
          </span>
        </div>
        <label className={field}>
          <span className="text-body-small font-medium">{chinese ? "连接方式" : "Connection"}</span>
          <SettingsDropdown
            label={chinese ? "连接方式" : "Connection"}
            disabled={busy}
            value={draft.mode}
            onValueChange={(value) => {
              if (value === "custom" || value === "native") change({ mode: value });
            }}
            options={[
              {
                value: "custom",
                label: chinese ? "自定义 API" : "Custom API",
                disabled: providers.length === 0,
              },
              { value: "native", label: chinese ? "账号登录" : "Account sign-in" },
            ]}
          />
        </label>
        {draft.mode === "custom" ? (
          <>
            {providers.length > 1 ? (
              <label className={field}>
                <span className="text-body-small font-medium">
                  {chinese ? "供应商" : "Provider"}
                </span>
                <SettingsDropdown
                  label={chinese ? "供应商" : "Provider"}
                  disabled={busy}
                  value={draft.providerId}
                  onValueChange={(value) => {
                    const selected = providers.find((item) => item.providerId === value);
                    change({
                      providerId: value,
                      apiType: selected?.supported[0] ?? "",
                      baseUrl: selected?.current?.baseUrl ?? "",
                      apiKey: "",
                    });
                  }}
                  options={providers.map((item) => ({
                    value: item.providerId,
                    label: item.providerId,
                  }))}
                />
              </label>
            ) : null}
            <label className={field}>
              <span className="text-body-small font-medium">
                {chinese ? "API 协议" : "API protocol"}
              </span>
              <SettingsDropdown
                label={chinese ? "API 协议" : "API protocol"}
                disabled={busy}
                value={draft.apiType}
                onValueChange={(value) => {
                  change({ apiType: value, apiKey: "" });
                }}
                options={(provider?.supported ?? []).map((type) => ({
                  value: type,
                  label: protocolName(type),
                }))}
              />
            </label>
            <label className={field}>
              <span className="text-body-small font-medium">
                {chinese ? "API 地址" : "API URL"}
              </span>
              <Input
                variant="compact"
                required
                type="url"
                maxLength={16384}
                autoComplete="url"
                value={draft.baseUrl}
                onChange={(event) => {
                  change({ baseUrl: event.target.value });
                }}
                placeholder="https://api.example.com/v1"
              />
            </label>
            <label className={field}>
              <span className="text-body-small font-medium">API Key</span>
              <Input
                variant="compact"
                type="password"
                maxLength={16384}
                autoComplete="new-password"
                value={draft.apiKey}
                onChange={(event) => {
                  change({ apiKey: event.target.value });
                }}
                placeholder={
                  configured
                    ? chinese
                      ? "已配置，留空保留"
                      : "Configured; leave blank to keep"
                    : chinese
                      ? "输入密钥（无鉴权服务可留空）"
                      : "API key (optional for local services)"
                }
              />
            </label>
          </>
        ) : (
          <>
            {methods.length ? (
              <label className={field}>
                <span className="text-body-small font-medium">
                  {chinese ? "登录方式" : "Sign-in method"}
                </span>
                <SettingsDropdown
                  label={chinese ? "登录方式" : "Sign-in method"}
                  disabled={busy}
                  value={draft.methodId}
                  onValueChange={(value) => {
                    change({ methodId: value, apiKey: "" });
                  }}
                  options={methods.map((method) => ({
                    value: method.id,
                    label: methodName(method.id, method.name, chinese),
                  }))}
                />
              </label>
            ) : null}
            {apiKeyMethod ? (
              <label className={field}>
                <span className="text-body-small font-medium">API Key</span>
                <Input
                  variant="compact"
                  required
                  type="password"
                  autoComplete="new-password"
                  maxLength={16384}
                  value={draft.apiKey}
                  onChange={(event) => {
                    change({ apiKey: event.target.value });
                  }}
                  placeholder={chinese ? "输入 API Key" : "Enter API key"}
                />
              </label>
            ) : (
              <p className="py-2 text-label text-muted-foreground">
                {methods.length
                  ? chinese
                    ? "提交后将在运行 Agent 的电脑上打开登录窗口。"
                    : "Submitting opens sign-in on the computer running the agent."
                  : chinese
                    ? "使用本机 CLI 已保存的配置和凭据。"
                    : "Use configuration and credentials saved by the local CLI."}
              </p>
            )}
          </>
        )}
        {failure ? (
          <p role="alert" className="py-2 text-label text-danger">
            {failure}
          </p>
        ) : null}
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2 border-t border-separator py-3">
        {busy && draft.mode === "native" ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              active.current.controller?.abort();
              setStatus("idle");
            }}
          >
            {chinese ? "取消" : "Cancel"}
          </Button>
        ) : null}
        <Button type="submit" disabled={busy || (draft.mode === "custom" && !provider)}>
          {busy
            ? chinese
              ? "正在处理…"
              : "Working…"
            : draft.mode === "custom"
              ? chinese
                ? "保存连接"
                : "Save connection"
              : apiKeyMethod
                ? chinese
                  ? "保存 API Key"
                  : "Save API key"
                : methods.length
                  ? chinese
                    ? "在浏览器中登录"
                    : "Sign in with browser"
                  : chinese
                    ? "使用本机配置"
                    : "Use local configuration"}
        </Button>
        {!busy && !dirty ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              void refresh();
            }}
          >
            {chinese ? "重新检测" : "Detect again"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
