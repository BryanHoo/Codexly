import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LanDownloadContextMenu } from "./lan-download-context-menu.js";

describe("LanDownloadContextMenu", () => {
  it("renders a browser download command when LAN access is enabled", () => {
    const markup = renderToStaticMarkup(
      <LanDownloadContextMenu enabled name="result image.png" open url="/attachments/image-1">
        <button type="button">预览</button>
      </LanDownloadContextMenu>,
    );

    expect(markup).toContain("下载文件");
    expect(markup).toContain('href="/attachments/image-1"');
    expect(markup).toContain('download="result image.png"');
  });

  it("keeps the original trigger without a menu outside LAN access", () => {
    const markup = renderToStaticMarkup(
      <LanDownloadContextMenu enabled={false} name="report.pdf" url="/attachments/file-1">
        <button type="button">report.pdf</button>
      </LanDownloadContextMenu>,
    );

    expect(markup).toBe('<button type="button">report.pdf</button>');
  });
});
