import { lstat, opendir, open, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import ignore, { type Ignore } from "ignore";
import pLimit from "p-limit";
import {
  checkSearchCancellation,
  searchQuery,
  type AgentFileSearchInput,
  type AgentFileSearchMatch,
  type AgentFileSearchProvider,
} from "@codexly/core";

const MAX_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const ignored = new Set([".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules"]);
interface Rule {
  base: string;
  matcher: Ignore;
  checks: number;
}
interface Index {
  expires: number;
  files: readonly string[];
  bytes: number;
}

async function rulesAt(directory: string, base: string): Promise<Rule[]> {
  const rules: Rule[] = [];
  for (const name of [".gitignore", ".ignore"]) {
    let file;
    try {
      if ((await lstat(join(directory, name))).isSymbolicLink()) continue;
      file = await open(join(directory, name), "r");
      const stats = await file.stat();
      if (!stats.isFile()) continue;
      if (stats.size > 256 * 1024)
        throw new Error("File search ignore rules exceed the size limit");
      rules.push({ base, matcher: ignore().add(await file.readFile("utf8")), checks: 0 });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    } finally {
      await file?.close();
    }
  }
  return rules;
}

/** 文件名属于文件系统能力，与登录和模型依赖无关；两端均使用子串匹配及最多 50 条结果。 */
export class LocalFileSearchService implements AgentFileSearchProvider {
  readonly #slots = pLimit(2);
  readonly #sessions = new Map<string, AbortController>();
  readonly #indexes = new Map<string, Index>();

  async search(input: AgentFileSearchInput): Promise<{ data: AgentFileSearchMatch[] }> {
    checkSearchCancellation(input.signal);
    const query = searchQuery(input.query).toLowerCase();
    if (this.#sessions.size >= 32) throw new Error("File search capacity exceeded");
    const key = JSON.stringify([input.projectId, input.sessionId]);
    const controller = new AbortController();
    this.#sessions.get(key)?.abort();
    this.#sessions.set(key, controller);
    const abort = () => {
      controller.abort();
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      return await this.#slots(async () => {
        const data: AgentFileSearchMatch[] = [];
        for (const rootPath of input.roots) {
          checkSearchCancellation(controller.signal);
          const root = await realpath(rootPath);
          const index = this.#indexes.get(root);
          let paths: readonly string[];
          if (index && index.expires > Date.now()) {
            const matches: string[] = [];
            for (const path of index.files) {
              if (path.toLowerCase().includes(query)) matches.push(path);
              if (matches.length === 50) break;
            }
            paths = matches;
          } else paths = await this.#scan(root, query, controller.signal);
          for (const path of paths) data.push({ name: basename(path), path, rootPath });
        }
        checkSearchCancellation(controller.signal);
        return { data: data.slice(0, 50) };
      });
    } finally {
      input.signal?.removeEventListener("abort", abort);
      if (this.#sessions.get(key) === controller) this.#sessions.delete(key);
    }
  }

  stop(projectId: string, sessionId: string): Promise<void> {
    this.#sessions.get(JSON.stringify([projectId, sessionId]))?.abort();
    return Promise.resolve();
  }

  async #scan(root: string, query: string, signal: AbortSignal): Promise<readonly string[]> {
    const files: string[] = [],
      matches: string[] = [];
    const indexState = { bytes: 0, cacheable: true };
    const compare = (a: string, b: string) =>
      a.toLowerCase() < b.toLowerCase()
        ? -1
        : a.toLowerCase() > b.toLowerCase()
          ? 1
          : a < b
            ? -1
            : a > b
              ? 1
              : 0;
    const walk = async (
      relative: string,
      ancestors: readonly Rule[],
      depth: number,
    ): Promise<void> => {
      signal.throwIfAborted();
      const rules = [
        ...ancestors,
        ...(await rulesAt(join(root, relative), relative ? `${relative}/` : "")),
      ];
      const directory = await opendir(join(root, relative));
      for await (const entry of directory) {
        signal.throwIfAborted();
        if (entry.isSymbolicLink() || ignored.has(entry.name) || entry.name === ".DS_Store")
          continue;
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        let excluded = false,
          included = false;
        for (const rule of rules) {
          // ignore 的路径结果缓存没有容量限制；仅复用编译规则，定期释放匹配缓存。
          if (++rule.checks > 128) {
            rule.matcher = ignore().add(rule.matcher);
            rule.checks = 0;
          }
          const test = rule.matcher.test(
            path.slice(rule.base.length) + (entry.isDirectory() ? "/" : ""),
          );
          if (test.ignored || test.unignored) {
            excluded = test.ignored;
            included = test.unignored;
          }
        }
        if (excluded || (entry.name.startsWith(".") && !included)) continue;
        if (entry.isDirectory()) {
          if (depth < 20) await walk(path, rules, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        // 索引超预算后继续搜索目录尾部，只保留排序最前的 50 条匹配，不能截断可搜索范围。
        if (indexState.cacheable) {
          indexState.bytes += path.length * 2 + 32;
          if (indexState.bytes <= MAX_INDEX_BYTES) files.push(path);
          else {
            indexState.cacheable = false;
            files.length = 0;
          }
        }
        if (path.toLowerCase().includes(query)) {
          matches.push(path);
          matches.sort(compare);
          if (matches.length > 50) matches.pop();
        }
      }
    };
    await walk("", [], 1);
    signal.throwIfAborted();
    if (indexState.cacheable) {
      files.sort(compare);
      this.#indexes.delete(root);
      this.#indexes.set(root, { files, bytes: indexState.bytes, expires: Date.now() + 5_000 });
      let retained = [...this.#indexes.values()].reduce((sum, index) => sum + index.bytes, 0);
      for (const [key, index] of this.#indexes) {
        if (this.#indexes.size <= 8 && retained <= MAX_CACHE_BYTES) break;
        this.#indexes.delete(key);
        retained -= index.bytes;
      }
    }
    return matches;
  }
}
