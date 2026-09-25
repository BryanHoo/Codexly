const singleTilde = String.raw`new RegExp("(?<=[\\p{L}\\p{N}_])~(?!~)(?=[\\p{L}\\p{N}_])","gu")`;

// 保留 remend 的替换回调契约：匹配内容只有 ~，偏移量指向 ~ 而非前置字符。
// 消费一个 Unicode 字符并还原，既支持连续 a~b~c，也正确计算代理对的 UTF-16 偏移。
const legacySingleTilde = String.raw`({
  [Symbol.replace](text, replace) {
    return text.replace(/([\p{L}\p{N}_])~(?!~)(?=[\p{L}\p{N}_])/gu,
      (match, prefix, offset) => prefix + replace("~", offset + prefix.length, text));
  }
})`;

export function legacyRegexpPlugin() {
  return {
    name: "codeagent-legacy-regexp",
    enforce: "pre",
    transform(code, id) {
      if (/(?:^|[/\\])mdast-util-gfm-autolink-literal[/\\]lib[/\\]index\.js$/u.test(id)) {
        const emailBoundary = String.raw`(?<=^|\s|\p{P}|\p{S})`;
        // findEmail 已通过 previous(match, true) 校验前置空白/标点及斜杠；移除重复断言。
        if (code.split(emailBoundary).length !== 2 || !code.includes("!previous(match, true)")) {
          throw new Error("Legacy GFM email boundary changed; review Safari 15.5 compatibility");
        }
        return { code: code.replace(emailBoundary, ""), map: null };
      }
      if (!/(?:^|[/\\])remend[/\\]dist[/\\]index\.js$/u.test(id)) return null;
      // 依赖升级后必须重新验证规则，禁止静默产出仍会在旧引擎崩溃的安装包。
      if (code.split(singleTilde).length !== 2) {
        throw new Error("Legacy remend regular expression changed; review Safari 15.5 compatibility");
      }
      return { code: code.replace(singleTilde, () => legacySingleTilde), map: null };
    },
  };
}
