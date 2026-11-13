import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as createUuid } from "uuid";
import type { AcpProviderConfig, AcpProviderPage, AgentEngine } from "@codexly/protocol";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { LoadingSkeleton } from "./loading-skeleton.js";
import { SettingsSaveStatus } from "./settings-save-status.js";

interface Options {
  signal?: AbortSignal;
  idempotencyKey?: string;
}
export interface AcpProviderSettingsClient {
  getAcpProviders: (engine: AgentEngine, options?: Options) => Promise<AcpProviderPage>;
  configureAcpProvider: (
    engine: AgentEngine,
    config: AcpProviderConfig,
    options?: Options,
  ) => Promise<AcpProviderPage>;
  disableAcpProvider: (
    engine: AgentEngine,
    providerId: string,
    options?: Options,
  ) => Promise<AcpProviderPage>;
}

const labels = {
  "zh-CN": {
    title: "自定义供应商",
    loading: "正在读取供应商…",
    readError: "无法读取供应商配置。",
    retry: "重试",
    empty: "暂无自定义供应商",
    unavailable: "供应商设置接口不可用。",
    disabled: "未配置",
    required: "必需",
    edit: "编辑",
    disable: "停用",
    confirm: "确认停用",
    disableNotice: "停用会移除此供应商保存的请求头。",
    cancel: "取消",
    protocol: "协议",
    url: "服务地址",
    add: "添加请求头",
    header: "请求头名称",
    value: "请求头值",
    remove: "移除",
    replace: "替换现有配置和请求头",
    replaceHint: "已保存的请求头不会显示。请重新填写需要保留的请求头，留空会清除全部请求头。",
    save: "保存",
    saving: "正在保存…",
    saved: "已保存",
    saveError: "保存失败，请重试。",
    invalid: "请检查服务地址和请求头。服务地址必须使用 HTTP 或 HTTPS，请求头名称不能重复。",
    restart: "重启后生效",
  },
  en: {
    title: "Custom providers",
    loading: "Loading providers…",
    readError: "Could not load providers.",
    retry: "Retry",
    empty: "The agent did not advertise any configurable providers.",
    unavailable: "Provider settings are unavailable.",
    disabled: "Not configured",
    required: "Required",
    edit: "Edit",
    disable: "Disable",
    confirm: "Confirm disable",
    disableNotice: "Disabling this provider removes its saved request headers.",
    cancel: "Cancel",
    protocol: "Protocol",
    url: "Service URL",
    add: "Add header",
    header: "Header name",
    value: "Header value",
    remove: "Remove",
    replace: "Replace existing configuration and headers",
    replaceHint:
      "Saved headers are hidden. Re-enter any headers you want to keep. Leaving the list empty clears all headers.",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    saveError: "Could not save. Try again.",
    invalid: "Check the service URL and headers. Use HTTP or HTTPS and unique header names.",
    restart:
      "Restart the app or server to apply the updated provider configuration to all sessions.",
  },
};

type Provider = AcpProviderPage["providers"][number];
interface Header {
  id: string;
  name: string;
  value: string;
}
interface Draft {
  providerId: string;
  apiType: string;
  baseUrl: string;
  headers: Header[];
  replace: boolean;
}

function toConfig(draft: Draft, provider: Provider): AcpProviderConfig | undefined {
  const baseUrl = draft.baseUrl.trim();
  if (provider.current && !draft.replace) return;
  if (!provider.supported.includes(draft.apiType) || baseUrl.length > 16_384) return;
  let url: URL;
  try {
    // 兼容桌面旧 WebView，不依赖 URL.canParse。
    url = new URL(baseUrl);
  } catch {
    return;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password)
    return;
  const names = new Set<string>();
  const entries: [string, string][] = [];
  for (const header of draft.headers) {
    const name = header.name.trim();
    const normalized = name.toLowerCase();
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) ||
      names.has(normalized) ||
      /[\r\n\0]/u.test(header.value)
    )
      return;
    names.add(normalized);
    entries.push([name, header.value]);
  }
  // 值只来自当前编辑草稿，绝不从旧账号、其他供应商或浏览器存储回填。
  return {
    providerId: provider.providerId,
    apiType: draft.apiType,
    baseUrl,
    headers: Object.fromEntries(entries),
  };
}

export function AcpProviderSettings({
  client,
  engine,
  language,
}: Readonly<{
  client: Partial<AcpProviderSettingsClient>;
  engine: AgentEngine;
  language: keyof typeof labels;
}>) {
  const copy = labels[language];
  const cache = useQueryClient();
  const { getAcpProviders, configureAcpProvider, disableAcpProvider } = client;
  const available = !!getAcpProviders && !!configureAcpProvider && !!disableAcpProvider;
  const queryKey = ["acp-providers", engine] as const;
  const query = useQuery({
    queryKey,
    enabled: available,
    queryFn: ({ signal }) =>
      getAcpProviders?.call(client, engine, { signal }) ??
      Promise.reject(new Error(copy.unavailable)),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [draft, setDraft] = useState<Draft>();
  const [disabling, setDisabling] = useState<string>();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [invalid, setInvalid] = useState(false);
  const active = useRef<{ pending?: Promise<boolean>; key?: string }>({});
  const reset = () => {
    setDraft(undefined);
    setDisabling(undefined);
    setInvalid(false);
    setStatus("idle");
    delete active.current.key;
  };
  const change = (next: Draft) => {
    setDraft(next);
    setInvalid(false);
    setStatus("idle");
    delete active.current.key;
  };
  const run = (write: (options: Options) => Promise<AcpProviderPage>) => {
    const scope = active.current;
    if (scope.pending) return;
    const key = (scope.key ??= createUuid());
    setStatus("saving");
    // 先取消旧读取；成功只写完整公开列表，凭据不进入查询或 mutation 缓存。
    scope.pending = cache
      .cancelQueries({ queryKey, exact: true })
      .then(() => write({ idempotencyKey: key }))
      .then(
        (page) => {
          cache.setQueryData(queryKey, page);
          reset();
          setStatus("saved");
          return true;
        },
        () => {
          setStatus("error");
          return false;
        },
      )
      .finally(() => {
        delete scope.pending;
      });
  };
  const submit = () => {
    const provider = query.data?.providers.find(
      (item) => item.providerId === (draft?.providerId ?? disabling),
    );
    if (!provider) return;
    if (draft && configureAcpProvider) {
      const config = toConfig(draft, provider);
      if (!config) {
        setInvalid(true);
        return;
      }
      run((options) => configureAcpProvider.call(client, engine, config, options));
    } else if (disabling && !provider.required && provider.current && disableAcpProvider) {
      run((options) => disableAcpProvider.call(client, engine, provider.providerId, options));
    }
  };
  return (
    <section className="space-y-4">
      <h2 className="text-body-small font-semibold">{copy.title}</h2>
      <SettingsSaveStatus
        status={status}
        labels={copy}
        onRetry={submit}
        beforeLeave={() => active.current.pending ?? Promise.resolve(true)}
      />
      {!available ? (
        <p role="alert">{copy.unavailable}</p>
      ) : query.isError ? (
        <div role="alert">
          <p>{copy.readError}</p>
          <Button type="button" variant="ghost" onClick={() => void query.refetch()}>
            {copy.retry}
          </Button>
        </div>
      ) : !query.data ? (
        <LoadingSkeleton variant="settings" className="p-0" label={copy.loading} />
      ) : (
        <>
          {query.data.restartRequired ? (
            <p role="status" className="text-label text-muted-foreground">
              {copy.restart}
            </p>
          ) : null}
          {query.data.providers.length === 0 ? <p>{copy.empty}</p> : null}
          {query.data.providers.map((provider) => {
            const editing = draft?.providerId === provider.providerId ? draft : undefined;
            const confirming = disabling === provider.providerId;
            const busy = status === "saving";
            return (
              <fieldset
                key={provider.providerId}
                className="min-w-0 space-y-3 rounded-control border border-separator p-3"
                disabled={busy}
              >
                <legend className="break-all px-1 font-medium">{provider.providerId}</legend>
                {provider.required ? <p className="text-label">{copy.required}</p> : null}
                {provider.current ? (
                  <div className="break-all text-label text-muted-foreground">
                    <p>{provider.current.apiType}</p>
                    <p>{provider.current.baseUrl}</p>
                  </div>
                ) : (
                  <p className="text-label text-muted-foreground">{copy.disabled}</p>
                )}
                {editing ? (
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submit();
                    }}
                  >
                    <label className="block space-y-1">
                      <span>{copy.protocol}</span>
                      <select
                        className="block h-9 w-full rounded-control bg-control px-3"
                        value={editing.apiType}
                        onChange={(event) => {
                          change({ ...editing, apiType: event.target.value });
                        }}
                      >
                        {provider.supported.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block space-y-1">
                      <span>{copy.url}</span>
                      <Input
                        type="url"
                        required
                        maxLength={16384}
                        value={editing.baseUrl}
                        onChange={(event) => {
                          change({ ...editing, baseUrl: event.target.value });
                        }}
                      />
                    </label>
                    {editing.headers.map((header) => (
                      <div key={header.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <Input
                          aria-label={copy.header}
                          placeholder={copy.header}
                          required
                          maxLength={256}
                          value={header.name}
                          onChange={(event) => {
                            change({
                              ...editing,
                              headers: editing.headers.map((item) =>
                                item.id === header.id
                                  ? { ...item, name: event.target.value }
                                  : item,
                              ),
                            });
                          }}
                        />
                        <Input
                          aria-label={copy.value}
                          placeholder={copy.value}
                          type="password"
                          autoComplete="off"
                          maxLength={16384}
                          value={header.value}
                          onChange={(event) => {
                            change({
                              ...editing,
                              headers: editing.headers.map((item) =>
                                item.id === header.id
                                  ? { ...item, value: event.target.value }
                                  : item,
                              ),
                            });
                          }}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            change({
                              ...editing,
                              headers: editing.headers.filter((item) => item.id !== header.id),
                            });
                          }}
                        >
                          {copy.remove}
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={editing.headers.length >= 128}
                      onClick={() => {
                        change({
                          ...editing,
                          headers: [...editing.headers, { id: createUuid(), name: "", value: "" }],
                        });
                      }}
                    >
                      {copy.add}
                    </Button>
                    {provider.current ? (
                      <>
                        <p className="text-label text-muted-foreground">{copy.replaceHint}</p>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editing.replace}
                            onChange={(event) => {
                              change({ ...editing, replace: event.target.checked });
                            }}
                          />
                          {copy.replace}
                        </label>
                      </>
                    ) : null}
                    {invalid ? (
                      <p role="alert">{copy.invalid}</p>
                    ) : status === "error" ? (
                      <p role="alert">{copy.saveError}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={!!provider.current && !editing.replace}>
                        {copy.save}
                      </Button>
                      <Button type="button" variant="ghost" onClick={reset}>
                        {copy.cancel}
                      </Button>
                    </div>
                  </form>
                ) : confirming ? (
                  <div className="space-y-2">
                    <p>{copy.disableNotice}</p>
                    {status === "error" ? <p role="alert">{copy.saveError}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={submit}>
                        {copy.confirm}
                      </Button>
                      <Button type="button" variant="ghost" onClick={reset}>
                        {copy.cancel}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!!draft || !!disabling || provider.supported.length === 0}
                      onClick={() => {
                        change({
                          providerId: provider.providerId,
                          baseUrl: provider.current?.baseUrl ?? "",
                          headers: [],
                          replace: false,
                          apiType: provider.supported.includes(provider.current?.apiType ?? "")
                            ? (provider.current?.apiType ?? "")
                            : (provider.supported[0] ?? ""),
                        });
                      }}
                    >
                      {copy.edit}
                    </Button>
                    {!provider.required && provider.current ? (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={!!draft || !!disabling}
                        onClick={() => {
                          reset();
                          setDisabling(provider.providerId);
                        }}
                      >
                        {copy.disable}
                      </Button>
                    ) : null}
                  </div>
                )}
              </fieldset>
            );
          })}
        </>
      )}
    </section>
  );
}
