import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { FilesystemPickerToolbar } from "./filesystem-picker-toolbar.js";

it.each([
  [String.raw`\\?\C:\repo`, String.raw`C:\repo`],
  [String.raw`\\?\UNC\server\share`, String.raw`\\server\share`],
])("displays a normal path in the Web directory picker: %s", (path, displayed) => {
  const markup = renderToStaticMarkup(
    <TooltipProvider>
      <FilesystemPickerToolbar
        disabled={false}
        includeHidden={false}
        listing={{ path, parentPath: null, roots: [] }}
        path={path}
        labels={{
          filesystemRoot: "Disk",
          goToPath: "Go",
          hideHidden: "Hide",
          parent: "Parent",
          pathLabel: "Path",
          pathPlaceholder: "Path",
          showHidden: "Show",
        }}
        onNavigateParent={vi.fn()}
        onNavigatePath={vi.fn()}
        onNavigateRoot={vi.fn()}
        onPathChange={vi.fn()}
        onToggleHidden={vi.fn()}
      />
    </TooltipProvider>,
  );
  expect(markup).toContain(`value="${displayed}"`);
  expect(markup).not.toContain("\\\\?\\");
});
