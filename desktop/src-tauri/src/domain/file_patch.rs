use super::file_change::content_lines;

const NO_NEWLINE: &str = "\n\\ No newline at end of file\n";

/// 同一字段只传输规范化后的补丁；预算包含新增文件头、hunk 和行前缀。
pub(crate) struct FilePatch {
    pub diff: String,
    pub truncated: bool,
    limit: usize,
}

impl FilePatch {
    pub fn codex(path: &str, kind: &str, source: &str, limit: usize) -> Self {
        let mut patch = Self {
            // 超长单行可能整行省略，避免为最终只有头部的补丁预留整个来源体积。
            diff: String::with_capacity(source.len().min(limit).min(8 * 1024)),
            truncated: false,
            limit,
        };
        if !matches!(kind, "create" | "delete") && has_file_headers(source) {
            patch.push(source);
            return patch;
        }
        patch.headers(path, kind);
        if patch.truncated {
            // 预算连文件头都容纳不下时返回空正文，不能把半个头部当作代码。
            patch.diff.clear();
            return patch;
        }
        if source.is_empty() {
            return patch;
        }
        if matches!(kind, "create" | "delete") {
            patch.content(kind, source);
        } else if source.split('\n').any(|line| line.starts_with("@@ ")) {
            patch.push(source);
        } else {
            patch.fragment(source);
        }
        patch
    }

    fn content(&mut self, kind: &str, source: &str) {
        let header = content_hunk(kind, content_lines(source));
        let body_budget = self
            .limit
            .saturating_sub(self.diff.len())
            .saturating_sub(header.len());
        let retained = fit_lines(source, body_budget, |line| {
            1 + if line.ends_with('\n') {
                0
            } else {
                NO_NEWLINE.len()
            }
        });
        if retained.is_empty() {
            self.truncated = true;
            return;
        }
        // 截断仅保留完整行，随后重算 hunk；原始总行数不能写进不完整的补丁。
        self.push(&content_hunk(kind, content_lines(retained)));
        let prefix = if kind == "create" { "+" } else { "-" };
        // split_inclusive 借用原始内容，保留 CRLF、空行、末尾空格，不分配行数组。
        for line in retained.split_inclusive('\n') {
            self.push(prefix);
            self.push(line);
            if self.truncated {
                return;
            }
        }
        if !retained.ends_with('\n') {
            self.push(NO_NEWLINE);
        }
        self.truncated |= retained.len() < source.len();
    }

    fn fragment(&mut self, source: &str) {
        let header = fragment_hunk(source);
        let body_budget = self
            .limit
            .saturating_sub(self.diff.len())
            .saturating_sub(header.len());
        let retained = fit_lines(source, body_budget, |line| {
            usize::from(needs_context_prefix(line))
        });
        if retained.is_empty() {
            self.truncated = true;
            return;
        }
        self.push(&fragment_hunk(retained));
        for line in retained.split_inclusive('\n') {
            if needs_context_prefix(line) {
                self.push(" ");
            }
            self.push(line);
            if self.truncated {
                return;
            }
        }
        self.truncated |= retained.len() < source.len();
    }

    fn headers(&mut self, path: &str, kind: &str) {
        self.push("--- ");
        if kind == "create" {
            self.push("/dev/null");
        } else {
            self.path("a/", path);
        }
        self.push("\n+++ ");
        if kind == "delete" {
            self.push("/dev/null");
        } else {
            self.path("b/", path);
        }
        self.push("\n");
    }

    fn path(&mut self, prefix: &str, path: &str) {
        let path = path.trim_start_matches(['/', '\\']);
        let quoted = path.contains(['\n', '\r', '\t', '"']);
        if quoted {
            self.push("\"");
        }
        self.push(prefix);
        for ch in path.chars() {
            match ch {
                '\\' => self.push("/"),
                '\n' => self.push("\\n"),
                '\r' => self.push("\\r"),
                '\t' => self.push("\\t"),
                '"' => self.push("\\\""),
                _ => {
                    self.push(ch.encode_utf8(&mut [0; 4]));
                }
            }
            if self.truncated {
                return;
            }
        }
        if quoted {
            self.push("\"");
        }
    }

    fn push(&mut self, text: &str) {
        if self.truncated {
            return;
        }
        let mut length = text.len().min(self.limit.saturating_sub(self.diff.len()));
        while !text.is_char_boundary(length) {
            length -= 1;
        }
        self.diff.push_str(&text[..length]);
        self.truncated = length < text.len();
    }
}

fn fit_lines(source: &str, mut budget: usize, prefix_bytes: impl Fn(&str) -> usize) -> &str {
    let mut end = 0;
    for line in source.split_inclusive('\n') {
        let bytes = line.len().saturating_add(prefix_bytes(line));
        if bytes > budget {
            break;
        }
        budget -= bytes;
        end += line.len();
    }
    &source[..end]
}

fn content_hunk(kind: &str, count: usize) -> String {
    if kind == "create" {
        format!("@@ -0,0 +1,{count} @@\n")
    } else {
        format!("@@ -1,{count} +0,0 @@\n")
    }
}

fn is_no_newline_marker(line: &str) -> bool {
    // 仅标准标记不占行数；普通反斜杠正文仍属于上下文。
    line.trim_end_matches(['\r', '\n']) == "\\ No newline at end of file"
}

fn needs_context_prefix(line: &str) -> bool {
    !line.starts_with(['+', '-', ' ']) && !is_no_newline_marker(line)
}

fn fragment_hunk(source: &str) -> String {
    let (mut old, mut new) = (0usize, 0usize);
    for line in source.split_terminator('\n') {
        match line.as_bytes().first() {
            Some(b'+') => new += 1,
            Some(b'-') => old += 1,
            Some(b'\\') if is_no_newline_marker(line) => {}
            _ => {
                old += 1;
                new += 1;
            }
        }
    }
    format!(
        "@@ -{},{} +{},{} @@\n",
        usize::from(old != 0),
        old,
        usize::from(new != 0),
        new
    )
}

fn has_file_headers(source: &str) -> bool {
    if source.starts_with("diff --git ") {
        return true;
    }
    let (mut old, mut new) = (false, false);
    // 只在首个 hunk 之前识别文件头，不能把补丁正文中的 ---/+++ 当作头部。
    for line in source
        .split('\n')
        .take_while(|line| !line.starts_with("@@ "))
    {
        old |= line.starts_with("--- ");
        new |= line.starts_with("+++ ");
        if old && new {
            return true;
        }
    }
    false
}

#[cfg(test)]
#[path = "file_patch_tests.rs"]
mod tests;
