import { formatDisplayPath } from "./display-path.js";

/** 只依据宿主返回的绝对路径判断语法，不能使用浏览器的操作系统。 */
export function isWindowsHostPath(path: string): boolean {
  return /^(?:[a-z]:[\\/]|\\\\|\/\/)/iu.test(path);
}

/** 用于资源身份和目录比较；POSIX 的反斜杠、大小写与 Unicode 形式必须保留。 */
export function normalizeHostPath(path: string, windows: boolean): string {
  const normalized = windows ? formatDisplayPath(path).replaceAll("\\", "/") : path;
  return normalized.replace(/\/+$/u, "") || normalized.slice(0, 1);
}

/** 将协议中的项目相对路径拼回宿主路径，供复制路径和文件引用共同使用。 */
export function joinHostPath(rootPath: string, relativePath: string): string {
  const windows = isWindowsHostPath(rootPath);
  const separator = windows && rootPath.includes("\\") ? "\\" : "/";
  const root = rootPath.replace(windows ? /[\\/]+$/u : /\/+$/u, "");
  // Windows 接受两种分隔符；POSIX 中反斜杠是文件名字符，不能转换或剥离。
  // 调用方传入协议中的项目相对路径，不能在这里把绝对路径伪装成相对路径。
  const path = windows ? relativePath.replace(/[\\/]/gu, separator) : relativePath;
  return path === "" ? root || rootPath : `${root}${separator}${path}`;
}
