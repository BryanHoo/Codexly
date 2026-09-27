import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const mergeProjectClasses = extendTailwindMerge({
  extend: {
    theme: {
      // 两端使用同一套 text-* 字号，避免合并时被误识别为文字颜色。
      text: ["caption", "meta", "label", "body-small", "body", "heading", "title", "display"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return mergeProjectClasses(clsx(inputs));
}
