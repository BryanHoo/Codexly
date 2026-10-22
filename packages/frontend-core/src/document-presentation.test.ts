import { expect, it } from "vitest";
import { documentResourceId } from "./document-presentation.js";

it("文件树、消息绝对路径和搜索复用同一文件身份，同时隔离项目和工作树", () => {
  const id = documentResourceId("source", "src/app.ts", "p", "/work/project");
  expect(documentResourceId("source", "/work/project/src/app.ts", "p", "/work/project")).toBe(id);
  expect(documentResourceId("source", "src/app.ts", "p", "/work/other")).not.toBe(id);
  expect(documentResourceId("source", "src/app.ts", "q", "/work/project")).not.toBe(id);
  expect(documentResourceId("source", "src\\app.ts", "p", "C:\\project")).toBe(
    documentResourceId("source", "C:/project/src/app.ts", "p", "C:/project"),
  );
});
