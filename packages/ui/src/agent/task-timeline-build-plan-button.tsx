import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "../core/button.js";

export function BuildPlanButton({
  label,
  onBuildPlan,
}: Readonly<{ label: string; onBuildPlan: () => Promise<boolean> }>) {
  const [isBuilding, setIsBuilding] = useState(false);

  return (
    <Button
      disabled={isBuilding}
      onClick={() => {
        setIsBuilding(true);
        // 启动成功后保持禁用，直到时间线随新的计划执行状态更新。
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
      {label}
    </Button>
  );
}
