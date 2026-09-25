use super::flow_control::FlowControl;
use crate::domain::project_terminal::{BLOCK_BYTES, OUTPUT_HIGH_BYTES, TerminalError};

#[test]
fn cumulative_ack_does_not_grant_duplicate_credit() {
    let flow = FlowControl::default();
    for _ in 0..16 {
        assert_eq!(flow.read_budget().unwrap(), BLOCK_BYTES);
        flow.sent(BLOCK_BYTES).unwrap();
    }
    assert_eq!(flow.outstanding(), OUTPUT_HIGH_BYTES);
    flow.ack(65536).unwrap();
    flow.ack(65536).unwrap();
    flow.ack(1).unwrap();
    assert_eq!(flow.outstanding(), OUTPUT_HIGH_BYTES - 65536);
    assert_eq!(
        flow.ack(OUTPUT_HIGH_BYTES + 1),
        Err(TerminalError::StreamInvalid)
    );
}

#[test]
fn cancellation_wakes_a_producer_at_high_watermark() {
    use std::sync::Arc;
    let flow = Arc::new(FlowControl::default());
    for _ in 0..16 {
        flow.sent(BLOCK_BYTES).unwrap();
    }
    let producer = flow.clone();
    let worker = std::thread::spawn(move || producer.read_budget());
    flow.cancel();
    assert_eq!(worker.join().unwrap(), Err(TerminalError::OwnerClosing));
}

#[test]
fn tiny_frames_have_a_bounded_unacknowledged_count() {
    let flow = FlowControl::default();
    for _ in 0..1024 {
        flow.sent(1).unwrap();
    }
    assert_eq!(flow.sent(1), Err(TerminalError::StreamInvalid));
    flow.ack(1024).unwrap();
    assert_eq!(flow.read_budget().unwrap(), BLOCK_BYTES);
    assert_eq!(flow.sent(1).unwrap(), (1025, 1025));
}

#[test]
fn high_watermark_stays_paused_until_low_watermark_even_if_ack_arrives_before_read() {
    use std::{
        sync::{Arc, mpsc},
        time::Duration,
    };
    let flow = Arc::new(FlowControl::default());
    for _ in 0..16 {
        flow.sent(BLOCK_BYTES).unwrap();
    }
    flow.ack(65536).unwrap();
    let (sender, receiver) = mpsc::channel();
    let producer = flow.clone();
    let worker = std::thread::spawn(move || sender.send(producer.read_budget()).unwrap());
    let premature = receiver.recv_timeout(Duration::from_millis(30));
    flow.ack(OUTPUT_HIGH_BYTES - 65536).unwrap();
    let resumed = if premature.is_err() {
        receiver.recv_timeout(Duration::from_secs(1)).ok()
    } else {
        None
    };
    flow.cancel();
    worker.join().unwrap();
    assert!(
        premature.is_err(),
        "partial ACK resumed a paused producer above its low watermark"
    );
    assert_eq!(resumed, Some(Ok(BLOCK_BYTES)));
}
