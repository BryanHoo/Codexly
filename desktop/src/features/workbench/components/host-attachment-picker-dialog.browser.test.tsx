import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";

import { i18n } from "../../../i18n/i18n.js";
import type { HostFileListing } from "../../../protocol/index.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import type { NativeHostAttachmentClient } from "../../projects/project-queries.js";
import { HostAttachmentPickerDialog } from "./host-attachment-picker-dialog.js";

const longName = `${"very-long-attachment-name-".repeat(16)}.zip`;
const longPath = `/Users/example/Downloads/${longName}`;
const listing: HostFileListing = {
  entries: [{ name: longName, path: longPath, type: "file" }],
  parentPath: "/Users/example",
  path: "/Users/example/Downloads",
  roots: [{ name: "/", path: "/" }],
};

describe("HostAttachmentPickerDialog", () => {
  it("keeps action buttons inside the dialog for a long selected path", async () => {
    await i18n.changeLanguage("zh-CN");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const client: NativeHostAttachmentClient = {
      importHostAttachment: vi.fn(),
      listHostFiles: vi.fn(async () => listing),
    };
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <HostAttachmentPickerDialog
            client={client}
            kind="file"
            onAdd={() => undefined}
            onClose={() => undefined}
            projectId="project-a"
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    const file = screen.getByRole("treeitem", { name: longName });
    await expect.element(file).toBeVisible();
    await file.click();

    const dialog = screen.getByRole("dialog").element();
    const addButton = screen
      .getByRole("button", { name: /Add selected file|添加所选文件/u })
      .element();
    const selectedPath = document.querySelector<HTMLElement>('p[aria-live="polite"]');

    expect(selectedPath).not.toBeNull();
    expect(selectedPath?.getBoundingClientRect().width).toBeLessThanOrEqual(320);
    expect(addButton.getBoundingClientRect().right).toBeLessThanOrEqual(
      dialog.getBoundingClientRect().right,
    );
    expect(addButton.scrollWidth).toBeLessThanOrEqual(addButton.clientWidth);
  });
});
