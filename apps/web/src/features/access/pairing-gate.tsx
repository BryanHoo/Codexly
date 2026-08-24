import { ArrowRight, KeyRound, RotateCw } from "lucide-react";
import { useState, type SubmitEvent } from "react";

import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import { Input } from "../../shared/components/core/input.js";
import type { AccessError } from "./access-context.js";

export function PairingGate({
  error,
  loading,
  onPair,
  onRetry,
  pairing,
}: Readonly<{
  error: AccessError;
  loading: boolean;
  onPair: (code: string) => Promise<void>;
  onRetry: () => void;
  pairing: boolean;
}>) {
  const { t } = useTranslation("common");
  const [code, setCode] = useState("");

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = code.trim();
    if (value.length > 0 && !pairing) {
      void onPair(value);
    }
  };

  return (
    <main className="access-gate grid h-full min-h-0 place-items-center overflow-y-auto bg-window px-5 py-10 text-foreground">
      <section aria-labelledby="access-gate-title" className="w-full max-w-sm">
        <h1 className="mb-8" id="access-gate-title">
          <img
            alt="CodeAgent"
            className="h-10 w-auto"
            height="40"
            src="/brand/codeagent-logo.svg"
            width="165"
          />
        </h1>

        {loading ? (
          <p className="text-body-small text-muted-foreground" role="status">
            {t("access.checking")}
          </p>
        ) : error === "load" ? (
          <div className="space-y-4" role="alert">
            <p className="text-body-small text-danger">{t("access.loadError")}</p>
            <Button onClick={onRetry} size="lg" type="button" variant="secondary">
              <RotateCw aria-hidden="true" className="size-4" />
              {t("actions.retry")}
            </Button>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={submit}>
            <div>
              <p className="text-heading font-semibold">{t("access.pairingTitle")}</p>
              <p className="mt-1 text-body-small text-muted-foreground">
                {t("access.pairingDescription")}
              </p>
            </div>
            <label className="block text-body-small font-medium" htmlFor="access-pairing-code">
              {t("access.codeLabel")}
            </label>
            <div className="flex h-10 items-center rounded-control border border-separator-strong bg-panel focus-within:border-brand focus-within:shadow-focus">
              <KeyRound aria-hidden="true" className="ml-3 size-4 shrink-0 text-muted-foreground" />
              <Input
                aria-label={t("access.codeLabel")}
                autoComplete="current-password"
                className="access-code-input min-w-0 flex-1 bg-transparent px-3 font-mono text-body"
                id="access-pairing-code"
                onChange={(event) => {
                  setCode(event.currentTarget.value);
                }}
                spellCheck={false}
                type="password"
                value={code}
                variant="embedded"
              />
              <Button
                aria-label={t("access.pair")}
                className="mr-1"
                disabled={pairing || code.trim().length === 0}
                title={t("access.pair")}
                type="submit"
                size="icon-compact"
              >
                <ArrowRight aria-hidden="true" className="size-4" />
              </Button>
            </div>
            {pairing ? (
              <p className="text-meta text-muted-foreground" role="status">
                {t("access.pairing")}
              </p>
            ) : null}
          </form>
        )}
      </section>
    </main>
  );
}
