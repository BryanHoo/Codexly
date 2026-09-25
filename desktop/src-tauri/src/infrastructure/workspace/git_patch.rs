/// Git 补丁截断后仍须具有正确的 hunk 行数，不能把半行或首尾拼接内容交给渲染器。
pub(super) fn patch_text(output: &[u8], limit: usize) -> String {
    let bytes = &output[..output.len().min(limit)];
    let end = bytes
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map_or(0, |index| index + 1);
    let mut text = String::from_utf8_lossy(&bytes[..end]).into_owned();
    // 有损 UTF-8 转换会扩张字节数，转换后再次限制预算。
    if text.len() > limit {
        let end = text.as_bytes()[..limit]
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map_or(0, |index| index + 1);
        text.truncate(end);
    }
    let Some(start) = text.rfind("\n@@ ").map(|position| position + 1) else {
        return text;
    };
    let Some(header_end) = text[start..].find('\n').map(|offset| start + offset) else {
        return text;
    };
    let header = &text[start..header_end];
    let Some((old, new, suffix)) = parse_header(header) else {
        return text;
    };
    let old = old.to_owned();
    let new = new.to_owned();
    let suffix = suffix.to_owned();
    let original_header = header.to_owned();
    let mut body_end = text.len();
    loop {
        let body = &text[header_end + 1..body_end];
        let (mut old_count, mut new_count) = (0, 0);
        for line in body.lines() {
            match line.as_bytes().first() {
                Some(b' ') => {
                    old_count += 1;
                    new_count += 1;
                }
                Some(b'-') => old_count += 1,
                Some(b'+') => new_count += 1,
                Some(b'\\') => {}
                _ => break,
            }
        }
        let replacement = format!(
            "@@ -{} +{} @@{}",
            range(&old, old_count),
            range(&new, new_count),
            suffix
        );
        // 完整补丁原样返回，只有实际缺行的末尾 hunk 才重建行数。
        if counts(&old) == old_count && counts(&new) == new_count && body_end == text.len() {
            return text;
        }
        if old_count == 0 && new_count == 0 {
            text.truncate(start);
            return text;
        }
        if body_end + replacement.len() <= limit + original_header.len() {
            text.truncate(body_end);
            text.replace_range(start..header_end, &replacement);
            return text;
        }
        body_end = text.as_bytes()[..body_end.saturating_sub(1)]
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map_or(header_end + 1, |position| position + 1);
    }
}

fn parse_header(header: &str) -> Option<(&str, &str, &str)> {
    let content = header.strip_prefix("@@ -")?;
    let (old, content) = content.split_once(" +")?;
    let (new, suffix) = content.split_once(" @@")?;
    Some((old, new, suffix))
}

fn counts(value: &str) -> usize {
    value
        .split_once(',')
        .map_or(1, |(_, count)| count.parse().unwrap_or(0))
}

fn range(value: &str, count: usize) -> String {
    let start = value.split(',').next().unwrap_or("0");
    if count == 1 {
        start.to_owned()
    } else {
        format!("{start},{count}")
    }
}

pub(super) fn untracked_patch(
    path: &str,
    content: &str,
    limit: usize,
) -> crate::domain::file_patch::FilePatch {
    const PLACEHOLDER: &str = "--- /dev/null\n+++ b/file\n";
    let path = if path
        .chars()
        .any(|ch| ch.is_control() || matches!(ch, '\\' | '"'))
    {
        let mut quoted = String::from("\"b/");
        for ch in path.chars() {
            match ch {
                '\\' => quoted.push_str("\\\\"),
                '"' => quoted.push_str("\\\""),
                '\n' => quoted.push_str("\\n"),
                '\r' => quoted.push_str("\\r"),
                '\t' => quoted.push_str("\\t"),
                ch if ch.is_ascii_control() => quoted.push_str(&format!("\\{:03o}", ch as u8)),
                ch => quoted.push(ch),
            }
        }
        quoted.push('"');
        quoted
    } else {
        format!("b/{path}")
    };
    let headers = format!("--- /dev/null\n+++ {path}\n");
    // 复用正文行数与预算处理，但 Git 路径必须按字面量引用，不能执行 Windows 分隔符替换。
    let mut patch = crate::domain::file_patch::FilePatch::codex(
        "file",
        "create",
        content,
        limit.saturating_sub(headers.len()) + PLACEHOLDER.len(),
    );
    if headers.len() > limit {
        patch.diff.clear();
        patch.truncated = true;
    } else {
        patch.diff.replace_range(..PLACEHOLDER.len(), &headers);
    }
    patch
}
