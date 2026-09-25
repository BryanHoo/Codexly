import { History, LoaderCircle } from "lucide-react";

import { i18n } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";

export function TaskTimelinePagination({
  error,
  isLoading,
  onLoad,
}: Readonly<{
  error: Error | null;
  isLoading: boolean;
  onLoad: () => Promise<void>;
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
        {i18n.t(isLoading ? "timeline.loadingOlder" : "timeline.loadOlder", {
          ns: "conversation",
        })}
      </Button>
      {error === null ? null : (
        <p className="text-label text-danger" role="alert">
          {i18n.t("timeline.loadOlderError", { ns: "conversation" })}
        </p>
      )}
    </div>
  );
}
