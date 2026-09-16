import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";

export function SearchPagination({
  cursors,
  kind,
  nextCursor,
  setCursors,
}: Readonly<{
  cursors: (string | undefined)[];
  kind: "tasks" | "history";
  nextCursor: string | null | undefined;
  setCursors: Dispatch<SetStateAction<(string | undefined)[]>>;
}>) {
  const { t } = useTranslation("workbench");
  if (cursors.length === 1 && !nextCursor) return null;
  return (
    <div className="mt-2 flex items-center gap-2 border-t border-separator px-3 pt-3 text-caption">
      <span className="mr-auto text-muted-foreground">{t(`globalSearch.${kind}`)}</span>
      <Button
        disabled={cursors.length === 1}
        onClick={() => {
          setCursors((current) => current.slice(0, -1));
        }}
        size="sm"
        variant="ghost"
      >
        <ChevronLeft />
        {t("globalSearch.previous")}
      </Button>
      <Button
        disabled={!nextCursor}
        onClick={() => {
          if (nextCursor) setCursors((current) => [...current, nextCursor]);
        }}
        size="sm"
        variant="ghost"
      >
        {t("globalSearch.next")}
        <ChevronRight />
      </Button>
    </div>
  );
}
