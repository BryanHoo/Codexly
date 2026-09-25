import type { ProjectDirectoryListing } from "@/protocol/index.js";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { Button } from "../../../shared/components/core/button.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { FilesystemPickerToolbar } from "./filesystem-picker-toolbar.js";

const listing: ProjectDirectoryListing = {
  entries: [],
  parentPath: null,
  path: "C:\\",
  roots: [
    { name: "C:\\", path: "C:\\" },
    { name: "D:\\", path: "D:\\" },
  ],
};

function FilesystemPickerToolbarHarness() {
  const [isNavigating, setIsNavigating] = useState(false);
  return (
    <TooltipProvider>
      <FilesystemPickerToolbar
        disabled={false}
        includeHidden={false}
        labels={{
          filesystemRoot: "磁盘",
          goToPath: "转到路径",
          hideHidden: "隐藏隐藏目录",
          parent: "上级目录",
          pathLabel: "路径",
          pathPlaceholder: "输入路径",
          showHidden: "显示隐藏目录",
        }}
        listing={isNavigating ? undefined : listing}
        onNavigateParent={() => undefined}
        onNavigatePath={() => undefined}
        onNavigateRoot={() => undefined}
        onPathChange={() => undefined}
        onToggleHidden={() => undefined}
        path={isNavigating ? "D:\\" : "C:\\"}
      />
      <Button onClick={() => setIsNavigating(true)} type="button">
        切换磁盘
      </Button>
    </TooltipProvider>
  );
}

describe("FilesystemPickerToolbar", () => {
  it("切换磁盘加载期间保留磁盘选择器", async () => {
    const screen = await render(<FilesystemPickerToolbarHarness />);
    await expect.element(screen.getByRole("combobox", { name: "磁盘" })).toBeVisible();

    await screen.getByRole("button", { name: "切换磁盘" }).click();

    await expect.element(screen.getByRole("combobox", { name: "磁盘" })).toBeVisible();
  });
});
