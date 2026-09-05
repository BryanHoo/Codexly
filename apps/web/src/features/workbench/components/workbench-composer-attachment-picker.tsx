import type { ComponentProps } from "react";

import { HostAttachmentPickerDialog } from "./host-attachment-picker-dialog.js";

type DialogProps = ComponentProps<typeof HostAttachmentPickerDialog>;
type ComposerAttachmentPickerProps = Omit<DialogProps, "kind" | "onAdd"> &
  Readonly<{
    active: boolean;
    kind: DialogProps["kind"] | undefined;
    onAdd: DialogProps["onAdd"];
  }>;

export function WorkbenchComposerAttachmentPicker({
  active,
  kind,
  onAdd,
  ...props
}: ComposerAttachmentPickerProps) {
  if (kind === undefined) return null;
  return (
    <HostAttachmentPickerDialog
      {...props}
      kind={kind}
      onAdd={(attachment) => {
        if (!active) return;
        onAdd(attachment);
        props.onClose();
      }}
    />
  );
}
