import { MAX_TEXT_EDITOR_BYTES } from "./text-editor-state.js";

export class TextEditorCapacity {
  private entries = 0;
  private maxEntries: number;
  private maxBytes: number;
  constructor(maxEntries = 16, maxBytes = 32 * 1024 * 1024) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  reserve(): () => void {
    // 每个活动/失败会话预留最大正文容量，避免输入增长或保存失败后才发现无处保留草稿。
    // 这是 UTF-8 正文预算，不宣称是 JS 堆或撤销历史的精确字节上限。
    if (
      this.entries >= this.maxEntries ||
      (this.entries + 1) * MAX_TEXT_EDITOR_BYTES > this.maxBytes
    )
      throw Object.assign(new Error("Text editor draft capacity exhausted"), {
        code: "TEXT_EDITOR_CAPACITY",
      });
    this.entries++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.entries--;
    };
  }
}

// 同一页面的所有客户端共用预算，切换项目或主机不能绕过容量保护。
export const textEditorCapacity = new TextEditorCapacity();
