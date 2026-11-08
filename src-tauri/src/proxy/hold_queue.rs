use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, RwLock};
use crate::auditor::geo_matrix::ProviderId;
use crate::auditor::RiskReport;

pub const DEFAULT_HOLD_TTL_SECS: u64 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HoldResolution {
    Allow,
    Block,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InterceptionAction {
    #[serde(alias = "AllowSession")]
    AllowSession,
    #[serde(alias = "BlockUntilNetworkChange")]
    BlockUntilNetworkChange,
    #[serde(alias = "OpenGuideAndBlock")]
    OpenGuideAndBlock,
}

/// Describes a sudden egress-IP change detected by the network guard.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkChange {
    pub old_ip: Option<String>,
    pub old_country: Option<String>,
    pub new_ip: String,
    pub new_country: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskInterceptPayload {
    pub id: String,
    pub provider: ProviderId,
    pub host: String,
    pub report: RiskReport,
    pub ttl_seconds: u64,
    /// `"provider"` — single held CONNECT; `"network"` — global pause after IP change.
    #[serde(default = "default_scope")]
    pub scope: String,
    #[serde(default)]
    pub network_change: Option<NetworkChange>,
    #[serde(default)]
    pub is_simulation: bool,
}

fn default_scope() -> String {
    "provider".to_string()
}

struct HoldEntry {
    provider_id: String,
    sender: oneshot::Sender<HoldResolution>,
}

#[derive(Clone, Default)]
pub struct HoldQueue {
    entries: Arc<RwLock<HashMap<String, HoldEntry>>>,
}

impl HoldQueue {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Registers a connection in the hold queue and returns a receiver to await resolution.
    pub async fn register(
        &self,
        id: String,
        provider: &str,
    ) -> oneshot::Receiver<HoldResolution> {
        let (tx, rx) = oneshot::channel();
        let mut w = self.entries.write().await;
        w.insert(
            id,
            HoldEntry {
                provider_id: provider.to_string(),
                sender: tx,
            },
        );
        rx
    }

    /// Resolves a single held connection by ID.
    pub async fn resolve(&self, id: &str, resolution: HoldResolution) -> bool {
        let mut w = self.entries.write().await;
        if let Some(entry) = w.remove(id) {
            let _ = entry.sender.send(resolution);
            true
        } else {
            false
        }
    }

    /// Resolves all held connections matching a provider ID.
    pub async fn resolve_all_for_provider(&self, provider: &str, resolution: HoldResolution) -> usize {
        let mut w = self.entries.write().await;
        let mut resolved = 0;
        let keys_to_remove: Vec<String> = w
            .iter()
            .filter(|(_, entry)| entry.provider_id == provider)
            .map(|(k, _)| k.clone())
            .collect();

        for key in keys_to_remove {
            if let Some(entry) = w.remove(&key) {
                let _ = entry.sender.send(resolution);
                resolved += 1;
            }
        }
        resolved
    }

    /// Removes an entry without sending resolution (e.g. on client abort).
    pub async fn remove(&self, id: &str) {
        let mut w = self.entries.write().await;
        w.remove(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_connect_hold_and_allow_session() {
        let queue = HoldQueue::new();
        let id = "test-req-1".to_string();

        let rx = queue.register(id.clone(), "anthropic").await;

        let resolved = queue.resolve(&id, HoldResolution::Allow).await;
        assert!(resolved);

        let res = rx.await.expect("channel should resolve");
        assert_eq!(res, HoldResolution::Allow);
    }

    #[tokio::test]
    async fn test_connect_hold_and_block() {
        let queue = HoldQueue::new();
        let id = "test-req-2".to_string();

        let rx = queue.register(id.clone(), "gemini").await;

        let resolved = queue.resolve(&id, HoldResolution::Block).await;
        assert!(resolved);

        let res = rx.await.expect("channel should resolve");
        assert_eq!(res, HoldResolution::Block);
    }

    #[tokio::test]
    async fn test_resolve_all_for_provider() {
        let queue = HoldQueue::new();
        let rx1 = queue.register("req-1".into(), "openai").await;
        let rx2 = queue.register("req-2".into(), "openai").await;
        let rx3 = queue.register("req-3".into(), "anthropic").await;

        let count = queue.resolve_all_for_provider("openai", HoldResolution::Allow).await;
        assert_eq!(count, 2);

        assert_eq!(rx1.await.unwrap(), HoldResolution::Allow);
        assert_eq!(rx2.await.unwrap(), HoldResolution::Allow);

        // Anthropic still in queue
        let res3 = queue.resolve("req-3", HoldResolution::Block).await;
        assert!(res3);
        assert_eq!(rx3.await.unwrap(), HoldResolution::Block);
    }
}
