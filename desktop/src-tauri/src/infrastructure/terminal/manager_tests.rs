use super::manager::TerminalManager;
use crate::domain::project_terminal::{CreateTerminalRequest, TerminalError};

fn request(project: &str, id: &str, generation: &str) -> CreateTerminalRequest {
    CreateTerminalRequest {
        project_id: project.into(),
        root_id: "r".into(),
        request_id: id.into(),
        generation: generation.into(),
        cols: 80,
        rows: 24,
    }
}

#[cfg(unix)]
#[test]
fn failed_creation_retains_handles_and_quota_until_cleanup_is_retried() {
    use std::sync::Arc;
    let manager = TerminalManager::default();
    let generation = manager.generation();
    let reservation = manager
        .reserve(request("a", "failed", &generation), 1)
        .unwrap();
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.args(["-c", "sleep 30"]);
    let session = Arc::new(super::session::Session::spawn(command, 80, 24).unwrap());
    assert_eq!(
        reservation.retain_for_cleanup(session.clone(), "sh".into(), None),
        TerminalError::CleanupFailed
    );
    assert_eq!(manager.live_count(), 1);
    assert!(!session.is_finished());
    manager.close_generation(&generation).unwrap();
    assert!(session.is_finished());
    assert_eq!(manager.live_count(), 0);
    assert_eq!(
        manager.snapshot().terminals[0].state,
        crate::domain::project_terminal::TerminalState::Failed
    );
}

#[test]
fn failed_reservation_rolls_back_and_project_removal_cancels_pending_spawn() {
    let manager = TerminalManager::default();
    let generation = manager.generation();
    let first = manager.reserve(request("a", "1", &generation), 1).unwrap();
    manager.invalidate_project("a");
    assert_eq!(first.validate(), Err(TerminalError::ProjectNotFound));
    drop(first);
    for index in 0..8 {
        let reservation = manager
            .reserve(request("b", &index.to_string(), &generation), index)
            .unwrap();
        drop(reservation);
    }
    assert_eq!(manager.live_count(), 0);
}

#[test]
fn deleted_project_cannot_reserve_another_terminal() {
    let manager = TerminalManager::default();
    manager.invalidate_project("a");
    assert!(matches!(
        manager.reserve(request("a", "new", &manager.generation()), 1),
        Err(TerminalError::ProjectNotFound)
    ));
}

#[test]
fn closing_owner_rejects_creation_and_duplicate_request_conflicts_are_explicit() {
    let manager = TerminalManager::default();
    let generation = manager.generation();
    let _reservation = manager.reserve(request("a", "1", &generation), 1).unwrap();
    assert!(matches!(
        manager.reserve(request("a", "1", &generation), 2),
        Err(TerminalError::RequestConflict)
    ));
    manager.set_closing(true);
    assert!(matches!(
        manager.reserve(request("a", "2", &generation), 2),
        Err(TerminalError::OwnerClosing)
    ));
    manager.set_closing(false);
    assert!(manager.reserve(request("a", "2", &generation), 2).is_ok());
}

#[cfg(unix)]
#[test]
fn committed_session_rejects_cross_project_access() {
    use std::sync::Arc;
    let manager = TerminalManager::default();
    let reservation = manager
        .reserve(request("a", "1", &manager.generation()), 1)
        .unwrap();
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.args(["-c", "sleep 30"]);
    let session = Arc::new(super::session::Session::spawn(command, 80, 24).unwrap());
    let metadata = reservation.commit(session.clone(), "sh".into()).unwrap();
    assert!(manager.session(&metadata.scope).is_ok());
    let mut forged = metadata.scope;
    forged.project_id = "b".into();
    assert!(matches!(
        manager.session(&forged),
        Err(TerminalError::ScopeMismatch)
    ));
    session.close().unwrap();
}

#[cfg(unix)]
#[test]
fn deletion_during_spawn_closes_new_process_and_releases_reservation() {
    use std::sync::Arc;
    let manager = TerminalManager::default();
    let reservation = manager
        .reserve(request("a", "1", &manager.generation()), 1)
        .unwrap();
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.args(["-c", "sleep 30"]);
    let session = Arc::new(super::session::Session::spawn(command, 80, 24).unwrap());
    manager.invalidate_project("a");
    assert!(matches!(
        reservation.commit(session.clone(), "sh".into()),
        Err(TerminalError::ProjectNotFound)
    ));
    assert!(session.is_finished());
    assert_eq!(manager.live_count(), 0);
}

#[cfg(unix)]
#[test]
fn closing_a_session_releases_quota_and_removal_does_not_terminate_live_sessions() {
    use std::sync::Arc;
    let manager = TerminalManager::default();
    let reservation = manager
        .reserve(request("a", "1", &manager.generation()), 1)
        .unwrap();
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.args(["-c", "sleep 30"]);
    let session = Arc::new(super::session::Session::spawn(command, 80, 24).unwrap());
    let metadata = reservation.commit(session.clone(), "sh".into()).unwrap();
    let early_remove = manager.remove(&metadata.scope);
    manager.close(&metadata.scope).unwrap();
    manager.close(&metadata.scope).unwrap();
    assert!(early_remove.is_err());
    assert!(session.is_finished());
    assert_eq!(manager.live_count(), 0);
    manager.remove(&metadata.scope).unwrap();
    assert!(matches!(
        manager.session(&metadata.scope),
        Err(TerminalError::NotFound)
    ));
}

#[cfg(unix)]
#[test]
fn managed_close_joins_stream_workers_before_releasing_quota() {
    use std::{sync::Arc, time::Duration};
    let manager = TerminalManager::default();
    let reservation = manager
        .reserve(request("a", "1", &manager.generation()), 1)
        .unwrap();
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.args(["-c", "sleep 30"]);
    let session = Arc::new(super::session::Session::spawn(command, 80, 24).unwrap());
    let transport = super::transport::Transport::start(
        session.clone(),
        tauri::ipc::Channel::new(|_| Ok(())),
        Arc::new(|| {}),
    )
    .unwrap();
    let metadata = reservation
        .commit_with_transport(session, "sh".into(), Some(transport.clone()))
        .unwrap();
    manager.close(&metadata.scope).unwrap();
    transport.join(Duration::ZERO).unwrap();
    assert_eq!(manager.live_count(), 0);
}

#[cfg(unix)]
#[test]
fn exited_history_evicts_only_the_oldest_exited_project_tab() {
    use std::sync::Arc;
    let manager = TerminalManager::default();
    for index in 0..5 {
        let reservation = manager
            .reserve(
                request("a", &index.to_string(), &manager.generation()),
                index,
            )
            .unwrap();
        let mut command = portable_pty::CommandBuilder::new("/bin/sh");
        command.args(["-c", "sleep 30"]);
        let session = Arc::new(super::session::Session::spawn(command, 80, 24).unwrap());
        let metadata = reservation.commit(session, "sh".into()).unwrap();
        manager.close(&metadata.scope).unwrap();
    }
    let snapshot = manager.snapshot();
    assert_eq!(snapshot.terminals.len(), 4);
    assert!(
        snapshot
            .terminals
            .iter()
            .all(|metadata| !metadata.state.is_live())
    );
    assert!(
        snapshot
            .terminals
            .iter()
            .all(|metadata| !metadata.scope.terminal_id.ends_with(":1"))
    );
}

#[cfg(unix)]
#[tokio::test]
async fn control_snapshot_and_events_share_one_sequence() {
    use std::{
        sync::{Arc, mpsc},
        time::Duration,
    };
    let manager = TerminalManager::default();
    let (sender, receiver) = mpsc::sync_channel(8);
    let channel = tauri::ipc::Channel::new(move |event| {
        sender.try_send(event).unwrap();
        Ok(())
    });
    let snapshot = manager.subscribe(channel).unwrap();
    assert_eq!(snapshot.sequence.0, 0);
    let reservation = manager
        .reserve(request("a", "1", &snapshot.generation), 1)
        .unwrap();
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.args(["-c", "sleep 30"]);
    let session = Arc::new(super::session::Session::spawn(command, 80, 24).unwrap());
    let metadata = reservation.commit(session, "sh".into()).unwrap();
    manager.close(&metadata.scope).unwrap();
    manager.remove(&metadata.scope).unwrap();
    for expected in 1..=4 {
        let event = receiver.recv_timeout(Duration::from_secs(1)).unwrap();
        let tauri::ipc::InvokeResponseBody::Json(json) = event else {
            panic!("expected metadata JSON")
        };
        let event: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(event["sequence"], expected.to_string());
    }
    assert_eq!(manager.snapshot().sequence.0, 4);
}

#[cfg(unix)]
#[test]
fn natural_exit_drains_output_and_reports_final_offset_and_exit_code() {
    use std::{
        sync::{Arc, mpsc},
        time::Duration,
    };
    let manager = TerminalManager::default();
    let (sender, receiver) = mpsc::sync_channel(8);
    manager
        .subscribe(tauri::ipc::Channel::new(move |event| {
            sender.try_send(event).unwrap();
            Ok(())
        }))
        .unwrap();
    let reservation = manager
        .reserve(request("a", "1", &manager.generation()), 1)
        .unwrap();
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.args(["-c", "printf tail; exit 7"]);
    let session = Arc::new(super::session::Session::spawn(command, 80, 24).unwrap());
    let transport = super::transport::Transport::start(
        session.clone(),
        tauri::ipc::Channel::new(|_| Ok(())),
        Arc::new(|| {}),
    )
    .unwrap();
    let metadata = reservation
        .commit_with_transport(session, "sh".into(), Some(transport))
        .unwrap();
    let result = (|| {
        for _ in 0..3 {
            let event = receiver
                .recv_timeout(Duration::from_secs(1))
                .map_err(|error| error.to_string())?;
            let tauri::ipc::InvokeResponseBody::Json(json) = event else {
                panic!("expected metadata JSON")
            };
            let event: serde_json::Value = serde_json::from_str(&json).unwrap();
            if event["type"] == "exited" {
                assert_eq!(event["data"]["exitCode"], 7);
                assert_eq!(event["data"]["finalOffset"], "4");
                assert!(event["data"]["truncatedReason"].is_null());
                return Ok::<(), String>(());
            }
        }
        Err("missing exit event".into())
    })();
    manager.close(&metadata.scope).unwrap();
    result.unwrap();
    assert_eq!(manager.live_count(), 0);
}

#[cfg(unix)]
#[test]
fn reconnect_reclaims_old_generation_and_old_cleanup_cannot_close_new_sessions() {
    use std::sync::Arc;
    let manager = TerminalManager::default();
    let old = manager.generation();
    let reservation = manager.reserve(request("a", "1", &old), 1).unwrap();
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.args(["-c", "sleep 30"]);
    let session = Arc::new(super::session::Session::spawn(command.clone(), 80, 24).unwrap());
    reservation.commit(session.clone(), "sh".into()).unwrap();
    let snapshot = manager
        .reconnect(tauri::ipc::Channel::new(|_| Ok(())))
        .unwrap();
    assert_ne!(snapshot.generation, old);
    assert!(session.is_finished());
    assert!(snapshot.terminals.is_empty());
    let reservation = manager
        .reserve(request("a", "1", &snapshot.generation), 2)
        .unwrap();
    let next = Arc::new(super::session::Session::spawn(command, 80, 24).unwrap());
    let metadata = reservation.commit(next.clone(), "sh".into()).unwrap();
    manager.close_generation(&old).unwrap();
    let survived = !next.is_finished();
    manager.close(&metadata.scope).unwrap();
    assert!(survived);
}

#[cfg(unix)]
#[test]
fn managed_io_rejects_forged_scope_and_invalid_ack() {
    use std::sync::Arc;
    let manager = TerminalManager::default();
    let reservation = manager
        .reserve(request("a", "1", &manager.generation()), 1)
        .unwrap();
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.args(["-c", "sleep 30"]);
    let session = Arc::new(super::session::Session::spawn(command, 80, 24).unwrap());
    let transport = super::transport::Transport::start(
        session.clone(),
        tauri::ipc::Channel::new(|_| Ok(())),
        Arc::new(|| {}),
    )
    .unwrap();
    let metadata = reservation
        .commit_with_transport(session, "sh".into(), Some(transport))
        .unwrap();
    let mut forged = metadata.scope.clone();
    forged.project_id = "b".into();
    let write = manager.write(&forged, 1, b"test");
    let ack = manager.ack(&metadata.scope, u64::MAX);
    manager.resize(&metadata.scope, 97, 31).unwrap();
    let snapshot = manager.snapshot();
    manager.close(&metadata.scope).unwrap();
    assert_eq!(write, Err(TerminalError::ScopeMismatch));
    assert_eq!(ack, Err(TerminalError::StreamInvalid));
    assert_eq!(
        (snapshot.terminals[0].cols, snapshot.terminals[0].rows),
        (97, 31)
    );
}

#[cfg(unix)]
#[test]
fn repeated_creation_reuses_metadata_only_for_the_original_channel_and_scope() {
    use std::sync::Arc;
    let manager = TerminalManager::default();
    let input = request("a", "1", &manager.generation());
    let reservation = manager.reserve(input.clone(), 1).unwrap();
    let mut command = portable_pty::CommandBuilder::new("/bin/sh");
    command.args(["-c", "sleep 30"]);
    let session = Arc::new(super::session::Session::spawn(command, 80, 24).unwrap());
    let metadata = reservation.commit(session, "sh".into()).unwrap();
    let duplicate = manager.cached_creation(&input, 1).unwrap().unwrap();
    let conflict = manager.cached_creation(&input, 2);
    manager.close(&metadata.scope).unwrap();
    assert_eq!(duplicate.scope, metadata.scope);
    assert!(matches!(conflict, Err(TerminalError::RequestConflict)));
}
