import { History, LoaderCircle } from "lucide-react";

import { Button } from "../core/button.js";

export function TaskTimelinePagination({
  error,
  isLoading,
  onLoad,
  t,
}: Readonly<{
  error: Error | null;
  isLoading: boolean;
  onLoad: () => Promise<void>;
  t: (key: "timeline.loadingOlder" | "timeline.loadOlder" | "timeline.loadOlderError") => string;
}>) {
  return (
    <div className="mx-auto flex w-full max-w-content flex-col items-center gap-2 px-4 pt-5 sm:px-6 sm:pt-6">
      <Button
        disabled={isLoading}
        onClick={() => void onLoad()}
        size="compact"
        type="button"
        variant="ghost"
      >
        {isLoading ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <History aria-hidden="true" />
        )}
        {t(isLoading ? "timeline.loadingOlder" : "timeline.loadOlder")}
      </Button>
      {error === null ? null : (
        <p className="text-label text-danger" role="alert">
          {t("timeline.loadOlderError")}
        </p>
      )}
    </div>
  );
}
