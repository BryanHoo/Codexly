import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

export function NotFound({
  title,
  description,
  backLabel,
  renderBackLink,
}: Readonly<{
  title: string;
  description: string;
  backLabel: string;
  renderBackLink: (props: { className: string; children: ReactNode }) => ReactNode;
}>) {
  return (
    <main
      className="grid h-full place-items-center bg-window px-6"
      aria-labelledby="not-found-title"
    >
      <section className="w-full max-w-md rounded-surface bg-raised p-6 shadow-panel">
        <p className="mb-2 font-mono text-xs text-warning">404</p>
        <h1 id="not-found-title" className="text-xl font-semibold">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        {renderBackLink({
          className: "mt-5 inline-flex items-center gap-2 text-sm font-medium text-brand-strong",
          children: (
            <>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {backLabel}
            </>
          ),
        })}
      </section>
    </main>
  );
}
