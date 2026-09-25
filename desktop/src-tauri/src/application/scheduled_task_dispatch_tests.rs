use super::*;
use crate::domain::conversation::{AgentPromptInput, AgentTurnOptions};

#[tokio::test]
async fn failed_claim_should_remain_due_and_retry_without_duplicate_launches() {
    for manual in [false, true] {
        let root = std::env::temp_dir().join(new_id("codeagent-claim-retry"));
        let runtime = ScheduledTaskRuntime::default();
        let at = 2_000_000_000_000;
        let created = runtime
            .create(
                &root,
                ScheduledTaskInput {
                    enabled: true,
                    name: "Retry".to_owned(),
                    project_id: "project-a".to_owned(),
                    project_name: "Project".to_owned(),
                    prompt: AgentPromptInput::text("Review"),
                    schedule: ScheduledTaskSchedule::Once { at_unix_ms: at },
                    turn_options: AgentTurnOptions::default(),
                },
            )
            .await
            .unwrap();
        let path = root.join("scheduled-tasks");
        let backup = root.join("backup");
        tokio::fs::rename(&path, &backup).await.unwrap();
        tokio::fs::write(&path, b"blocked").await.unwrap();
        let selected = manual.then_some(created.id.as_str());
        assert!(runtime.claim_pending(&root, selected, at).await.is_err());
        {
            let state = runtime.inner.lock().await;
            assert!(state.running.is_empty());
            assert!(state.tasks[0].runs.is_empty());
            assert_eq!(state.tasks[0].next_run_at_unix_ms, Some(at));
        }
        tokio::fs::remove_file(&path).await.unwrap();
        tokio::fs::rename(&backup, &path).await.unwrap();
        let claims = runtime.claim_pending(&root, selected, at).await.unwrap();
        assert_eq!(claims.len(), 1);
        assert!(
            runtime
                .claim_pending(&root, Some(&created.id), at)
                .await
                .is_err()
        );

        // 模拟启动已经确认但结果尚未落盘，补写不能重新 claim 同一次触发。
        {
            let mut state = runtime.inner.lock().await;
            let RuntimeState { tasks, running, .. } = &mut *state;
            finish_claim(
                tasks,
                running,
                &claims[0],
                at + 1,
                Ok("thread-a".to_owned()),
            );
            state.dirty = true;
        }
        assert!(
            runtime
                .claim_pending(&root, None, at - 1)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(!runtime.inner.lock().await.dirty);
        let saved = read_scheduled_tasks(&root).await.unwrap();
        assert_eq!(saved[0].runs.len(), 1);
        assert!(matches!(
            saved[0].runs[0].status,
            ScheduledTaskRunStatus::Started
        ));
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
}
