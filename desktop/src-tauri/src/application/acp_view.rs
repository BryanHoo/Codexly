use serde_json::{Value, json};

pub(super) fn normalize_response(method: &str, response: &mut Value) {
    if method == "prompt.start" {
        normalize_turn(response);
    } else if method == "queue.start" {
        normalize_turn(&mut response["turn"]);
    }
}

/// ACP 应用回合在原生边界转换为桌面视图；统计只计算一次，渲染不重新扫描补丁。
pub(super) fn normalize_turn(turn: &mut Value) {
    let Some(items) = turn["items"].as_array_mut() else {
        return;
    };
    for item in items {
        if item["type"] == "reasoning" {
            *item = json!({"id":item["id"],"type":"reasoning","text":item["summary"].as_str().or_else(|| item["text"].as_str()).unwrap_or_default()});
        } else if item["type"] == "file_change"
            && let Some(changes) = item["changes"].as_array_mut()
        {
            for change in changes {
                let stats = crate::domain::file_change::FileChangeStats::patch(
                    change["diff"].as_str().unwrap_or_default(),
                );
                change["stats"] = json!({"additions":stats.additions,"removals":stats.removals});
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    #[test]
    fn acp_public_thought_should_survive_native_events_without_changing_legacy_thought() {
        let mut event = json!({"type":"item.completed","payload":{"item":{"id":"r","type":"reasoning","content":"","summary":"公开思考"}}});
        crate::application::claude_host::normalize_event(&mut event);
        assert_eq!(event["payload"]["item"]["text"], "公开思考");
        let mut legacy = json!({"type":"item.completed","payload":{"item":{"id":"r","type":"reasoning","content":"旧公开思考","summary":""}}});
        crate::application::claude_host::normalize_event(&mut legacy);
        assert_eq!(legacy["payload"]["item"]["text"], "旧公开思考");
    }
    #[test]
    fn acp_turn_should_expose_summary_and_reuse_native_diff_statistics() {
        let mut turn = json!({"id":"turn","items":[
            {"id":"r","type":"reasoning","summary":"公开摘要","content":"不可显示"},
            {"id":"f","type":"file_change","status":"completed","changes":[{"path":"a","kind":"update","diff":"--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n"}]}
        ]});
        super::normalize_turn(&mut turn);
        assert_eq!(
            turn["items"][0],
            json!({"id":"r","type":"reasoning","text":"公开摘要"})
        );
        assert_eq!(
            turn["items"][1]["changes"][0]["stats"],
            json!({"additions":1,"removals":1})
        );
        assert_eq!(turn["id"], "turn");
        let once = turn.clone();
        super::normalize_turn(&mut turn);
        assert_eq!(turn, once);
    }
}
