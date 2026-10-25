/** 使用标准下载属性支持电脑与移动浏览器，延迟释放 URL 以免打断 WebKit 接管下载。 */
export function downloadFile(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 30_000);
  }
}
