import { CircleAlert, RefreshCw } from "lucide-react";

import type { ReactNode } from "react";
import { Button } from "./button.js";

type RuntimeUnavailableProps = Readonly<{
  description: ReactNode;
  retryLabel: string;
  title: string;
  onRetry: () => void;
}>;

export function RuntimeUnavailable({
  description,
  onRetry,
  retryLabel,
  title,
}: RuntimeUnavailableProps) {
  return (
    <section
      className="grid min-h-0 flex-1 place-items-center bg-content px-6 py-10 text-center"
      aria-labelledby="runtime-unavailable-title"
    >
      <div className="max-w-md">
        <CircleAlert className="mx-auto size-8 text-danger" aria-hidden="true" strokeWidth={1.6} />
        <h1 id="runtime-unavailable-title" className="mt-4 text-xl font-semibold">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        <Button className="mx-auto mt-5" onClick={onRetry} size="lg" type="button">
          <RefreshCw className="size-4" aria-hidden="true" />
          {retryLabel}
        </Button>
      </div>
    </section>
  );
}
