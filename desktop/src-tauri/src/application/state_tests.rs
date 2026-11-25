use super::RuntimePerformanceMetrics;
use serde_json::json;

#[tokio::test]
async fn claude_snapshot_should_cover_only_events_before_its_ordered_response_frame() {
    let state = super::AppState::default();
    state.remember_tasks("project-a", ["task-a"]).await;
    let delta = |text: &str| {
        json!({"type":"message.delta","taskId":"task-a",
        "turnId":"turn-a","itemId":"message-a","payload":{"delta":text}})
    };
    // 模拟 stdout 读取循环：此前事件发布完成，才允许处理已校验的快照响应帧。
    super::event_publisher::publish_mapped_event(&state.runtime, delta("前").into(), None).await;
    let response = crate::application::acp_host::snapshot_response(
        &state,
        "project-a",
        json!({"id":"task-a","text":"前"}),
    )
    .await;
    super::event_publisher::publish_mapped_event(&state.runtime, delta("后").into(), None).await;
    assert_eq!(response["checkpoint"]["sequence"], 1);
    assert_eq!(state.project_sequence("project-a").await, 2);
    assert_eq!(response["snapshot"]["text"], "前");
}

#[test]
fn runtime_performance_metrics_should_report_merge_rate_and_queue_high_watermark() {
    let mut metrics = RuntimePerformanceMetrics::default();
    metrics.record_delivery("project-a", 10, 4, 7);

    let snapshot = metrics.snapshot();
    let project = &snapshot.projects[0];
    assert_eq!(project.project_id, "project-a");
    assert_eq!(project.provider_events_received, 10);
    assert_eq!(project.published_events, 4);
    assert_eq!(project.coalesced_events, 6);
    assert_eq!(project.ipc_events_per_second, 4.0);
    assert_eq!(project.merge_rate, 0.6);
    assert_eq!(project.queue_high_watermark, 7);
}
