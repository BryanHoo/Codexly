import type { AgentPlan } from "@codexly/protocol";
import { ListTodo } from "lucide-react";

import { i18n } from "../../../i18n/i18n.js";
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemIndicator,
  QueueList,
} from "../../../shared/components/agent/queue.js";
import { InspectorSection } from "./workbench-inspector-sections.js";

export function PlanSection({ plan }: Readonly<{ plan: AgentPlan }>) {
  return (
    <InspectorSection
      icon={<ListTodo className="size-3.5" />}
      title={i18n.t("inspector.plan", { ns: "conversation" })}
    >
      <Queue>
        {plan.explanation === null || plan.explanation.trim() === "" ? null : (
          <p className="px-2 pb-1.5 text-caption leading-5 text-muted-foreground">
            {plan.explanation}
          </p>
        )}
        <QueueList>
          {plan.steps.map((step, index) => (
            <QueueItem key={`${String(index)}:${step.text}`} status={step.status}>
              <QueueItemIndicator
                label={i18n.t(`inspector.planStatus.${step.status}`, { ns: "conversation" })}
                status={step.status}
              />
              <QueueItemContent status={step.status}>{step.text}</QueueItemContent>
            </QueueItem>
          ))}
        </QueueList>
      </Queue>
    </InspectorSection>
  );
}
