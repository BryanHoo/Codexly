const PAGE_SIZE = 32;

export type SequenceNode<T> = Readonly<{
  capacity: number;
  size: number;
}> & (Readonly<{ items: readonly T[]; left?: never; right?: never }> |
  Readonly<{ items?: never; left: SequenceNode<T> | null; right: SequenceNode<T> | null }>);

// 每次只复制变更尾页及其祖先；旧快照和稳定子树保持引用不变。
export function replaceSequenceTail<T>(
  root: SequenceNode<T> | null,
  prefixSize: number,
  additions: readonly T[],
): SequenceNode<T> | null {
  const size = prefixSize + additions.length;
  if (size === 0) return null;
  // 与 JS 数组索引范围一致的固定根，跨页时不会改变 React 子树路径或重挂历史节点。
  let capacity = root?.capacity ?? 2 ** 32;
  while (capacity < size) {
    capacity *= 2;
    root = { capacity, size: root?.size ?? 0, left: root, right: null };
  }

  function update(node: SequenceNode<T> | null, offset: number, limit: number): SequenceNode<T> | null {
    if (offset >= size) return null;
    if (offset + limit <= prefixSize) return node;
    if (limit === PAGE_SIZE) {
      const kept = Math.max(0, prefixSize - offset);
      const items = [
        ...(node?.items?.slice(0, kept) ?? []),
        ...additions.slice(Math.max(0, offset - prefixSize), offset + limit - prefixSize),
      ];
      return { capacity: limit, size: items.length, items };
    }
    const left = update(node?.left ?? null, offset, limit / 2);
    const right = update(node?.right ?? null, offset + limit / 2, limit / 2);
    return { capacity: limit, size: (left?.size ?? 0) + (right?.size ?? 0), left, right };
  }
  return update(root, 0, capacity);
}

export function sequenceItem<T>(root: SequenceNode<T> | null, index: number): T | undefined {
  if (root === null || index < 0 || index >= root.size) return undefined;
  if (root.items !== undefined) return root.items[index];
  return index < root.capacity / 2
    ? sequenceItem(root.left, index)
    : sequenceItem(root.right, index - root.capacity / 2);
}

export function appendTextSequence(root: SequenceNode<string> | null, addition: string): SequenceNode<string> | null {
  if (addition.length === 0) return root;
  const lastIndex = Math.max(0, (root?.size ?? 0) - 1);
  const last = sequenceItem(root, lastIndex) ?? "";
  const pages: string[] = [];
  const value = last + addition;
  // 文本节点按固定大小分页，追加不会让一个巨型 DOM Text 节点反复复制全文。
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(value.length, offset + 1_024);
    const lastCode = value.charCodeAt(end - 1);
    // 代理对不能分散到两个 DOM Text 节点，否则完整 Emoji 也会显示为替换字符。
    if (end - offset > 1 && lastCode >= 0xd800 && lastCode <= 0xdbff) end -= 1;
    pages.push(value.slice(offset, end));
    offset = end;
  }
  return replaceSequenceTail(root, lastIndex, pages);
}
