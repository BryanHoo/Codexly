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
      className="max-w-[30rem] rounded-surface border border-separator bg-panel p-5 sm:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">ChatGPT</h2>
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
        className="mt-2 break-all text-body-small text-muted-foreground"
        role={pending ? "status" : undefined}
      >
        {connected ? (email ?? labels.account) : pending ? labels.waiting : labels.hint}
      </p>
      <Button
        type="button"
        variant={pending || connected ? "outline" : "inverse"}
        className="mt-6 h-10 w-full gap-2 rounded-control"
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
