import type { ProjectRoot } from "@code-agent/protocol";
import { FolderKanban } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/components/core/select.js";

function rootName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}

export function ProjectRootSelector({
  onChange,
  roots,
  value,
}: Readonly<{
  onChange: (rootId: string) => void;
  roots: readonly ProjectRoot[];
  value: string;
}>) {
  const { t } = useTranslation("workbench");
  if (roots.length < 2) return null;
  const selectedRoot = roots.find((root) => root.id === value) ?? roots[0];
  if (selectedRoot === undefined) return null;

  return (
    <Select onValueChange={onChange} value={value}>
      <SelectTrigger
        aria-label={t("shell.selectProjectRoot")}
        className="min-w-0 max-w-28 shrink border-0 bg-transparent shadow-none hover:bg-control-hover sm:max-w-40"
        size="toolbar"
        title={selectedRoot.path}
      >
        <FolderKanban aria-hidden="true" />
        <SelectValue>{rootName(selectedRoot.path)}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper">
        {roots.map((root, index) => (
          <SelectItem key={root.id} textValue={root.path} value={root.id}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{rootName(root.path)}</span>
              <span className="truncate font-mono text-caption text-muted-foreground">
                {index === 0 ? `${t("projectPicker.primaryRoot")} · ` : ""}
                {root.path}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
