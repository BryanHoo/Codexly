import { describe, expect, it } from "vitest";

import {
  classifyMessageAttachment,
  classifyProjectFileReference,
} from "./project-file-reference.js";

describe("classifyProjectFileReference", () => {
  it.each(["images/result.png", "/workspace/project/design.JPG", "C:\\project\\screen.webp"])(
    "classifies %s as an image preview",
    (path) => {
      expect(classifyProjectFileReference(path)).toBe("image");
    },
  );

  it.each([
    "report.doc",
    "report.docx",
    "slides.ppt",
    "slides.pptx",
    "table.xls",
    "table.xlsx",
    "archive.zip",
  ])("classifies %s for the system default application", (path) => {
    expect(classifyProjectFileReference(path)).toBe("system");
  });

  it.each(["src/main.ts", "docs/guide.md", "data/config.json", "notes.txt"])(
    "classifies %s as a source preview",
    (path) => {
      expect(classifyProjectFileReference(path)).toBe("source");
    },
  );
});

describe("classifyMessageAttachment", () => {
  const attachment = {
    id: "attachment-1",
    mediaType: "application/octet-stream",
    size: 1024,
  } as const;

  it("previews image, text, and source file attachments", () => {
    expect(
      classifyMessageAttachment({
        ...attachment,
        kind: "image",
        mediaType: "image/png",
        name: "layout.png",
      }),
    ).toBe("image");
    expect(
      classifyMessageAttachment({
        ...attachment,
        kind: "text",
        mediaType: "text/plain",
        name: "notes.txt",
      }),
    ).toBe("source");
    expect(classifyMessageAttachment({ ...attachment, kind: "file", name: "main.ts" })).toBe(
      "source",
    );
  });

  it("opens unsupported file attachments with the system application", () => {
    expect(
      classifyMessageAttachment({
        ...attachment,
        kind: "file",
        mediaType: "application/pdf",
        name: "report.pdf",
      }),
    ).toBe("system");
  });

  it("opens source files above the preview limit with the system application", () => {
    expect(
      classifyMessageAttachment({
        ...attachment,
        kind: "file",
        name: "large.log",
        size: 1024 * 1024 + 1,
      }),
    ).toBe("system");
  });
});
