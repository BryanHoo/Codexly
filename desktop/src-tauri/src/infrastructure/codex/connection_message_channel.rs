use std::sync::Arc;

use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc};

use super::connection::ServerMessage;

pub(super) const MESSAGE_CHANNEL_BYTES: usize = 8 * 1024 * 1024;
type QueuedMessage = (ServerMessage, OwnedSemaphorePermit);

#[derive(Clone)]
pub(crate) struct ServerMessageSender {
    sender: mpsc::Sender<QueuedMessage>,
    bytes: Arc<Semaphore>,
}

pub struct ServerMessageReceiver(mpsc::Receiver<QueuedMessage>);

pub(crate) struct ServerMessagePermit {
    slot: mpsc::OwnedPermit<QueuedMessage>,
    bytes: OwnedSemaphorePermit,
}

pub(crate) fn server_message_channel(
    capacity: usize,
) -> (ServerMessageSender, ServerMessageReceiver) {
    let (sender, receiver) = mpsc::channel(capacity);
    (
        ServerMessageSender {
            sender,
            bytes: Arc::new(Semaphore::new(MESSAGE_CHANNEL_BYTES)),
        },
        ServerMessageReceiver(receiver),
    )
}

pub(super) fn message_bytes(message: &ServerMessage) -> usize {
    std::mem::size_of::<ServerMessage>() + message.method.len() + message.params.get().len()
}

impl ServerMessageSender {
    pub(crate) fn try_send(
        &self,
        message: ServerMessage,
    ) -> Result<(), mpsc::error::TrySendError<ServerMessage>> {
        let size = message_bytes(&message);
        if self.sender.is_closed() {
            return Err(mpsc::error::TrySendError::Closed(message));
        }
        let Ok(size) = u32::try_from(size) else {
            return Err(mpsc::error::TrySendError::Full(message));
        };
        let Ok(bytes) = self.bytes.clone().try_acquire_many_owned(size) else {
            return Err(mpsc::error::TrySendError::Full(message));
        };
        self.sender
            .try_send((message, bytes))
            .map_err(|error| match error {
                mpsc::error::TrySendError::Full((message, _)) => {
                    mpsc::error::TrySendError::Full(message)
                }
                mpsc::error::TrySendError::Closed((message, _)) => {
                    mpsc::error::TrySendError::Closed(message)
                }
            })
    }

    pub(crate) async fn reserve(&self, size: usize) -> Result<ServerMessagePermit, ()> {
        if size > MESSAGE_CHANNEL_BYTES {
            return Err(());
        }
        // 预算随队列元素持有；消费或接收端销毁时自动释放，取消等待不会泄漏额度。
        let bytes = self
            .bytes
            .clone()
            .acquire_many_owned(size as u32)
            .await
            .map_err(|_| ())?;
        let slot = self.sender.clone().reserve_owned().await.map_err(|_| ())?;
        Ok(ServerMessagePermit { slot, bytes })
    }

    pub(crate) async fn send(&self, message: ServerMessage) -> Result<(), ()> {
        self.reserve(message_bytes(&message)).await?.send(message);
        Ok(())
    }
}

impl ServerMessagePermit {
    pub(crate) fn send(self, message: ServerMessage) {
        self.slot.send((message, self.bytes));
    }
}

impl ServerMessageReceiver {
    pub(crate) async fn recv(&mut self) -> Option<ServerMessage> {
        self.0.recv().await.map(|(message, _)| message)
    }

    #[cfg(test)]
    pub(crate) fn try_recv(&mut self) -> Result<ServerMessage, mpsc::error::TryRecvError> {
        self.0.try_recv().map(|(message, _)| message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn byte_budget_should_stop_large_messages_before_count_capacity_and_recover_on_drop() {
        let (sender, mut receiver) = server_message_channel(256);
        let make_message = || ServerMessage {
            id: None,
            method: "test/event".to_owned(),
            params: serde_json::value::to_raw_value(&"x".repeat(1024 * 1024)).unwrap(),
        };
        for _ in 0..7 {
            sender.try_send(make_message()).unwrap();
        }
        assert!(sender.try_send(make_message()).is_err());
        receiver.recv().await.unwrap();
        sender.try_send(make_message()).unwrap();
        drop(receiver);
        assert_eq!(sender.bytes.available_permits(), MESSAGE_CHANNEL_BYTES);
    }
}
