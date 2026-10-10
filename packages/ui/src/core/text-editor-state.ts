import {
  EditorState,
  StateField,
  type Extension,
  type Text,
  type Transaction,
} from "@codemirror/state";

export const MAX_TEXT_EDITOR_BYTES = 2 * 1024 * 1024;
export const MAX_TEXT_EDITOR_PARSE_BYTES = 256 * 1024;

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

function rangeBytes(doc: Text, from: number, to: number, separator: string): number {
  let bytes = 0;
  const iterator = doc.iterRange(from, to);
  while (!iterator.next().done)
    bytes += iterator.lineBreak ? separator.length : utf8Bytes(iterator.value);
  return bytes;
}

const transactionBytes = new WeakMap<Transaction, number>();
export function getTextEditorTransactionBytes(transaction: Transaction): number {
  const cached = transactionBytes.get(transaction);
  if (cached !== undefined) return cached;
  let bytes = getTextEditorByteLength(transaction.startState);
  if (transaction.docChanged) {
    const before = transaction.startState.doc;
    const after = transaction.newDoc;
    const separator = transaction.startState.lineBreak;
    const ranges: { fromA: number; toA: number; fromB: number; toB: number }[] = [];
    transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      // 扩展一个 UTF-16 单元，把跨插入/删除边界的代理对纳入计数；重叠区只计算一次。
      const range = {
        fromA: Math.max(0, fromA - 1),
        toA: Math.min(before.length, toA + 1),
        fromB: Math.max(0, fromB - 1),
        toB: Math.min(after.length, toB + 1),
      };
      const previous = ranges.at(-1);
      if (previous && (range.fromA <= previous.toA || range.fromB <= previous.toB)) {
        previous.toA = range.toA;
        previous.toB = range.toB;
      } else ranges.push(range);
    });
    for (const range of ranges) {
      bytes -= rangeBytes(before, range.fromA, range.toA, separator);
      bytes += rangeBytes(after, range.fromB, range.toB, separator);
    }
  }
  transactionBytes.set(transaction, bytes);
  return bytes;
}

const byteLengthField = StateField.define<number>({
  create: (state) => rangeBytes(state.doc, 0, state.doc.length, state.lineBreak),
  update: (_bytes, transaction) => getTextEditorTransactionBytes(transaction),
});

export function getTextEditorByteLength(state: EditorState): number {
  return state.field(byteLengthField);
}

export function createTextEditorState(
  content: string | Text,
  extensions: Extension = [],
  onInputLimit: () => void = () => undefined,
  lineBreak = typeof content === "string" && content.includes("\r\n") ? "\r\n" : "\n",
): EditorState {
  return EditorState.create({
    doc: content,
    extensions: [
      // CodeMirror 内部统一行分隔；显式设置序列化分隔符，避免保存时把 CRLF 改成 LF。
      EditorState.lineSeparator.of(lineBreak),
      byteLengthField,
      EditorState.transactionFilter.of((transaction) => {
        // 在文档、撤销历史和解析状态创建之前拒绝整个超限事务，保留原正文和选择。
        if (
          transaction.docChanged &&
          getTextEditorTransactionBytes(transaction) > MAX_TEXT_EDITOR_BYTES
        ) {
          onInputLimit();
          return [];
        }
        return transaction;
      }),
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
