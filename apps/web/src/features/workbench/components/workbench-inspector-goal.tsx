import type { AgentGoal } from "@codexly/protocol";
import { Clock3, Pause, Play, Target, Trash2 } from "lucide-react";
import { useState } from "react";

import { i18n } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { InspectorSection } from "./workbench-inspector-sections.js";

function formatGoalDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes === 0
    ? i18n.t("inspector.goalSeconds", { count: remainingSeconds, ns: "conversation" })
    : i18n.t("inspector.goalDuration", {
        minutes,
        ns: "conversation",
        seconds: remainingSeconds,
      });
}

export function GoalSection({
  goal,
  onClear,
  onStatusChange,
}: Readonly<{
  goal: AgentGoal;
  onClear: () => Promise<void>;
  onStatusChange: (status: "active" | "paused") => Promise<void>;
}>) {
  const [pendingAction, setPendingAction] = useState<"clear" | "status" | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const numberFormatter = new Intl.NumberFormat(i18n.language);
  const statusLabel = i18n.t(`inspector.goalStatus.${goal.status}`, { ns: "conversation" });
  const toggleStatus = goal.status === "active" ? "paused" : "active";
  const toggleLabel = i18n.t(
    goal.status === "active" ? "inspector.goalPause" : "inspector.goalResume",
    { ns: "conversation" },
  );
  const runAction = async (action: "clear" | "status", operation: () => Promise<void>) => {
    setPendingAction(action);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Goal mutation failed"));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <InspectorSection
      action={
        <div className="flex items-center gap-0.5">
          {goal.status === "active" || goal.status === "paused" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={toggleLabel}
                  disabled={pendingAction !== null}
                  onClick={() => void runAction("status", () => onStatusChange(toggleStatus))}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  {goal.status === "active" ? (
                    <Pause aria-hidden="true" className="size-3.5" />
                  ) : (
                    <Play aria-hidden="true" className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{toggleLabel}</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={i18n.t("inspector.goalClear", { ns: "conversation" })}
                className="hover:text-danger"
                disabled={pendingAction !== null}
                onClick={() => void runAction("clear", onClear)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{i18n.t("inspector.goalClear", { ns: "conversation" })}</TooltipContent>
          </Tooltip>
        </div>
      }
      icon={<Target className="size-3.5" />}
      title={i18n.t("inspector.goal", { ns: "conversation" })}
    >
      <div className="space-y-2 px-2 py-1">
        <p className="whitespace-pre-wrap break-words text-label leading-5 text-foreground">
          {goal.objective}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
            {statusLabel}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 aria-hidden="true" className="size-3" />
            {formatGoalDuration(goal.timeUsedSeconds)}
          </span>
          <span>
            {goal.tokenBudget === null
              ? i18n.t("inspector.goalTokens", {
                  ns: "conversation",
                  used: numberFormatter.format(goal.tokensUsed),
                })
              : i18n.t("inspector.goalTokenBudget", {
                  budget: numberFormatter.format(goal.tokenBudget),
                  ns: "conversation",
                  used: numberFormatter.format(goal.tokensUsed),
                })}
          </span>
        </div>
        {error === null ? null : (
          <p className="text-caption text-danger" role="alert">
            {i18n.t("inspector.goalMutationFailed", { ns: "conversation" })}
          </p>
        )}
      </div>
    </InspectorSection>
  );
}
