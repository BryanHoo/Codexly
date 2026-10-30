import { expect, it } from "vitest";
import { documentResourceId } from "./document-presentation.js";

it("Linux 文件身份保留反斜杠、大小写和 Unicode 原始形式", () => {
  const id = (path: string) => documentResourceId("source", path, "p", "/srv/project");
  expect(id("a\\b.txt")).not.toBe(id("a/b.txt"));
  expect(id("A.txt")).not.toBe(id("a.txt"));
  expect(id("café.txt")).not.toBe(id("cafe\u0301.txt"));
  expect(documentResourceId("source", "a.txt", "p", "/srv/project\\")).not.toBe(
    documentResourceId("source", "a.txt", "p", "/srv/project"),
  );
});

it("Windows 命名空间路径与普通路径共用身份，保留文件名大小写", () => {
  expect(documentResourceId("source", "\\\\?\\C:\\project\\a.txt", "p", "\\\\?\\C:\\project")).toBe(
    documentResourceId("source", "C:/project/a.txt", "p", "C:/project"),
  );
  expect(documentResourceId("source", "a.txt", "p", "\\\\?\\UNC\\host\\share")).toBe(
    documentResourceId("source", "a.txt", "p", "\\\\host\\share"),
  );
});

it("文件树、消息绝对路径和搜索复用同一文件身份，同时隔离项目和工作树", () => {
  const id = documentResourceId("source", "src/app.ts", "p", "/work/project");
  expect(documentResourceId("source", "/work/project/src/app.ts", "p", "/work/project")).toBe(id);
  expect(documentResourceId("source", "src/app.ts", "p", "/work/other")).not.toBe(id);
  expect(documentResourceId("source", "src/app.ts", "q", "/work/project")).not.toBe(id);
  expect(documentResourceId("source", "src\\app.ts", "p", "C:\\project")).toBe(
    documentResourceId("source", "C:/project/src/app.ts", "p", "C:/project"),
  );
});
