import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import {
  DEFAULT_NETWORK_PROXY,
  type NetworkProxySettings,
  type NetworkProxyStatus,
} from "@codexly/protocol";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { Checkbox } from "./checkbox.js";
import { LoadingSkeleton } from "./loading-skeleton.js";
import { LoaderCircle } from "lucide-react";

export const NETWORK_PROXY_LABELS = {
  "zh-CN": {
    title: "网络",
    proxy: "网络代理",
    authentication: "代理认证",
    authenticationDescription: "仅在代理服务器要求认证时填写。",
    restart: "更改将在下次启动时生效。",
    saving: "正在保存…",
    testing: "正在测试…",
    description: "用于应用更新、资源下载及智能体连接。",
    mode: "连接方式",
    system: "跟随系统环境",
    direct: "直接连接",
    custom: "自定义代理",
    protocol: "协议",
    host: "网关地址",
    port: "端口",
    username: "用户名（可选）",
    password: "密码（可选）",
    savedPassword: "已保存，留空保留",
    clear: "清除已保存密码",
    save: "保存代理设置",
    test: "测试连接",
    saved: "已保存，请重启应用或 Web 服务",
    success: "连接成功",
    error: "操作失败，请检查代理配置与网络后重试",
    loading: "正在读取代理设置…",
    retry: "重新读取",
  },
  en: {
    title: "Network",
    proxy: "Network proxy",
    authentication: "Proxy authentication",
    authenticationDescription: "Only required when your proxy server uses authentication.",
    restart: "Changes take effect after restarting.",
    saving: "Saving…",
    testing: "Testing…",
    description: "Used for app updates, downloads and agent connections.",
    mode: "Connection",
    system: "System environment",
    direct: "Direct",
    custom: "Custom proxy",
    protocol: "Protocol",
    host: "Gateway host",
    port: "Port",
    username: "Username (optional)",
    password: "Password (optional)",
    savedPassword: "Saved; leave blank to keep",
    clear: "Clear saved password",
    save: "Save proxy settings",
    test: "Test connection",
    saved: "Saved. Restart the app or Web server",
    success: "Connection successful",
    error: "Operation failed. Check proxy settings and network, then retry",
    loading: "Loading proxy settings…",
    retry: "Reload",
  },
};
type Labels = { [K in keyof typeof NETWORK_PROXY_LABELS.en]: string };
export function NetworkProxySettingsPanel({
  read,
  save,
  test,
  labels,
  components: { Group, Field, Select },
}: Readonly<{
  read: () => Promise<NetworkProxyStatus>;
  save: (input: NetworkProxySettings) => Promise<NetworkProxyStatus>;
  test: (input: NetworkProxySettings) => Promise<unknown>;
  labels: Labels;
  components: {
    Group: ComponentType<{ title: string; description?: string; children: ReactNode }>;
    Field: ComponentType<{ label: string; description?: string; children: ReactNode }>;
    Select: ComponentType<SelectHTMLAttributes<HTMLSelectElement>>;
  };
}>) {
  const [draft, setDraft] = useState<NetworkProxySettings>(DEFAULT_NETWORK_PROXY);
  const [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(false),
    [hasPassword, setHasPassword] = useState(false),
    [message, setMessage] = useState("");
  const [initial, setInitial] = useState<NetworkProxySettings>(DEFAULT_NETWORK_PROXY);
  const [operation, setOperation] = useState<"save" | "test">();
  const [reload, setReload] = useState(0);
  const lock = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void read().then(
      (value) => {
        if (active) {
          const { hasPassword, ...settings } = value;
          setDraft(settings);
          setInitial(settings);
          setHasPassword(hasPassword);
          setLoaded(true);
        }
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [read, reload]);
  async function run(kind: "save" | "test") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setOperation(kind);
    setMessage("");
    try {
      if (kind === "save") {
        const { hasPassword, ...settings } = await save(draft);
        if (mounted.current) {
          setDraft(settings);
          setInitial(settings);
          setHasPassword(hasPassword);
          setMessage(labels.saved);
        }
      } else {
        await test(draft);
        if (mounted.current) setMessage(labels.success);
      }
    } catch {
      if (mounted.current) setMessage(labels.error);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  // 表单只组合宿主已有设置行；颜色、密度和断点跟随应用设置体系，不另造卡片样式。
  function field(key: "host" | "port" | "username" | "password") {
    return (
      <Field label={labels[key]}>
        <Input
          aria-label={labels[key]}
          variant="outline"
          type={key === "password" ? "password" : key === "port" ? "number" : "text"}
          min={key === "port" ? 1 : undefined}
          max={key === "port" ? 65535 : undefined}
          maxLength={key === "host" ? 253 : 1024}
          autoComplete={key === "password" ? "new-password" : "off"}
          value={draft[key] ?? ""}
          placeholder={key === "password" && hasPassword ? labels.savedPassword : undefined}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setMessage("");
            setDraft((current) => ({
              ...current,
              [key]:
                key === "port"
                  ? Number(value)
                  : key === "password" && value === ""
                    ? undefined
                    : value,
            }));
          }}
        />
      </Field>
    );
  }
  return (
    <section id="settings-panel-network" aria-labelledby="network-settings-title">
      <h1 id="network-settings-title" className="mb-6 text-xl font-semibold">
        {labels.title}
      </h1>
      {!loaded ? (
        failed ? (
          <div role="alert" className="space-y-3 text-body-small text-danger">
            <p>{labels.error}</p>
            <Button
              variant="outline"
              onClick={() => {
                setReload((value) => value + 1);
              }}
            >
              {labels.retry}
            </Button>
          </div>
        ) : (
          <LoadingSkeleton variant="settings" label={labels.loading} className="p-0" />
        )
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run("save");
          }}
        >
          <fieldset disabled={busy} className="min-w-0 space-y-6">
            <Group title={labels.proxy} description={labels.description}>
              <Field label={labels.mode}>
                <Select
                  aria-label={labels.mode}
                  value={draft.mode}
                  onChange={(event) => {
                    const mode = event.currentTarget.value as NetworkProxySettings["mode"];
                    setMessage("");
                    setDraft((current) => ({ ...current, mode }));
                  }}
                >
                  {(["system", "direct", "custom"] as const).map((mode) => (
                    <option key={mode} value={mode}>
                      {labels[mode]}
                    </option>
                  ))}
                </Select>
              </Field>
              {draft.mode === "custom" ? (
                <>
                  <Field label={labels.protocol}>
                    <Select
                      aria-label={labels.protocol}
                      value={draft.protocol}
                      onChange={(event) => {
                        const protocol = event.currentTarget
                          .value as NetworkProxySettings["protocol"];
                        setMessage("");
                        setDraft((current) => ({ ...current, protocol }));
                      }}
                    >
                      <option value="http">HTTP</option>
                      <option value="https">HTTPS</option>
                      <option value="socks5">SOCKS5</option>
                    </Select>
                  </Field>
                  {field("host")}
                  {field("port")}
                </>
              ) : null}
            </Group>
            {draft.mode === "custom" ? (
              <Group title={labels.authentication} description={labels.authenticationDescription}>
                {field("username")}
                {field("password")}
                {hasPassword ? (
                  <Field label={labels.clear}>
                    <Checkbox
                      aria-label={labels.clear}
                      checked={draft.password === ""}
                      onCheckedChange={(checked) => {
                        setMessage("");
                        setDraft((current) => ({
                          ...current,
                          password: checked === true ? "" : undefined,
                        }));
                      }}
                    />
                  </Field>
                ) : null}
              </Group>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-separator pt-4">
              <p className="text-label text-muted-foreground">{labels.restart}</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={(event) => {
                    if (event.currentTarget.form?.reportValidity()) void run("test");
                  }}
                >
                  {busy && operation === "test" ? (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                  ) : null}
                  {busy && operation === "test" ? labels.testing : labels.test}
                </Button>
                <Button type="submit" disabled={!dirty}>
                  {busy && operation === "save" ? (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                  ) : null}
                  {busy && operation === "save" ? labels.saving : labels.save}
                </Button>
              </div>
            </div>
          </fieldset>
          {message ? (
            <p role="status" className="mt-3 text-body-small text-muted-foreground">
              {message}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}
