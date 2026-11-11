use serde_json::Value;

fn text(v: &Value, min: usize, max: usize) -> bool {
    v.as_str().is_some_and(|s| {
        let n = s.encode_utf16().count();
        n >= min && n <= max
    })
}
fn object(v: &Value, fields: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|o| o.len() == fields.len() && fields.iter().all(|k| o.contains_key(*k)))
}
fn time(v: &Value) -> bool {
    v.as_i64()
        .is_some_and(|n| (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&n))
}

/// 与共享定义契约保持同样的字段和 UTF-16 边界；只校验定义，不解析厂商设置。
pub(super) fn valid(v: &Value) -> bool {
    if !object(
        v,
        &[
            "name",
            "projectId",
            "engine",
            "values",
            "enabled",
            "prompt",
            "schedule",
        ],
    ) || !text(&v["name"], 1, 120)
        || !text(&v["projectId"], 1, 128)
        || !matches!(v["engine"].as_str(), Some("codex" | "claude"))
        || !v["enabled"].is_boolean()
    {
        return false;
    }
    let Some(values) = v["values"].as_object() else {
        return false;
    };
    if !values.iter().all(|(id, value)| {
        !id.is_empty()
            && id.encode_utf16().count() <= 256
            && (value.is_boolean() || text(value, 0, 16384))
    }) {
        return false;
    }
    let p = &v["prompt"];
    if !object(p, &["type", "text", "attachments", "skills"])
        || p["type"] != "prompt"
        || !text(&p["text"], 0, 100000)
    {
        return false;
    }
    let (Some(attachments), Some(skills)) = (p["attachments"].as_array(), p["skills"].as_array())
    else {
        return false;
    };
    if !attachments
        .iter()
        .all(|a| object(a, &["id"]) && text(&a["id"], 1, usize::MAX))
        || !skills.iter().all(|s| {
            object(s, &["id", "name"])
                && text(&s["id"], 1, usize::MAX)
                && text(&s["name"], 1, usize::MAX)
        })
        || (p["text"] == "" && attachments.is_empty() && skills.is_empty())
    {
        return false;
    }
    let s = &v["schedule"];
    match s["type"].as_str() {
        Some("once") => object(s, &["type", "atUnixMs"]) && time(&s["atUnixMs"]),
        Some("rrule") => {
            object(s, &["type", "startAtUnixMs", "rrule", "timezone"])
                && time(&s["startAtUnixMs"])
                && text(&s["rrule"], 1, 2048)
                && text(&s["timezone"], 1, 128)
        }
        _ => false,
    }
}
