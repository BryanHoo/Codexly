import { Item, ItemTitle, ItemActions } from "../core/item.js";
import { Check, CircleX, ShieldQuestion } from "lucide-react";
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type Ref,
  type ReactNode,
} from "react";

import { useAgentTranslation, type AgentTranslate } from "./locale.js";
import { Button } from "../core/button.js";

export type ConfirmationState =
  | "approval-requested"
  | "approval-submitting"
  | "approval-resolved"
  | "approval-accepted"
  | "approval-rejected"
  | "approval-expired";

const ConfirmationContext = createContext<ConfirmationState>("approval-requested");

type ConfirmationProps = HTMLAttributes<HTMLElement> & {
  approval: Readonly<{ id: string }>;
  state: ConfirmationState;
};

function findTitle(children: ReactNode, t: AgentTranslate): string {
  for (const child of Children.toArray(children)) {
    if (isValidElement<{ children?: ReactNode }>(child)) {
      return typeof child.props.children === "string"
        ? child.props.children
        : t("agentComponents.approval");
    }
  }
  return t("agentComponents.approval");
}

export function Confirmation({
  approval,
  children,
  className = "",
  state,
  ...props
}: ConfirmationProps) {
  const { t } = useAgentTranslation();
  const title = findTitle(children, t);
  return (
    <ConfirmationContext.Provider value={state}>
      <Item
        variant="outline"
        size="sm"
        role="region"
        aria-label={t("agentComponents.approvalRequest", { title })}
        className={`flex-col items-stretch gap-1.5 px-2.5 py-2 ${className}`}
        data-approval-id={approval.id}
        data-state={state}
        {...props}
      >
        {children}
      </Item>
    </ConfirmationContext.Provider>
  );
}

export function ConfirmationTitle({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <ItemTitle
      className={`flex items-center gap-1.5 text-label font-medium text-foreground ${className}`}
      {...props}
    >
      <ShieldQuestion className="size-3.5 text-muted-foreground" aria-hidden="true" />
      {children}
    </ItemTitle>
  );
}

export function ConfirmationRequest({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`mt-1.5 break-words rounded-control bg-raised px-2 py-1.5 text-label text-foreground ${className}`}
      {...props}
    />
  );
}

export function ConfirmationAccepted({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const state = useContext(ConfirmationContext);
  const { t } = useAgentTranslation();
  if (state !== "approval-accepted") return null;
  return (
    <div
      className={`mt-2 flex items-center gap-1.5 text-label text-muted-foreground ${className}`}
      {...props}
    >
      <Check className="size-3.5" aria-hidden="true" />
      {children ?? t("agentComponents.approvalAccepted")}
    </div>
  );
}

export function ConfirmationRejected({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const state = useContext(ConfirmationContext);
  const { t } = useAgentTranslation();
  if (state !== "approval-rejected" && state !== "approval-expired") return null;
  return (
    <div
      className={`mt-2 flex items-center gap-1.5 text-label text-muted-foreground ${className}`}
      {...props}
    >
      <CircleX className="size-3.5" aria-hidden="true" />
      {children ?? t("agentComponents.approvalRejected")}
    </div>
  );
}

export function ConfirmationActions({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <ItemActions className={`mt-2 border-t border-separator pt-1.5 ${className}`} {...props} />
  );
}

type ConfirmationActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  tone?: "danger" | "neutral" | "primary";
};

export function ConfirmationAction({
  className = "",
  ref,
  tone = "neutral",
  type = "button",
  ...props
}: ConfirmationActionProps) {
  const variant = tone === "danger" ? "destructive" : tone === "primary" ? "default" : "secondary";

  return (
    <Button
      className={className}
      ref={ref}
      size="toolbar"
      type={type}
      variant={variant}
      {...props}
    />
  );
}
