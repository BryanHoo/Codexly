import { Buffer } from "node:buffer";
import type { Route } from "@playwright/test";
import {
  enableLanAccess,
  expect,
  taskSnapshot,
  taskSnapshotResponse,
  test,
} from "./fixtures/app-shell.js";

// 构造完整的单页 PDF，浏览器原生查看器可以真实解析正文和交叉引用表。
test.use({ channel: "chromium" });

function createPdf(): Buffer {
  const content = "BT /F1 18 Tf 30 240 Td (PDF Preview) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${String(Buffer.byteLength(content))} >>\nstream\n${content}endstream`,
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("previews generated chat PDFs, attachments and file-tree PDFs", async ({ page }) => {
  await enableLanAccess(page);
  let pdfRequests = 0;
  await page.route("**/v1/projects/codexly/tasks/task-1", (route) =>
    route.fulfill({
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          turns: [
            {
              ...taskSnapshot.turns[0],
              items: [
                {
                  id: "pdf-message",
                  role: "assistant",
                  type: "message",
                  text: "[生成的报告](/workspace/Codexly/报告.PDF)",
                  attachments: [
                    {
                      id: "generated-pdf",
                      kind: "file",
                      mediaType: "application/pdf",
                      name: "附件.pdf",
                      size: 800,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    }),
  );
  await page.route("**/v1/projects/codexly/files/tree?*", (route) =>
    route.fulfill({
      json: { entries: [{ path: "报告.PDF", type: "file" }], path: null },
    }),
  );
  const servePdf = async (route: Route) => {
    pdfRequests += 1;
    await route.fulfill({
      body: createPdf(),
      contentType: "application/pdf",
      headers: { "content-disposition": "inline; filename=report.pdf" },
    });
  };
  await page.route("**/v1/projects/codexly/files/pdf?*", servePdf);
  await page.route("**/v1/projects/codexly/tasks/task-1/attachments/generated-pdf", servePdf);
  await page.goto("/p/codexly/t/task-1");
  expect(await page.evaluate(() => navigator.pdfViewerEnabled)).toBe(true);
  expect(pdfRequests).toBe(0);
  await page.getByRole("button", { name: "附件.pdf", exact: true }).click();
  await expect(page.getByRole("dialog").locator("iframe")).toHaveAttribute(
    "src",
    /attachments\/generated-pdf/u,
  );
  await expect.poll(() => pdfRequests).toBe(1);
  await page.getByRole("button", { name: "关闭 PDF 预览" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByText("生成的报告", { exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "运行环境" });
  await expect(inspector.locator("iframe")).toHaveAttribute("src", /files\/pdf\?/u);
  await expect.poll(() => pdfRequests).toBe(2);
  await inspector.getByRole("tab", { name: "项目", exact: true }).click();
  await inspector.getByRole("treeitem", { name: "报告.PDF", exact: true }).click();
  await expect(inspector.locator("iframe")).toHaveAttribute("src", /path=%E6%8A%A5%E5%91%8A.PDF/u);
  await expect.poll(() => pdfRequests).toBe(3);
  await page.getByRole("button", { name: "附件.pdf", exact: true }).click({ button: "right" });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "下载文件" }).click();
  expect((await downloadEvent).suggestedFilename()).toBe("附件.pdf");
});

test("offers an explicit PDF open action on mobile without inline PDF support", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "pdfViewerEnabled", { value: false }),
  );
  await page.route("**/v1/projects/codexly/tasks/task-1", (route) =>
    route.fulfill({
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          turns: [
            {
              ...taskSnapshot.turns[0],
              items: [
                {
                  id: "pdf-mobile",
                  role: "assistant",
                  type: "message",
                  text: "",
                  attachments: [
                    {
                      id: "mobile-pdf",
                      kind: "file",
                      mediaType: "application/pdf",
                      name: "移动报告.pdf",
                      size: 800,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    }),
  );
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "移动报告.pdf", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("status")).toContainText("当前环境不支持内嵌 PDF");
  await expect(dialog.locator("iframe")).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "打开 PDF" })).toHaveAttribute(
    "href",
    /attachments\/mobile-pdf/u,
  );
  await page.getByRole("button", { name: "关闭 PDF 预览" }).click();
  await expect(dialog).toHaveCount(0);
});
