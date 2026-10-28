import type { ComponentProps } from "react";

import { cn } from "../lib/utils.js";
import { Button } from "./button.js";
import { Textarea } from "./textarea.js";

function InputGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("group/input-group flex w-full min-w-0 items-center", className)}
      data-slot="input-group"
      role="group"
      {...props}
    />
  );
}

type InputGroupAddonProps = ComponentProps<"div"> &
  Readonly<{ align?: "inline-end" | "inline-start" | "block-start" | "block-end" }>;

function InputGroupAddon({ align = "inline-start", className, ...props }: InputGroupAddonProps) {
  return (
    <div
      className={cn("flex shrink-0 items-center", align.startsWith("block") && "w-full", className)}
      data-align={align}
      data-slot="input-group-addon"
      role="group"
      {...props}
    />
  );
}

function InputGroupTextarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <Textarea
      className={cn("min-w-0 flex-1", className)}
      data-slot="input-group-control"
      variant="embedded"
      {...props}
    />
  );
}

export { InputGroup, InputGroupAddon, InputGroupTextarea };

export function InputGroupButton(props: ComponentProps<typeof Button>) {
  return <Button data-slot="input-group-button" {...props} />;
}
