import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { i18n } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import type { BuildPlanAction } from "./task-timeline-contracts.js";

export function BuildPlanButton({ onBuildPlan }: Readonly<{ onBuildPlan: BuildPlanAction }>) {
  const [isBuilding, setIsBuilding] = useState(false);

  return (
    <Button
      disabled={isBuilding}
      onClick={() => {
        setIsBuilding(true);
        void onBuildPlan().then(
          (started) => {
            if (!started) {
              setIsBuilding(false);
            }
          },
          () => {
            setIsBuilding(false);
          },
        );
      }}
      type="button"
    >
      {isBuilding ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
      {i18n.t("timeline.buildPlan", { ns: "conversation" })}
    </Button>
  );
}
