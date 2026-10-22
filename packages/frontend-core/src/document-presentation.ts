type DocumentDescriptor =
  | { kind: "source" | "image" | "pdf"; reference: { path: string } }
  | { kind: "diff"; change: { path: string } }
  | { kind: "review" }
  | { kind: "commit"; commit: { title: string; sha: string } };

export function documentResourceId(
  kind: string,
  path: string,
  projectId: string,
  rootPath: string | undefined,
): string {
  const normalized = path.replaceAll("\\", "/");
  const root = rootPath?.replaceAll("\\", "/").replace(/\/$/u, "") ?? "";
  // 身份使用完整资源位置，使搜索、文件树和消息引用共用标签；请求仍保留原始路径。
  const absolute =
    /^(?:\/|[a-z]:\/)/iu.test(normalized) || root === "" ? normalized : `${root}/${normalized}`;
  return JSON.stringify([kind, projectId, root, absolute]);
}

export function describeWorkbenchDocument(document: DocumentDescriptor, reviewTitle: string) {
  if (document.kind === "review")
    return { kind: document.kind, title: reviewTitle, detail: reviewTitle };
  if (document.kind === "commit")
    return {
      kind: document.kind,
      title: document.commit.title,
      detail: `${document.commit.sha.slice(0, 8)} · ${document.commit.title}`,
    };
  const path = document.kind === "diff" ? document.change.path : document.reference.path;
  const name = path.split(/[\\/]/u).at(-1) ?? path;
  return {
    kind: document.kind,
    title: document.kind === "diff" ? `Diff: ${name}` : name,
    detail: path,
  };
}
