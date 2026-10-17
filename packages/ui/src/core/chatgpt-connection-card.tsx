import { ArrowUpRight, CheckCircle2, LoaderCircle } from "lucide-react";
import { Button } from "./button.js";

/** 两端共用官方登录呈现；浏览器打开、取消和退出仍由宿主处理。 */
export function ChatGptConnectionCard({
  connected,
  pending,
  busy,
  email,
  labels,
  onLogin,
  onCancel,
  onLogout,
}: Readonly<{
  connected: boolean;
  pending: boolean;
  busy: boolean;
  email?: string | null | undefined;
  labels: Readonly<{
    account: string;
    hint: string;
    waiting: string;
    connected: string;
    login: string;
    cancel: string;
    logout: string;
  }>;
  onLogin: () => void;
  onCancel: () => void;
  onLogout: () => void;
}>) {
  return (
    <section
      aria-label={labels.account}
      className="flex flex-col items-start gap-4 border-y border-separator py-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-body-small font-medium">{labels.account}</h2>
          {connected ? (
            <span
              className="inline-flex items-center gap-1.5 text-label text-muted-foreground"
              role="status"
            >
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              {labels.connected}
            </span>
          ) : null}
        </div>
        <p
          className="break-all text-body-small text-muted-foreground"
          role={pending ? "status" : undefined}
        >
          {connected ? (email ?? labels.account) : pending ? labels.waiting : labels.hint}
        </p>
      </div>
      <Button
        type="button"
        variant={pending || connected ? "outline" : "inverse"}
        className="gap-2"
        disabled={busy}
        onClick={pending ? onCancel : connected ? onLogout : onLogin}
      >
        {busy ? (
          <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
        ) : null}
        {pending ? labels.cancel : connected ? labels.logout : labels.login}
        {!pending && !connected && !busy ? (
          <ArrowUpRight aria-hidden="true" className="size-4" />
        ) : null}
      </Button>
    </section>
  );
}
