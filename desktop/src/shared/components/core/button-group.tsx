import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.js";

type ButtonGroupProps = ComponentProps<"div"> &
  Readonly<{
    orientation?: "horizontal" | "vertical";
  }>;

function ButtonGroup({
  className,
  orientation = "horizontal",
  role = "group",
  ...props
}: ButtonGroupProps) {
  return (
    <div
      className={cn(
        "flex w-fit items-stretch [&>*]:relative [&>*]:focus-visible:z-10",
        orientation === "vertical" ? "flex-col" : "flex-row",
        className,
      )}
      data-orientation={orientation}
      data-slot="button-group"
      role={role}
      {...props}
    />
  );
}

export { ButtonGroup, type ButtonGroupProps };
