import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const mergeProjectClasses = extendTailwindMerge({
  extend: {
    theme: {
      // 项目字号与颜色共用 text-* 前缀，必须显式登记以避免字号被误判为颜色。
      text: ["caption", "meta", "label", "body-small", "body", "heading", "title", "display"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return mergeProjectClasses(clsx(inputs));
}
