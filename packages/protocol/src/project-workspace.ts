// 工作区文件与 Git 契约统一导出，根入口保持有界；各协议实现仍可独立摇树。
export * from "./project-git.js";
export * from "./project-file-creation.js";
export { isValidProjectFileCreationName } from "./project-file-creation-name.js";
