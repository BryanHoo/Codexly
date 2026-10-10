import { EditorState, type Extension, type Text } from "@codemirror/state";

export function createTextEditorState(content: string, extensions: Extension = []): EditorState {
  return EditorState.create({
    doc: content,
    extensions: [
      // CodeMirror 内部统一行分隔；显式设置序列化分隔符，避免保存时把 CRLF 改成 LF。
      EditorState.lineSeparator.of(content.includes("\r\n") ? "\r\n" : "\n"),
      extensions,
    ],
  });
}

export class TextEditorSession {
  private saved: Text;
  public version: string;
  constructor(saved: Text, version: string) {
    this.saved = saved;
    this.version = version;
  }
  isDirty(current: Text): boolean {
    return !current.eq(this.saved);
  }
  markSaved(submitted: Text, version: string): void {
    // 保存回执只确认提交瞬间的不可变快照，期间输入的新字符仍然属于未保存修改。
    this.saved = submitted;
    this.version = version;
  }
}
