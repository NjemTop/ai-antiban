use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;

pub const PROVIDER_ANTHROPIC: &str = "anthropic";
pub const PROVIDER_OPENAI: &str = "openai";
pub const PROVIDER_GEMINI: &str = "gemini";
pub const KNOWN_PROVIDERS: [&str; 3] = [PROVIDER_ANTHROPIC, PROVIDER_OPENAI, PROVIDER_GEMINI];
pub const MAX_HISTORY_ENTRIES_PER_PROVIDER: usize = 10;
pub const STATE_FILE_NAME: &str = "state.json";

#[derive(Debug, Error)]
pub enum StateError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Storage path error: {0}")]
    PathError(String),
}

/// Single connection/audit history record for an AI provider.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IpHistoryEntry {
    pub ip: String,
    pub country_code: String,
    #[serde(default, deserialize_with = "deserialize_asn")]
    pub asn: Option<u32>,
    pub timestamp: u64,
}

impl IpHistoryEntry {
    pub fn new(
        ip: impl Into<String>,
        country_code: impl Into<String>,
        asn: Option<u32>,
        timestamp: u64,
    ) -> Self {
        Self {
            ip: ip.into(),
            country_code: country_code.into().to_ascii_uppercase(),
            asn,
            timestamp,
        }
    }
}

/// Helper deserializer to tolerate integer, string (e.g. "AS20473" or "20473"), or null ASN values.
fn deserialize_asn<'de, D>(deserializer: D) -> Result<Option<u32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct AsnVisitor;

    impl<'de> serde::de::Visitor<'de> for AsnVisitor {
        type Value = Option<u32>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("an integer ASN, a string with optional 'AS' prefix, or null")
        }

        fn visit_none<E>(self) -> Result<Self::Value, E> {
            Ok(None)
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E> {
            Ok(None)
        }

        fn visit_u64<E>(self, v: u64) -> Result<Self::Value, E> {
            Ok(Some(v as u32))
        }

        fn visit_i64<E>(self, v: i64) -> Result<Self::Value, E> {
            if v >= 0 {
                Ok(Some(v as u32))
            } else {
                Ok(None)
            }
        }

        fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            let cleaned = v.trim().trim_start_matches("AS").trim_start_matches("as");
            match cleaned.parse::<u32>() {
                Ok(num) => Ok(Some(num)),
                Err(_) => Ok(None),
            }
        }
    }

    deserializer.deserialize_any(AsnVisitor)
}

/// Persistent state data structure serialized to `state.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppStateData {
    #[serde(default)]
    pub pinned_ip: Option<String>,
    #[serde(default)]
    pub strict_pinning_enabled: bool,
    #[serde(default)]
    pub ip_history: HashMap<String, Vec<IpHistoryEntry>>,
    #[serde(default)]
    pub session_allowed_providers: HashSet<String>,
    #[serde(default)]
    pub blocked_providers: HashSet<String>,
}

impl Default for AppStateData {
    fn default() -> Self {
        let mut ip_history = HashMap::new();
        for &provider in &KNOWN_PROVIDERS {
            ip_history.insert(provider.to_string(), Vec::new());
        }

        Self {
            pinned_ip: None,
            strict_pinning_enabled: false,
            ip_history,
            session_allowed_providers: HashSet::new(),
            blocked_providers: HashSet::new(),
        }
    }
}

/// Thread-safe wrapper for persistent application state.
#[derive(Debug, Clone)]
pub struct AppState {
    inner: Arc<RwLock<AppStateData>>,
    storage_path: Option<PathBuf>,
}

impl AppState {
    /// Creates a new in-memory `AppState` with optional persistence file path.
    pub fn new(data: AppStateData, storage_path: Option<PathBuf>) -> Self {
        Self {
            inner: Arc::new(RwLock::new(data)),
            storage_path,
        }
    }

    /// Creates an in-memory `AppState` initialized with default values.
    pub fn new_in_memory() -> Self {
        Self::new(AppStateData::default(), None)
    }

    /// Loads state from `state.json` at `storage_path`. If file does not exist, uses default state.
    pub fn load_or_default(storage_path: PathBuf) -> Self {
        let mut data = if storage_path.exists() {
            match Self::load_from_file(&storage_path) {
                Ok(loaded) => loaded,
                Err(err) => {
                    eprintln!(
                        "Warning: Failed to load state from {}: {}. Falling back to default state.",
                        storage_path.display(),
                        err
                    );
                    AppStateData::default()
                }
            }
        } else {
            AppStateData::default()
        };

        // Session allowances are ephemeral per app launch and must not carry over across restarts
        data.session_allowed_providers.clear();

        Self::new(data, Some(storage_path))
    }

    /// Loads `AppStateData` directly from a specified file path.
    pub fn load_from_file(path: &Path) -> Result<AppStateData, StateError> {
        let content = std::fs::read_to_string(path)?;
        let data: AppStateData = serde_json::from_str(&content)?;
        Ok(data)
    }

    /// Saves `AppStateData` directly to a specified file path.
    pub fn save_data_to_file(data: &AppStateData, path: &Path) -> Result<(), StateError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(data)?;
        std::fs::write(path, json)?;
        Ok(())
    }

    /// Synchronously saves the current state to the configured storage path.
    pub fn save_sync(&self) -> Result<(), StateError> {
        if let Some(path) = &self.storage_path {
            let data = self.inner.blocking_read().clone();
            Self::save_data_to_file(&data, path)?;
        }
        Ok(())
    }

    /// Asynchronously saves the current state to the configured storage path.
    pub async fn save_async(&self) -> Result<(), StateError> {
        if let Some(path) = &self.storage_path {
            let data = self.inner.read().await.clone();
            let path_clone = path.clone();
            tokio::task::spawn_blocking(move || Self::save_data_to_file(&data, &path_clone))
                .await
                .map_err(|e| StateError::PathError(e.to_string()))??;
        }
        Ok(())
    }

    /// Returns a cloned snapshot of current `AppStateData`.
    pub async fn get_data(&self) -> AppStateData {
        self.inner.read().await.clone()
    }

    /// Direct async read lock.
    pub async fn read(&self) -> tokio::sync::RwLockReadGuard<'_, AppStateData> {
        self.inner.read().await
    }

    /// Direct async write lock.
    pub async fn write(&self) -> tokio::sync::RwLockWriteGuard<'_, AppStateData> {
        self.inner.write().await
    }

    // --- Pinned IP & Strict Pinning ---

    pub async fn get_pinned_ip(&self) -> Option<String> {
        self.inner.read().await.pinned_ip.clone()
    }

    pub async fn set_pinned_ip(&self, ip: Option<String>) -> Result<(), StateError> {
        {
            let mut w = self.inner.write().await;
            w.pinned_ip = ip;
        }
        self.save_async().await
    }

    pub async fn is_strict_pinning_enabled(&self) -> bool {
        self.inner.read().await.strict_pinning_enabled
    }

    pub async fn set_strict_pinning_enabled(&self, enabled: bool) -> Result<(), StateError> {
        {
            let mut w = self.inner.write().await;
            w.strict_pinning_enabled = enabled;
        }
        self.save_async().await
    }

    // --- IP History ---

    /// Appends a new IP history entry for the given provider, keeping at most 10 recent entries.
    /// Repeated sightings of the same IP/country only refresh the timestamp of the last entry
    /// (and are persisted at most once per minute) so busy sessions don't flood the disk.
    pub async fn record_ip_history(
        &self,
        provider: &str,
        entry: IpHistoryEntry,
    ) -> Result<(), StateError> {
        let mut should_save = true;
        {
            let mut w = self.inner.write().await;
            let history = w.ip_history.entry(provider.to_string()).or_default();

            let same_as_last = history
                .last()
                .map(|l| l.ip == entry.ip && l.country_code == entry.country_code)
                .unwrap_or(false);

            if same_as_last {
                if let Some(last) = history.last_mut() {
                    should_save = entry.timestamp.saturating_sub(last.timestamp) >= 60;
                    last.timestamp = last.timestamp.max(entry.timestamp);
                }
            } else {
                history.push(entry);
                if history.len() > MAX_HISTORY_ENTRIES_PER_PROVIDER {
                    let overflow = history.len() - MAX_HISTORY_ENTRIES_PER_PROVIDER;
                    history.drain(0..overflow);
                }
            }
        }
        if should_save {
            self.save_async().await
        } else {
            Ok(())
        }
    }

    pub async fn get_ip_history(&self, provider: &str) -> Vec<IpHistoryEntry> {
        self.inner
            .read()
            .await
            .ip_history
            .get(provider)
            .cloned()
            .unwrap_or_default()
    }

    pub async fn get_last_ip_history(&self, provider: &str) -> Option<IpHistoryEntry> {
        self.inner
            .read()
            .await
            .ip_history
            .get(provider)
            .and_then(|h| h.last().cloned())
    }

    // --- Session Allowed Providers ("Accept risk & proceed") ---

    pub async fn allow_provider_for_session(&self, provider: &str) -> Result<(), StateError> {
        {
            let mut w = self.inner.write().await;
            w.session_allowed_providers.insert(provider.to_string());
            // An allowed provider is unblocked if previously marked blocked
            w.blocked_providers.remove(provider);
        }
        self.save_async().await
    }

    pub async fn is_provider_session_allowed(&self, provider: &str) -> bool {
        self.inner
            .read()
            .await
            .session_allowed_providers
            .contains(provider)
    }

    pub async fn revoke_session_allowed_provider(&self, provider: &str) -> Result<(), StateError> {
        {
            let mut w = self.inner.write().await;
            w.session_allowed_providers.remove(provider);
        }
        self.save_async().await
    }

    pub async fn clear_session_allowed_providers(&self) -> Result<(), StateError> {
        {
            let mut w = self.inner.write().await;
            w.session_allowed_providers.clear();
        }
        self.save_async().await
    }

    // --- Blocked Providers ("Block requests until network change") ---

    pub async fn block_provider(&self, provider: &str) -> Result<(), StateError> {
        {
            let mut w = self.inner.write().await;
            w.blocked_providers.insert(provider.to_string());
            // When blocked, remove from session allowed
            w.session_allowed_providers.remove(provider);
        }
        self.save_async().await
    }

    pub async fn unblock_provider(&self, provider: &str) -> Result<(), StateError> {
        {
            let mut w = self.inner.write().await;
            w.blocked_providers.remove(provider);
        }
        self.save_async().await
    }

    pub async fn is_provider_blocked(&self, provider: &str) -> bool {
        self.inner.read().await.blocked_providers.contains(provider)
    }

    pub async fn clear_blocked_providers(&self) -> Result<(), StateError> {
        {
            let mut w = self.inner.write().await;
            w.blocked_providers.clear();
        }
        self.save_async().await
    }

    pub async fn clear_ip_history_for_provider(&self, provider: &str) -> Result<(), StateError> {
        {
            let mut w = self.inner.write().await;
            if let Some(h) = w.ip_history.get_mut(provider) {
                h.clear();
            }
        }
        self.save_async().await
    }
}

/// Initializes `AppState` from the standard Tauri app data directory.
pub fn init_app_state<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<AppState, StateError> {
    use tauri::Manager;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| StateError::PathError(e.to_string()))?;
    std::fs::create_dir_all(&app_data_dir)?;
    let state_file = app_data_dir.join(STATE_FILE_NAME);
    let state = AppState::load_or_default(state_file);
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_state_serialization_deserialization() {
        let mut original = AppStateData::default();
        original.pinned_ip = Some("185.220.101.5".to_string());
        original.strict_pinning_enabled = true;
        original
            .session_allowed_providers
            .insert("anthropic".to_string());
        original.blocked_providers.insert("gemini".to_string());

        let entry = IpHistoryEntry::new("185.220.101.5", "nl", Some(20473), 1730745600);
        original
            .ip_history
            .get_mut("anthropic")
            .unwrap()
            .push(entry.clone());

        let json = serde_json::to_string_pretty(&original).expect("serialize failed");
        let deserialized: AppStateData =
            serde_json::from_str(&json).expect("deserialize failed");

        assert_eq!(original, deserialized);
        assert_eq!(deserialized.pinned_ip.as_deref(), Some("185.220.101.5"));
        assert!(deserialized.strict_pinning_enabled);
        assert!(deserialized.session_allowed_providers.contains("anthropic"));
        assert!(deserialized.blocked_providers.contains("gemini"));

        let history = deserialized.ip_history.get("anthropic").unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].country_code, "NL");
        assert_eq!(history[0].asn, Some(20473));
    }

    #[test]
    fn test_asn_deserializer_variants() {
        let json_num = r#"{"ip":"1.1.1.1","country_code":"US","asn":13335,"timestamp":100}"#;
        let entry1: IpHistoryEntry = serde_json::from_str(json_num).unwrap();
        assert_eq!(entry1.asn, Some(13335));

        let json_str = r#"{"ip":"1.1.1.1","country_code":"US","asn":"AS13335","timestamp":100}"#;
        let entry2: IpHistoryEntry = serde_json::from_str(json_str).unwrap();
        assert_eq!(entry2.asn, Some(13335));

        let json_null = r#"{"ip":"1.1.1.1","country_code":"US","asn":null,"timestamp":100}"#;
        let entry3: IpHistoryEntry = serde_json::from_str(json_null).unwrap();
        assert_eq!(entry3.asn, None);

        let json_missing = r#"{"ip":"1.1.1.1","country_code":"US","timestamp":100}"#;
        let entry4: IpHistoryEntry = serde_json::from_str(json_missing).unwrap();
        assert_eq!(entry4.asn, None);
    }

    #[tokio::test]
    async fn test_persistence_save_load() {
        let dir = tempdir().expect("create temp dir");
        let file_path = dir.path().join("state.json");

        let state = AppState::load_or_default(file_path.clone());
        assert_eq!(state.get_pinned_ip().await, None);
        assert!(!state.is_strict_pinning_enabled().await);

        // Mutate and verify auto-save
        state
            .set_pinned_ip(Some("95.217.1.1".to_string()))
            .await
            .expect("set pinned ip");
        state
            .set_strict_pinning_enabled(true)
            .await
            .expect("set strict pinning");

        // Reload fresh instance from disk
        let reloaded = AppState::load_or_default(file_path);
        assert_eq!(
            reloaded.get_pinned_ip().await,
            Some("95.217.1.1".to_string())
        );
        assert!(reloaded.is_strict_pinning_enabled().await);
    }

    #[tokio::test]
    async fn test_ip_history_max_10_entries() {
        let state = AppState::new_in_memory();

        // Push 15 entries
        for i in 1..=15 {
            let entry = IpHistoryEntry::new(
                format!("185.10.10.{}", i),
                "NL",
                Some(12345),
                1000 + i as u64,
            );
            state
                .record_ip_history("anthropic", entry)
                .await
                .expect("record history");
        }

        let history = state.get_ip_history("anthropic").await;
        assert_eq!(history.len(), 10);
        // Oldest entry kept should be i = 6
        assert_eq!(history[0].ip, "185.10.10.6");
        // Latest entry kept should be i = 15
        assert_eq!(history[9].ip, "185.10.10.15");

        let last = state.get_last_ip_history("anthropic").await.unwrap();
        assert_eq!(last.ip, "185.10.10.15");
    }

    #[tokio::test]
    async fn test_session_allowance_logic() {
        let state = AppState::new_in_memory();

        assert!(!state.is_provider_session_allowed("anthropic").await);

        state
            .allow_provider_for_session("anthropic")
            .await
            .expect("allow session");
        assert!(state.is_provider_session_allowed("anthropic").await);
        assert!(!state.is_provider_session_allowed("openai").await);

        state
            .revoke_session_allowed_provider("anthropic")
            .await
            .expect("revoke session");
        assert!(!state.is_provider_session_allowed("anthropic").await);

        state
            .allow_provider_for_session("anthropic")
            .await
            .expect("allow session");
        state
            .allow_provider_for_session("openai")
            .await
            .expect("allow session");
        state
            .clear_session_allowed_providers()
            .await
            .expect("clear all");
        assert!(!state.is_provider_session_allowed("anthropic").await);
        assert!(!state.is_provider_session_allowed("openai").await);
    }

    #[tokio::test]
    async fn test_provider_blocking_logic() {
        let state = AppState::new_in_memory();

        assert!(!state.is_provider_blocked("gemini").await);

        state.block_provider("gemini").await.expect("block provider");
        assert!(state.is_provider_blocked("gemini").await);

        // Blocking should revoke session allowed status if present
        state
            .allow_provider_for_session("openai")
            .await
            .expect("allow openai");
        assert!(state.is_provider_session_allowed("openai").await);
        state.block_provider("openai").await.expect("block openai");
        assert!(state.is_provider_blocked("openai").await);
        assert!(!state.is_provider_session_allowed("openai").await);

        // Allowing session should unblock provider
        state
            .allow_provider_for_session("openai")
            .await
            .expect("allow openai again");
        assert!(!state.is_provider_blocked("openai").await);
        assert!(state.is_provider_session_allowed("openai").await);

        state.unblock_provider("gemini").await.expect("unblock gemini");
        assert!(!state.is_provider_blocked("gemini").await);

        state.block_provider("anthropic").await.unwrap();
        state.clear_blocked_providers().await.unwrap();
        assert!(!state.is_provider_blocked("anthropic").await);
    }
}
